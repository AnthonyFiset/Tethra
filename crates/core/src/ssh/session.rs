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

use super::agent_forward::{AgentForwardStatus, LocalAgentEndpoint};
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

/// Result of [`SessionManager::open_pty`].
pub struct PtyOpenResult {
    pub handle: PtyHandle,
    pub output: mpsc::Receiver<Bytes>,
    pub agent_forward: AgentForwardStatus,
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
///
/// Authenticated connections are pooled per host so a second tab / split
/// reuses the TCP+auth handshake (channel-open only).
pub struct SessionManager {
    hosts: Arc<dyn HostStore>,
    auth: Arc<dyn AuthProvider>,
    policy: Arc<dyn HostKeyPolicy>,
    gate: Arc<dyn ApprovalGate>,
    /// Idle authenticated sessions available for a new channel.
    pool: Arc<Mutex<HashMap<Uuid, Vec<Arc<Handle<ClientHandler>>>>>>,
}

const POOL_MAX_PER_HOST: usize = 2;

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
            pool: Arc::new(Mutex::new(HashMap::new())),
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
    pub async fn open_pty(&self, host_id: Uuid, size: PtySize) -> Result<PtyOpenResult> {
        self.open_pty_named(host_id, size, None).await
    }

    /// Open a PTY whose remote shell runs inside a named tmux session
    /// (`tmux -L tethra new-session -A -s <name>`) so it survives app
    /// restarts and disconnects. Falls back to a plain shell when tmux is
    /// missing on the host.
    pub async fn open_pty_named(
        &self,
        host_id: Uuid,
        size: PtySize,
        mux_session: Option<&str>,
    ) -> Result<PtyOpenResult> {
        self.gate.approve(&Action::OpenPty { host_id }).await?;

        let host = self.hosts.get(host_id).await?;
        let integrate = host.shell_integration != crate::model::ShellIntegration::Disabled;

        let (agent_endpoint, agent_status) = if host.forward_agent {
            match LocalAgentEndpoint::detect() {
                Some(endpoint) => (Some(endpoint), AgentForwardStatus::Active),
                None => (
                    None,
                    AgentForwardStatus::Unavailable {
                        hint: LocalAgentEndpoint::unavailable_hint(),
                    },
                ),
            }
        } else {
            (None, AgentForwardStatus::Off)
        };

        let session = self.checkout(host_id, agent_endpoint.clone()).await?;
        let channel = match session.channel_open_session().await {
            Ok(ch) => ch,
            Err(err) => {
                tracing::warn!(%err, "pooled SSH channel_open failed; reconnecting");
                let session = Arc::new(self.connect(host_id, agent_endpoint.clone()).await?);
                let ch = session.channel_open_session().await?;
                return self
                    .finish_pty(
                        host_id,
                        session,
                        ch,
                        size,
                        integrate,
                        agent_endpoint.is_some(),
                        agent_status,
                        mux_session,
                    )
                    .await;
            }
        };

        self.finish_pty(
            host_id,
            session,
            channel,
            size,
            integrate,
            agent_endpoint.is_some(),
            agent_status,
            mux_session,
        )
        .await
    }

    async fn finish_pty(
        &self,
        host_id: Uuid,
        session: Arc<Handle<ClientHandler>>,
        channel: Channel<russh::client::Msg>,
        size: PtySize,
        integrate: bool,
        want_agent: bool,
        agent_status: AgentForwardStatus,
        mux_session: Option<&str>,
    ) -> Result<PtyOpenResult> {
        if want_agent {
            if let Err(err) = channel.agent_forward(true).await {
                tracing::warn!(%err, "auth-agent-req@openssh.com failed");
            }
        }

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
            let wrapper = match mux_session {
                Some(name) => crate::terminal::ssh_persistent_wrapper_command(name),
                None => crate::terminal::ssh_default_wrapper_command(),
            };
            channel.exec(true, wrapper.as_str()).await?;
        } else if let Some(name) = mux_session {
            let cmd = format!(
                "if command -v tmux >/dev/null 2>&1; then exec tmux -L tethra new-session -A -s '{name}'; fi; exec \"${{SHELL:-/bin/sh}}\" -l -i"
            );
            channel.exec(true, cmd.as_str()).await?;
        } else {
            channel.request_shell(true).await?;
        }

        let (cmd_tx, mut cmd_rx) = mpsc::channel::<PtyCommand>(32);
        let (out_tx, out_rx) = mpsc::channel::<Bytes>(256);
        let pool = Arc::clone(&self.pool);

        let reader = tokio::spawn(async move {
            // Handle stays alive (Arc) while the channel runs — do not disconnect
            // on PTY end so the next tab can open another channel (warm reuse).
            run_pty_loop(channel, &mut cmd_rx, out_tx).await;
            tracing::info!(%host_id, closed = session.is_closed(), "PTY channel ended — pool checkin");
            SessionManager::checkin(pool.as_ref(), host_id, session).await;
        });

        Ok(PtyOpenResult {
            handle: PtyHandle {
                cmds: cmd_tx,
                reader: Some(reader),
            },
            output: out_rx,
            agent_forward: agent_status,
        })
    }

    /// Take an idle pooled connection or open a new one.
    async fn checkout(
        &self,
        host_id: Uuid,
        agent: Option<LocalAgentEndpoint>,
    ) -> Result<Arc<Handle<ClientHandler>>> {
        {
            let mut guard = self.pool.lock().await;
            if let Some(list) = guard.get_mut(&host_id) {
                while let Some(handle) = list.pop() {
                    if !handle.is_closed() {
                        tracing::info!(%host_id, "SSH pool hit (warm channel)");
                        return Ok(handle);
                    }
                }
            }
        }
        tracing::info!(%host_id, "SSH pool miss — fresh connect");
        Ok(Arc::new(self.connect(host_id, agent).await?))
    }

    async fn checkin(
        pool: &Mutex<HashMap<Uuid, Vec<Arc<Handle<ClientHandler>>>>>,
        host_id: Uuid,
        session: Arc<Handle<ClientHandler>>,
    ) {
        if session.is_closed() {
            tracing::info!(%host_id, "SSH pool checkin skipped (session closed)");
            return;
        }
        let mut guard = pool.lock().await;
        let list = guard.entry(host_id).or_default();
        if list.len() >= POOL_MAX_PER_HOST {
            // Dropping the Arc may disconnect when last ref goes away.
            return;
        }
        tracing::info!(%host_id, "SSH pool checkin");
        list.push(session);
    }

    /// Drop pooled connections for a host (vault lock / host delete).
    pub async fn drain_pool(&self, host_id: Option<Uuid>) {
        let mut guard = self.pool.lock().await;
        let drain: Vec<(Uuid, Vec<Arc<Handle<ClientHandler>>>)> = if let Some(id) = host_id {
            guard.remove(&id).map(|v| vec![(id, v)]).unwrap_or_default()
        } else {
            guard.drain().collect()
        };
        drop(guard);
        for (_, handles) in drain {
            for session in handles {
                let _ = session
                    .disconnect(Disconnect::ByApplication, "", "en")
                    .await;
            }
        }
    }

    /// Structured path. No PTY, parseable stdout/stderr/exit.
    pub async fn exec(&self, host_id: Uuid, cmd: &str) -> Result<ExecResult> {
        self.gate
            .approve(&Action::Exec {
                host_id,
                command: cmd.to_string(),
            })
            .await?;

        let session = self.connect(host_id, None).await?;
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
        let session = self.connect(host_id, None).await?;
        let channel = session.channel_open_session().await?;
        channel.request_subsystem(true, "sftp").await?;
        SftpSession::new(session, channel).await
    }

    async fn connect(
        &self,
        host_id: Uuid,
        agent: Option<LocalAgentEndpoint>,
    ) -> Result<Handle<ClientHandler>> {
        let host = self.hosts.get(host_id).await?;
        let auth = self.auth.credentials_for(&host).await?;

        let accepted = Arc::new(Mutex::new(None));
        let handler = ClientHandler {
            host_id,
            known: host.known_host_key.clone(),
            policy: Arc::clone(&self.policy),
            accepted: Arc::clone(&accepted),
            agent,
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
            AuthMaterial::DefaultKeys => {
                authenticate_with_default_keys(&mut session, &host.username).await?
            }
        };

        if !ok {
            return Err(Error::AuthenticationFailed);
        }

        Ok(session)
    }
}

/// Try the machine's default SSH keys (~/.ssh/id_*) in order — for servers
/// that already trust this machine. Encrypted keys are skipped (import those
/// as vault identities instead). Returns whether any key authenticated.
pub(crate) async fn authenticate_with_default_keys<H>(
    session: &mut russh::client::Handle<H>,
    username: &str,
) -> Result<bool>
where
    H: russh::client::Handler,
    crate::Error: From<<H as russh::client::Handler>::Error>,
{
    let home = std::env::var_os("HOME")
        .map(std::path::PathBuf::from)
        .ok_or_else(|| {
            Error::InvalidKey("no home directory to look for default SSH keys".into())
        })?;
    let mut tried_any = false;
    for name in ["id_ed25519", "id_ecdsa", "id_rsa"] {
        let path = home.join(".ssh").join(name);
        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        let Ok(key_pair) = load_private_key(&SecretBytes::new(bytes), None) else {
            continue;
        };
        tried_any = true;
        let hash = session.best_supported_rsa_hash().await?.flatten();
        let ok = session
            .authenticate_publickey(
                username.to_string(),
                PrivateKeyWithHashAlg::new(Arc::new(key_pair), hash),
            )
            .await?
            .success();
        if ok {
            return Ok(true);
        }
    }
    if !tried_any {
        return Err(Error::InvalidKey(
            "no usable default key in ~/.ssh (id_ed25519 / id_ecdsa / id_rsa) — \
add one, or attach a key or password to this host"
                .into(),
        ));
    }
    Ok(false)
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
}

pub(crate) fn load_private_key(
    key: &SecretBytes,
    passphrase: Option<&SecretString>,
) -> Result<PrivateKey> {
    parse_private_key_bytes(key.expose(), passphrase.map(SecretString::expose))
}

/// Parse OpenSSH or PEM (RSA/PKCS#8) private key bytes. Used by connect and import.
pub fn parse_private_key_bytes(key_bytes: &[u8], passphrase: Option<&str>) -> Result<PrivateKey> {
    let text = std::str::from_utf8(key_bytes).map_err(|_| {
        Error::InvalidKey("private key is not UTF-8 text (expected OpenSSH or PEM)".into())
    })?;
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err(Error::InvalidKey("private key file is empty".into()));
    }

    match russh::keys::decode_secret_key(trimmed, passphrase) {
        Ok(key) => Ok(key),
        Err(err) => {
            let hint = if trimmed.contains("BEGIN OPENSSH PRIVATE KEY") {
                "OpenSSH private key"
            } else if trimmed.contains("BEGIN RSA PRIVATE KEY") {
                "PEM RSA private key"
            } else if trimmed.contains("BEGIN ENCRYPTED PRIVATE KEY") {
                "encrypted PKCS#8 private key"
            } else if trimmed.contains("BEGIN PRIVATE KEY") {
                "PKCS#8 private key"
            } else if trimmed.contains("BEGIN EC PRIVATE KEY") {
                "PEM EC private key"
            } else if trimmed.contains("PuTTY-User-Key-File") {
                "PuTTY PPK private key"
            } else {
                "unrecognized private key format"
            };
            let needs_pass = passphrase.is_none()
                && (trimmed.contains("ENCRYPTED")
                    || trimmed.contains("Proc-Type: 4,ENCRYPTED")
                    || err.to_string().to_lowercase().contains("password")
                    || err.to_string().to_lowercase().contains("passphrase")
                    || err.to_string().to_lowercase().contains("encrypted"));
            if needs_pass {
                return Err(Error::InvalidKey(
                    "private key is encrypted; passphrase required".into(),
                ));
            }
            Err(Error::InvalidKey(format!("could not read {hint}: {err}")))
        }
    }
}

/// True when the key material looks encrypted and needs a passphrase.
pub fn private_key_appears_encrypted(key_bytes: &[u8]) -> bool {
    let Ok(text) = std::str::from_utf8(key_bytes) else {
        return false;
    };
    let upper = text.to_ascii_uppercase();
    upper.contains("ENCRYPTED") || upper.contains("PROC-TYPE: 4,ENCRYPTED")
}
