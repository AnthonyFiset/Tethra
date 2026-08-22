//! Local (`-L`) and remote (`-R`) TCP port forwarding.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use russh::client::{ChannelOpenHandle, Handle, Msg, Session};
use russh::keys::PrivateKeyWithHashAlg;
use russh::{Channel, Disconnect};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{Mutex, mpsc, oneshot};
use uuid::Uuid;

use super::approval::{Action, ApprovalGate};
use super::fingerprint::presented_from_public_key;
use super::session::{AuthProvider, HostKeyDecision, HostKeyPolicy, HostStore, load_private_key};
use crate::model::{AuthMaterial, KnownHostKey, TunnelDefinition, TunnelDirection};
use crate::{Error, Result};

/// Live tunnel state for UI / IPC.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TunnelState {
    Starting,
    Active,
    Error,
    Stopped,
}

/// Handle that keeps a tunnel alive until [`TunnelHandle::stop`].
pub struct TunnelHandle {
    stop: Option<oneshot::Sender<()>>,
    join: Option<tokio::task::JoinHandle<()>>,
    /// Bound port actually listening (local) or granted by remote (remote).
    pub bound_port: u16,
}

impl TunnelHandle {
    pub async fn stop(mut self) {
        if let Some(tx) = self.stop.take() {
            let _ = tx.send(());
        }
        if let Some(join) = self.join.take() {
            let _ = join.await;
        }
    }
}

impl Drop for TunnelHandle {
    fn drop(&mut self) {
        if let Some(tx) = self.stop.take() {
            let _ = tx.send(());
        }
        if let Some(join) = self.join.take() {
            join.abort();
        }
    }
}

/// Opens a dedicated SSH connection and starts one tunnel.
pub struct TunnelOpener {
    hosts: Arc<dyn HostStore>,
    auth: Arc<dyn AuthProvider>,
    policy: Arc<dyn HostKeyPolicy>,
    gate: Arc<dyn ApprovalGate>,
}

impl TunnelOpener {
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

    pub async fn start(&self, host_id: Uuid, def: &TunnelDefinition) -> Result<TunnelHandle> {
        self.gate.approve(&Action::Tunnel { host_id }).await?;

        match def.direction {
            TunnelDirection::Local => self.start_local(host_id, def).await,
            TunnelDirection::Remote => self.start_remote(host_id, def).await,
        }
    }

    async fn start_local(&self, host_id: Uuid, def: &TunnelDefinition) -> Result<TunnelHandle> {
        let bind = format!("{}:{}", def.bind_addr(), def.bind_port);
        let listener = TcpListener::bind(&bind).await.map_err(|err| {
            if err.kind() == std::io::ErrorKind::AddrInUse {
                Error::Tunnel(format!("local port {} is already in use", def.bind_port))
            } else {
                Error::Tunnel(format!("could not listen on {bind}: {err}"))
            }
        })?;
        let bound_port = listener.local_addr()?.port();

        let (forward_tx, _forward_rx) = mpsc::unbounded_channel::<Channel<Msg>>();
        let session = Arc::new(self.connect(host_id, forward_tx).await?);

        let target_host = def.target_host.clone();
        let target_port = u32::from(def.target_port);
        let (stop_tx, mut stop_rx) = oneshot::channel::<()>();

        let join = tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = &mut stop_rx => break,
                    accepted = listener.accept() => {
                        let Ok((socket, peer)) = accepted else { continue };
                        let session = Arc::clone(&session);
                        let target_host = target_host.clone();
                        tokio::spawn(async move {
                            if let Err(err) = pipe_local_connection(
                                session,
                                socket,
                                peer,
                                &target_host,
                                target_port,
                            )
                            .await
                            {
                                tracing::debug!(error = %err, "local tunnel connection ended");
                            }
                        });
                    }
                }
            }
            let _ = session
                .disconnect(Disconnect::ByApplication, "tunnel stopped", "en")
                .await;
        });

        Ok(TunnelHandle {
            stop: Some(stop_tx),
            join: Some(join),
            bound_port,
        })
    }

    async fn start_remote(&self, host_id: Uuid, def: &TunnelDefinition) -> Result<TunnelHandle> {
        let (forward_tx, mut forward_rx) = mpsc::unbounded_channel::<Channel<Msg>>();
        let session = Arc::new(self.connect(host_id, forward_tx).await?);

        let bind_addr = def.bind_addr().to_string();
        let requested_port = u32::from(def.bind_port);
        let bound_port = session
            .tcpip_forward(bind_addr.clone(), requested_port)
            .await
            .map_err(|err| {
                Error::Tunnel(format!(
                    "remote refused the forward on {bind_addr}:{requested_port} — \
                     the server may have AllowTcpForwarding disabled ({err})"
                ))
            })?;
        let bound_port = if bound_port == 0 {
            def.bind_port
        } else {
            bound_port as u16
        };

        let target_host = def.target_host.clone();
        let target_port = def.target_port;
        let (stop_tx, mut stop_rx) = oneshot::channel::<()>();
        let cancel_addr = bind_addr.clone();
        let cancel_port = u32::from(bound_port);

        let join = tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = &mut stop_rx => break,
                    msg = forward_rx.recv() => {
                        let Some(channel) = msg else { break };
                        let target_host = target_host.clone();
                        tokio::spawn(async move {
                            if let Err(err) =
                                pipe_remote_connection(channel, &target_host, target_port).await
                            {
                                tracing::debug!(error = %err, "remote tunnel connection ended");
                            }
                        });
                    }
                }
            }
            let _ = session.cancel_tcpip_forward(cancel_addr, cancel_port).await;
            let _ = session
                .disconnect(Disconnect::ByApplication, "tunnel stopped", "en")
                .await;
        });

        Ok(TunnelHandle {
            stop: Some(stop_tx),
            join: Some(join),
            bound_port,
        })
    }

    async fn connect(
        &self,
        host_id: Uuid,
        forward_tx: mpsc::UnboundedSender<Channel<Msg>>,
    ) -> Result<Handle<TunnelHandler>> {
        let host = self.hosts.get(host_id).await?;
        let auth = self.auth.credentials_for(&host).await?;

        let accepted = Arc::new(Mutex::new(None));
        let handler = TunnelHandler {
            host_id,
            known: host.known_host_key.clone(),
            policy: Arc::clone(&self.policy),
            accepted: Arc::clone(&accepted),
            forward_tx,
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

struct TunnelHandler {
    host_id: Uuid,
    known: Option<KnownHostKey>,
    policy: Arc<dyn HostKeyPolicy>,
    accepted: Arc<Mutex<Option<KnownHostKey>>>,
    forward_tx: mpsc::UnboundedSender<Channel<Msg>>,
}

impl russh::client::Handler for TunnelHandler {
    type Error = Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::PublicKey,
    ) -> std::result::Result<bool, Self::Error> {
        let presented = presented_from_public_key(server_public_key);

        if let Some(known) = &self.known {
            if known.algorithm == presented.algorithm
                && known.fingerprint_sha256 == presented.fingerprint_sha256
            {
                return Ok(true);
            }
            return Err(Error::HostKeyMismatch {
                expected_fingerprint: known.fingerprint_sha256.clone(),
                presented_fingerprint: presented.fingerprint_sha256.clone(),
            });
        }

        match self
            .policy
            .decide(self.host_id, &presented, self.known.as_ref())
            .await?
        {
            HostKeyDecision::AcceptAndRemember => {
                let known = presented.to_known();
                *self.accepted.lock().await = Some(known);
                Ok(true)
            }
            HostKeyDecision::AcceptOnce => Ok(true),
            HostKeyDecision::Reject => Err(Error::HostKeyRejected),
        }
    }

    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: Channel<Msg>,
        _connected_address: &str,
        _connected_port: u32,
        _originator_address: &str,
        _originator_port: u32,
        reply: ChannelOpenHandle,
        _session: &mut Session,
    ) -> std::result::Result<(), Self::Error> {
        reply.accept().await;
        let _ = self.forward_tx.send(channel);
        Ok(())
    }
}

async fn pipe_local_connection(
    session: Arc<Handle<TunnelHandler>>,
    mut socket: TcpStream,
    peer: SocketAddr,
    target_host: &str,
    target_port: u32,
) -> Result<()> {
    let channel = session
        .channel_open_direct_tcpip(
            target_host,
            target_port,
            peer.ip().to_string(),
            u32::from(peer.port()),
        )
        .await
        .map_err(|err| {
            Error::Tunnel(format!(
                "could not open tunnel to {target_host}:{target_port}: {err}"
            ))
        })?;

    let mut stream = channel.into_stream();
    let _ = tokio::io::copy_bidirectional(&mut socket, &mut stream).await;
    Ok(())
}

async fn pipe_remote_connection(
    channel: Channel<Msg>,
    target_host: &str,
    target_port: u16,
) -> Result<()> {
    let addr = format!("{target_host}:{target_port}");
    let mut local = TcpStream::connect(&addr).await.map_err(|err| {
        if err.kind() == std::io::ErrorKind::ConnectionRefused {
            Error::Tunnel(format!("target connection refused at {addr}"))
        } else {
            Error::Tunnel(format!("could not connect to local target {addr}: {err}"))
        }
    })?;

    let mut stream = channel.into_stream();
    let _ = tokio::io::copy_bidirectional(&mut local, &mut stream).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bind_addr_respects_allow_lan() {
        let mut def = TunnelDefinition::new_local(8080, 8080);
        assert_eq!(def.bind_addr(), "127.0.0.1");
        def.allow_lan = true;
        assert_eq!(def.bind_addr(), "0.0.0.0");
    }
}
