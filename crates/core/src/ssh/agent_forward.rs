//! Local SSH agent detection and dumb-pipe proxy for agent forwarding.
//!
//! Tethra never parses agent protocol messages — bytes are copied bidirectionally
//! between the SSH channel and the local agent endpoint.

use std::path::PathBuf;

use russh::Channel;
use russh::client::Msg;

use crate::Result;

/// Runtime outcome of requesting agent forwarding for a session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentForwardStatus {
    /// Host does not request forwarding.
    Off,
    /// Request accepted; local agent is reachable.
    Active,
    /// Host wants forwarding but no local agent is available.
    Unavailable { hint: String },
}

impl AgentForwardStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Active => "active",
            Self::Unavailable { .. } => "unavailable",
        }
    }

    pub fn hint(&self) -> Option<&str> {
        match self {
            Self::Unavailable { hint } => Some(hint.as_str()),
            _ => None,
        }
    }
}

/// Platform-specific path to the local SSH agent.
#[derive(Debug, Clone)]
pub enum LocalAgentEndpoint {
    #[cfg(unix)]
    UnixSocket(PathBuf),
    #[cfg(windows)]
    NamedPipe(String),
}

impl LocalAgentEndpoint {
    /// Resolve the local agent if one appears present. Does not authenticate.
    pub fn detect() -> Option<Self> {
        #[cfg(unix)]
        {
            let sock = std::env::var_os("SSH_AUTH_SOCK")?;
            if sock.is_empty() {
                return None;
            }
            let path = PathBuf::from(sock);
            // Existence check only — never open/read for key material here.
            if path.exists() {
                Some(Self::UnixSocket(path))
            } else {
                None
            }
        }
        #[cfg(windows)]
        {
            let name = r"\\.\pipe\openssh-ssh-agent".to_string();
            match std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .open(&name)
            {
                Ok(_) => Some(Self::NamedPipe(name)),
                Err(_) => None,
            }
        }
        #[cfg(not(any(unix, windows)))]
        {
            None
        }
    }

    pub fn unavailable_hint() -> String {
        #[cfg(windows)]
        {
            "agent forwarding unavailable — no local SSH agent (enable the OpenSSH Authentication Agent service)".into()
        }
        #[cfg(not(windows))]
        {
            "agent forwarding unavailable — no local SSH agent (load keys with ssh-add)".into()
        }
    }
}

/// Accept an agent-forward channel and splice it to the local agent. Never logs bytes.
pub async fn proxy_agent_channel(
    channel: Channel<Msg>,
    endpoint: &LocalAgentEndpoint,
) -> Result<()> {
    let mut remote = channel.into_stream();
    match endpoint {
        #[cfg(unix)]
        LocalAgentEndpoint::UnixSocket(path) => {
            let mut local = tokio::net::UnixStream::connect(path).await?;
            let _ = tokio::io::copy_bidirectional(&mut local, &mut remote).await;
        }
        #[cfg(windows)]
        LocalAgentEndpoint::NamedPipe(name) => {
            let mut local = tokio::net::windows::named_pipe::ClientOptions::new()
                .open(name)
                .map_err(crate::Error::Io)?;
            let _ = tokio::io::copy_bidirectional(&mut local, &mut remote).await;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_strings() {
        assert_eq!(AgentForwardStatus::Off.as_str(), "off");
        assert_eq!(AgentForwardStatus::Active.as_str(), "active");
        assert_eq!(
            AgentForwardStatus::Unavailable { hint: "x".into() }.as_str(),
            "unavailable"
        );
    }
}
