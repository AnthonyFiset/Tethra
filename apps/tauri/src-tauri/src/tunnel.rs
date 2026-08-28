//! Port-forward tunnel IPC: start/stop/list tied to terminal sessions.

use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use ssh_client_core::model::{TunnelDefinition, TunnelDirection};
use ssh_client_core::ssh::{TunnelHandle, TunnelOpener};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;
use ts_rs::TS;
use uuid::Uuid;

use crate::{AppState, parse_uuid, redacted_error};

pub type TunnelRuntimes = Arc<Mutex<HashMap<(Uuid, Uuid), LiveTunnel>>>;
pub type SessionHosts = Arc<Mutex<HashMap<Uuid, Uuid>>>;

pub struct LiveTunnel {
    pub handle: TunnelHandle,
    pub bound_port: u16,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../ui/src/lib/generated/")]
pub struct TunnelDefinitionDto {
    pub id: String,
    pub label: String,
    /// `local` | `remote`
    pub direction: String,
    pub bind_port: u16,
    pub target_host: String,
    pub target_port: u16,
    pub auto_start: bool,
    pub allow_lan: bool,
}

impl From<&TunnelDefinition> for TunnelDefinitionDto {
    fn from(def: &TunnelDefinition) -> Self {
        Self {
            id: def.id.to_string(),
            label: def.label.clone(),
            direction: match def.direction {
                TunnelDirection::Local => "local".into(),
                TunnelDirection::Remote => "remote".into(),
            },
            bind_port: def.bind_port,
            target_host: def.target_host.clone(),
            target_port: def.target_port,
            auto_start: def.auto_start,
            allow_lan: def.allow_lan,
        }
    }
}

impl TunnelDefinitionDto {
    pub fn into_core(self) -> Result<TunnelDefinition, String> {
        let id = parse_uuid(&self.id, "tunnel")?;
        let direction = match self.direction.as_str() {
            "local" => TunnelDirection::Local,
            "remote" => TunnelDirection::Remote,
            other => return Err(format!("unknown tunnel direction: {other}")),
        };
        if self.bind_port == 0 || self.target_port == 0 {
            return Err("ports must be between 1 and 65535".into());
        }
        let target_host = self.target_host.trim();
        if target_host.is_empty() {
            return Err("target host is required".into());
        }
        Ok(TunnelDefinition {
            id,
            label: if self.label.trim().is_empty() {
                format!(
                    "{}:{} → {}:{}",
                    if direction == TunnelDirection::Local {
                        "local"
                    } else {
                        "remote"
                    },
                    self.bind_port,
                    target_host,
                    self.target_port
                )
            } else {
                self.label.trim().to_string()
            },
            direction,
            bind_port: self.bind_port,
            target_host: target_host.to_string(),
            target_port: self.target_port,
            auto_start: self.auto_start,
            allow_lan: self.allow_lan,
        })
    }
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../ui/src/lib/generated/")]
pub struct TunnelStatusDto {
    pub session_id: String,
    pub tunnel_id: String,
    pub label: String,
    pub direction: String,
    pub bind_port: u16,
    pub target_host: String,
    pub target_port: u16,
    pub auto_start: bool,
    pub allow_lan: bool,
    /// `stopped` | `starting` | `active` | `error`
    pub state: String,
    pub bound_port: Option<u16>,
    pub error: Option<String>,
    /// Address useful for local forwards (`http://localhost:<port>`).
    pub local_url: Option<String>,
}

fn opener(state: &AppState) -> TunnelOpener {
    TunnelOpener::new(
        Arc::clone(&state.repo) as Arc<dyn ssh_client_core::ssh::HostStore>,
        Arc::clone(&state.repo) as Arc<dyn ssh_client_core::ssh::AuthProvider>,
        Arc::clone(&state.prompts) as Arc<dyn ssh_client_core::ssh::HostKeyPolicy>,
        Arc::clone(&state.approval_gate),
    )
}

pub async fn remember_session_host(state: &AppState, session_id: Uuid, host_id: Uuid) {
    state.session_hosts.lock().await.insert(session_id, host_id);
}

pub async fn stop_session_tunnels(state: &AppState, session_id: Uuid) {
    let keys: Vec<(Uuid, Uuid)> = {
        let guard = state.tunnels.lock().await;
        guard
            .keys()
            .filter(|(sid, _)| *sid == session_id)
            .copied()
            .collect()
    };
    for key in keys {
        if let Some(live) = state.tunnels.lock().await.remove(&key) {
            live.handle.stop().await;
        }
    }
    state.session_hosts.lock().await.remove(&session_id);
}

pub async fn close_all_tunnels(state: &AppState) {
    let drained: Vec<LiveTunnel> = {
        let mut guard = state.tunnels.lock().await;
        guard.drain().map(|(_, live)| live).collect()
    };
    for live in drained {
        live.handle.stop().await;
    }
    state.session_hosts.lock().await.clear();
}

/// Start `auto_start` tunnels after a successful PTY open. Failures are reported,
/// never blocking the terminal session.
pub async fn auto_start_for_session(
    app: &AppHandle,
    state: &AppState,
    session_id: Uuid,
    host_id: Uuid,
) {
    remember_session_host(state, session_id, host_id).await;
    let host = match state.repo.get_host(host_id).await {
        Ok(host) => host,
        Err(err) => {
            tracing::warn!(%err, "auto-start tunnels: could not load host");
            return;
        }
    };
    for def in host.tunnels.into_iter().filter(|t| t.auto_start) {
        let tunnel_id = def.id;
        let label = def.label.clone();
        let direction = match def.direction {
            TunnelDirection::Local => "local",
            TunnelDirection::Remote => "remote",
        };
        let bind_port = def.bind_port;
        let target_host = def.target_host.clone();
        let target_port = def.target_port;
        let allow_lan = def.allow_lan;
        match start_tunnel_inner(state, session_id, host_id, def).await {
            Ok(status) => {
                let _ = app.emit("tunnel-changed", status);
            }
            Err(err) => {
                tracing::warn!(%err, "auto-start tunnel failed");
                let _ = app.emit(
                    "tunnel-changed",
                    TunnelStatusDto {
                        session_id: session_id.to_string(),
                        tunnel_id: tunnel_id.to_string(),
                        label,
                        direction: direction.into(),
                        bind_port,
                        target_host,
                        target_port,
                        auto_start: true,
                        allow_lan,
                        state: "error".into(),
                        bound_port: None,
                        error: Some(err),
                        local_url: None,
                    },
                );
            }
        }
    }
}

/// Fire-and-forget entry used from `open_terminal` so tunnels never delay first paint.
pub async fn auto_start_for_session_spawned(app: AppHandle, session_id: Uuid, host_id: Uuid) {
    let state = app.state::<AppState>();
    auto_start_for_session(&app, &*state, session_id, host_id).await;
}

async fn start_tunnel_inner(
    state: &AppState,
    session_id: Uuid,
    host_id: Uuid,
    def: TunnelDefinition,
) -> Result<TunnelStatusDto, String> {
    let key = (session_id, def.id);
    if state.tunnels.lock().await.contains_key(&key) {
        return Err("tunnel is already active".into());
    }

    let opener = opener(state);
    let handle = opener.start(host_id, &def).await.map_err(redacted_error)?;
    let bound_port = handle.bound_port;
    let status = status_active(session_id, &def, bound_port);
    state
        .tunnels
        .lock()
        .await
        .insert(key, LiveTunnel { handle, bound_port });
    Ok(status)
}

fn status_active(session_id: Uuid, def: &TunnelDefinition, bound_port: u16) -> TunnelStatusDto {
    let local_url = match def.direction {
        TunnelDirection::Local => Some(format!("http://localhost:{bound_port}")),
        TunnelDirection::Remote => None,
    };
    TunnelStatusDto {
        session_id: session_id.to_string(),
        tunnel_id: def.id.to_string(),
        label: def.label.clone(),
        direction: match def.direction {
            TunnelDirection::Local => "local".into(),
            TunnelDirection::Remote => "remote".into(),
        },
        bind_port: def.bind_port,
        target_host: def.target_host.clone(),
        target_port: def.target_port,
        auto_start: def.auto_start,
        allow_lan: def.allow_lan,
        state: "active".into(),
        bound_port: Some(bound_port),
        error: None,
        local_url,
    }
}

fn status_stopped(session_id: Uuid, def: &TunnelDefinition) -> TunnelStatusDto {
    TunnelStatusDto {
        session_id: session_id.to_string(),
        tunnel_id: def.id.to_string(),
        label: def.label.clone(),
        direction: match def.direction {
            TunnelDirection::Local => "local".into(),
            TunnelDirection::Remote => "remote".into(),
        },
        bind_port: def.bind_port,
        target_host: def.target_host.clone(),
        target_port: def.target_port,
        auto_start: def.auto_start,
        allow_lan: def.allow_lan,
        state: "stopped".into(),
        bound_port: None,
        error: None,
        local_url: None,
    }
}

#[tauri::command]
pub async fn tunnel_list(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Vec<TunnelStatusDto>, String> {
    let session_id = parse_uuid(&session_id, "session")?;
    let host_id = state
        .session_hosts
        .lock()
        .await
        .get(&session_id)
        .copied()
        .ok_or_else(|| "no host associated with this terminal session".to_string())?;
    let host = state.repo.get_host(host_id).await.map_err(redacted_error)?;
    let live = state.tunnels.lock().await;
    Ok(host
        .tunnels
        .iter()
        .map(|def| {
            if let Some(runtime) = live.get(&(session_id, def.id)) {
                status_active(session_id, def, runtime.bound_port)
            } else {
                status_stopped(session_id, def)
            }
        })
        .collect())
}

#[tauri::command]
pub async fn tunnel_start(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    tunnel_id: String,
) -> Result<TunnelStatusDto, String> {
    let session_id = parse_uuid(&session_id, "session")?;
    let tunnel_id = parse_uuid(&tunnel_id, "tunnel")?;
    let host_id = state
        .session_hosts
        .lock()
        .await
        .get(&session_id)
        .copied()
        .ok_or_else(|| "no host associated with this terminal session".to_string())?;
    let host = state.repo.get_host(host_id).await.map_err(redacted_error)?;
    let def = host
        .tunnels
        .into_iter()
        .find(|t| t.id == tunnel_id)
        .ok_or_else(|| "tunnel definition not found on host".to_string())?;

    match start_tunnel_inner(&state, session_id, host_id, def.clone()).await {
        Ok(status) => {
            let _ = app.emit("tunnel-changed", status.clone());
            Ok(status)
        }
        Err(err) => {
            let mut failed = status_stopped(session_id, &def);
            failed.state = "error".into();
            failed.error = Some(err.clone());
            let _ = app.emit("tunnel-changed", failed.clone());
            Err(err)
        }
    }
}

#[tauri::command]
pub async fn tunnel_stop(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    tunnel_id: String,
) -> Result<TunnelStatusDto, String> {
    let session_id = parse_uuid(&session_id, "session")?;
    let tunnel_id = parse_uuid(&tunnel_id, "tunnel")?;
    let host_id = state
        .session_hosts
        .lock()
        .await
        .get(&session_id)
        .copied()
        .ok_or_else(|| "no host associated with this terminal session".to_string())?;
    let host = state.repo.get_host(host_id).await.map_err(redacted_error)?;
    let def = host
        .tunnels
        .iter()
        .find(|t| t.id == tunnel_id)
        .cloned()
        .ok_or_else(|| "tunnel definition not found on host".to_string())?;

    if let Some(live) = state.tunnels.lock().await.remove(&(session_id, tunnel_id)) {
        live.handle.stop().await;
    }
    let status = status_stopped(session_id, &def);
    let _ = app.emit("tunnel-changed", status.clone());
    Ok(status)
}

#[allow(dead_code)] // called from `tests::export_bindings`
pub fn export_bindings(cfg: &ts_rs::Config) {
    TunnelDefinitionDto::export_all(cfg).unwrap();
    TunnelStatusDto::export_all(cfg).unwrap();
}
