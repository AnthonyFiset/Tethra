//! Session manager: connect, authenticate, open PTY / exec / SFTP.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use bytes::Bytes;
use russh::client::Handle;
use russh::keys::{PrivateKey, PrivateKeyWithHashAlg};
use russh::{Channel, ChannelMsg, Disconnect, Pty};
use tokio::sync::{Mutex, mpsc};
use uuid::Uuid;

use super::approval::{Action, AlwaysApprove, ApprovalGate};
use super::fingerprint::PresentedHostKey;
use super::handler::ClientHandler;
use super::sftp::SftpSession;
use crate::model::{AuthMaterial, Host, KnownHostKey, PtySize, SecretBytes, SecretString};
use crate::{Error, Result};

/// Lookup / update host records (including known-host keys after TOFU).
#[async_trait]
pub trait HostStore: Send + Sync {
    async fn get(&self, id: Uuid) -> Result<Host>;
    async fn set_known_host_key(&self, id: Uuid, key: KnownHostKey) -> Result<()>;
}

/// Resolve authentication material for a host.
#[async_trait]
pub trait AuthProvider: Send + Sync {
    async fn credentials_for(&self, host: &Host) -> Result<AuthMaterial>;
}

/// Decision for an unknown (first-seen) host key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HostKeyDecision {
    AcceptAndRemember,
    AcceptOnce,
    Reject,
}

/// Called only when no known key exists. Mismatch is always refused by the Handler.
#[async_trait]
pub trait HostKeyPolicy: Send + Sync {
    async fn decide(
        &self,
        host_id: Uuid,
        presented: &PresentedHostKey,
        known: Option<&KnownHostKey>,
    ) -> Result<HostKeyDecision>;
}

/// TOFU: auto-accept and remember the first key. Mismatches never reach here.
#[derive(Debug, Default, Clone, Copy)]
pub struct TofuHostKeyPolicy;

#[async_trait]
impl HostKeyPolicy for TofuHostKeyPolicy {
    async fn decide(
        &self,
        _host_id: Uuid,
        _presented: &PresentedHostKey,
        _known: Option<&KnownHostKey>,
    ) -> Result<HostKeyDecision> {
        Ok(HostKeyDecision::AcceptAndRemember)
    }
}

/// In-memory host map for the CLI harness and tests.
#[derive(Default)]
pub struct InMemoryHostStore {
    hosts: Mutex<HashMap<Uuid, Host>>,
}

impl InMemoryHostStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn insert(&self, host: Host) -> Uuid {
        let id = host.id;
        self.hosts.lock().await.insert(id, host);
        id
    }
}

#[async_trait]
impl HostStore for InMemoryHostStore {
    async fn get(&self, id: Uuid) -> Result<Host> {
        self.hosts
            .lock()
            .await
            .get(&id)
            .cloned()
            .ok_or(Error::HostNotFound(id))
    }

    async fn set_known_host_key(&self, id: Uuid, key: KnownHostKey) -> Result<()> {
        let mut guard = self.hosts.lock().await;
        let host = guard.get_mut(&id).ok_or(Error::HostNotFound(id))?;
        host.known_host_key = Some(key);
        Ok(())
    }
}

/// Fixed credentials for every host — CLI / tests.
pub struct StaticAuthProvider {
    kind: AuthKind,
}

enum AuthKind {
    Password(SecretString),
    PrivateKey {
        key: SecretBytes,
        passphrase: Option<SecretString>,
    },
}

impl StaticAuthProvider {
    pub fn password(password: impl Into<String>) -> Self {
        Self {
            kind: AuthKind::Password(SecretString::new(password)),
        }
    }

    pub fn private_key(key: impl Into<Vec<u8>>, passphrase: Option<String>) -> Self {
        Self {
            kind: AuthKind::PrivateKey {
                key: SecretBytes::new(key),
                passphrase: passphrase.map(SecretString::new),
            },
        }
    }
}

#[async_trait]
impl AuthProvider for StaticAuthProvider {
    async fn credentials_for(&self, _host: &Host) -> Result<AuthMaterial> {
        match &self.kind {
            AuthKind::Password(p) => Ok(AuthMaterial::Password {
                password: SecretString::new(p.expose()),
            }),
            AuthKind::PrivateKey { key, passphrase } => Ok(AuthMaterial::PrivateKey {
                key: SecretBytes::new(key.expose().to_vec()),
                passphrase: passphrase.as_ref().map(|p| SecretString::new(p.expose())),
            }),
        }
    }
}

/// Result of a structured (non-PTY) remote command.
#[derive(Debug, Clone)]
pub struct ExecResult {
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub exit_code: u32,
}

enum PtyCommand {
    Data(Vec<u8>),
    Resize(PtySize),
    Close,
}

/// Interactive PTY session handle.
pub struct PtyHandle {
    cmds: mpsc::Sender<PtyCommand>,
    reader: Option<tokio::task::JoinHandle<()>>,
}

impl PtyHandle {
    pub async fn write(&mut self, data: &[u8]) -> Result<()> {
        self.cmds
            .send(PtyCommand::Data(data.to_vec()))
            .await
            .map_err(|_| Error::ChannelClosed)?;
        Ok(())
    }

    pub async fn resize(&mut self, size: PtySize) -> Result<()> {
        self.cmds
            .send(PtyCommand::Resize(size))
            .await
            .map_err(|_| Error::ChannelClosed)?;
        Ok(())
    }

    pub async fn close(mut self) -> Result<()> {
        let _ = self.cmds.send(PtyCommand::Close).await;
        if let Some(reader) = self.reader.take() {
            let _ = reader.await;
        }
        Ok(())
    }
}

/// Owns host/auth/policy/gate and opens SSH sessions.
pub struct SessionManager {
    hosts: Arc<dyn HostStore>,
    auth: Arc<dyn AuthProvider>,
    policy: Arc<dyn HostKeyPolicy>,
    gate: Arc<dyn ApprovalGate>,
}

impl SessionManager {
    pub fn new(
        hosts: Arc<dyn HostStore>,
        auth: Arc<dyn AuthProvider>,
        policy: Arc<dyn HostKeyPolicy>,
        gate: Arc<dyn ApprovalGate>,
    ) -> Self {
        Self {
            hosts,
            auth,
            policy,
            gate,
        }
    }

    /// Convenience constructor with TOFU + always-approve.
    pub fn with_defaults(hosts: Arc<dyn HostStore>, auth: Arc<dyn AuthProvider>) -> Self {
        Self::new(
            hosts,
            auth,
            Arc::new(TofuHostKeyPolicy),
            Arc::new(AlwaysApprove),
        )
    }

    /// Interactive path. Raw bytes, ANSI intact.
    ///
    /// When the host's [`ShellIntegration`](crate::model::ShellIntegration) is
    /// `Auto`, starts a bash wrapper that emits OSC 133 / OSC 7. Falls back to
    /// a plain shell if the wrapper exec fails to start (caller still gets a
    /// usable PTY only when the remote accepts the command — exotic hosts can
    /// set `shell_integration: Disabled`).
    pub async fn open_pty(
        &self,
        host_id: Uuid,
        size: PtySize,
    ) -> Result<(PtyHandle, mpsc::Receiver<Bytes>)> {
        self.gate.approve(&Action::OpenPty { host_id }).await?;

        let host = self.hosts.get(host_id).await?;
        let integrate = host.shell_integration != crate::model::ShellIntegration::Disabled;

        let session = self.connect(host_id).await?;
        let channel = session.channel_open_session().await?;

        channel
            .request_pty(
                false,
                "xterm-256color",
                size.cols,
                size.rows,
                size.pixel_width,
                size.pixel_height,
                &pty_modes(),
            )
            .await?;

        if integrate {
            let wrapper = crate::terminal::ssh_default_wrapper_command();
            channel.exec(true, wrapper.as_str()).await?;
        } else {
            channel.request_shell(true).await?;
        }

        let (cmd_tx, mut cmd_rx) = mpsc::channel::<PtyCommand>(32);
        let (out_tx, out_rx) = mpsc::channel::<Bytes>(256);

        let reader = tokio::spawn(async move {
            run_pty_loop(session, channel, &mut cmd_rx, out_tx).await;
        });

        Ok((
            PtyHandle {
                cmds: cmd_tx,
                reader: Some(reader),
            },
            out_rx,
        ))
    }

    /// Structured path. No PTY, parseable stdout/stderr/exit.
    pub async fn exec(&self, host_id: Uuid, cmd: &str) -> Result<ExecResult> {
        self.gate
            .approve(&Action::Exec {
                host_id,
                command: cmd.to_string(),
            })
            .await?;

        let session = self.connect(host_id).await?;
        let mut channel = session.channel_open_session().await?;
        channel.exec(true, cmd).await?;

        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let mut exit_code = None;

        loop {
            match channel.wait().await {
                Some(ChannelMsg::Data { data }) => stdout.extend_from_slice(&data),
                Some(ChannelMsg::ExtendedData { data, .. }) => stderr.extend_from_slice(&data),
                Some(ChannelMsg::ExitStatus { exit_status }) => {
                    exit_code = Some(exit_status);
                    // Keep draining until EOF so we don't miss trailing data.
                }
                Some(ChannelMsg::Eof) if exit_code.is_some() => break,
                Some(ChannelMsg::Eof) => {}
                None => break,
                _ => {}
            }
        }

        let _ = session
            .disconnect(Disconnect::ByApplication, "", "en")
            .await;

        Ok(ExecResult {
            stdout,
            stderr,
            exit_code: exit_code
                .ok_or_else(|| Error::Ssh("remote command sent no exit status".into()))?,
        })
    }

    pub async fn sftp(&self, host_id: Uuid) -> Result<SftpSession> {
        self.gate.approve(&Action::Sftp { host_id }).await?;
        let session = self.connect(host_id).await?;
        let channel = session.channel_open_session().await?;
        channel.request_subsystem(true, "sftp").await?;
        SftpSession::new(session, channel).await
    }

    async fn connect(&self, host_id: Uuid) -> Result<Handle<ClientHandler>> {
        let host = self.hosts.get(host_id).await?;
        let auth = self.auth.credentials_for(&host).await?;

        let accepted = Arc::new(Mutex::new(None));
        let handler = ClientHandler {
            host_id,
            known: host.known_host_key.clone(),
            policy: Arc::clone(&self.policy),
            accepted: Arc::clone(&accepted),
        };

        let config = russh::client::Config {
            inactivity_timeout: Some(Duration::from_secs(300)),
            keepalive_interval: Some(Duration::from_secs(30)),
            ..Default::default()
        };

        let mut session = russh::client::connect(
            Arc::new(config),
            (host.hostname.as_str(), host.port),
            handler,
        )
        .await?;

        if let Some(key) = accepted.lock().await.take() {
            self.hosts.set_known_host_key(host_id, key).await?;
        }

        let ok = match &auth {
            AuthMaterial::Password { password } => session
                .authenticate_password(host.username.clone(), password.expose())
                .await?
                .success(),
            AuthMaterial::PrivateKey { key, passphrase } => {
                let key_pair = load_private_key(key, passphrase.as_ref())?;
                let hash = session.best_supported_rsa_hash().await?.flatten();
                session
                    .authenticate_publickey(
                        host.username.clone(),
                        PrivateKeyWithHashAlg::new(Arc::new(key_pair), hash),
                    )
                    .await?
                    .success()
            }
        };

        if !ok {
            return Err(Error::AuthenticationFailed);
        }

        Ok(session)
    }
}

fn pty_modes() -> [(Pty, u32); 7] {
    [
        (Pty::ECHO, 1),
        (Pty::ICANON, 1),
        (Pty::ISIG, 1),
        (Pty::ICRNL, 1),
        (Pty::OPOST, 1),
        (Pty::ONLCR, 1),
        (Pty::CS8, 1),
    ]
}

async fn run_pty_loop(
    session: Handle<ClientHandler>,
    mut channel: Channel<russh::client::Msg>,
    cmd_rx: &mut mpsc::Receiver<PtyCommand>,
    out_tx: mpsc::Sender<Bytes>,
) {
    loop {
        tokio::select! {
            cmd = cmd_rx.recv() => {
                match cmd {
                    Some(PtyCommand::Data(data)) => {
                        if channel.data(&data[..]).await.is_err() {
                            break;
                        }
                    }
                    Some(PtyCommand::Resize(size)) => {
                        let _ = channel
                            .window_change(
                                size.cols,
                                size.rows,
                                size.pixel_width,
                                size.pixel_height,
                            )
                            .await;
                    }
                    Some(PtyCommand::Close) | None => {
                        let _ = channel.eof().await;
                        let _ = channel.close().await;
                        break;
                    }
                }
            }
            msg = channel.wait() => {
                match msg {
                    Some(ChannelMsg::Data { data }) => {
                        if out_tx.send(Bytes::copy_from_slice(&data)).await.is_err() {
                            break;
                        }
                    }
                    Some(ChannelMsg::ExtendedData { data, .. }) => {
                        let _ = out_tx.send(Bytes::copy_from_slice(&data)).await;
                    }
                    Some(ChannelMsg::Eof) | None => break,
                    _ => {}
                }
            }
        }
    }
    let _ = session
        .disconnect(Disconnect::ByApplication, "", "en")
        .await;
}

fn load_private_key(key: &SecretBytes, passphrase: Option<&SecretString>) -> Result<PrivateKey> {
    let mut parsed =
        PrivateKey::from_openssh(key.expose()).map_err(|e| Error::InvalidKey(e.to_string()))?;

    if parsed.is_encrypted() {
        let pass = passphrase.ok_or_else(|| {
            Error::InvalidKey("private key is encrypted; passphrase required".into())
        })?;
        parsed = parsed
            .decrypt(pass.expose())
            .map_err(|e| Error::InvalidKey(e.to_string()))?;
    }

    Ok(parsed)
}
