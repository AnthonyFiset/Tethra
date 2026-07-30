//! Desktop sync configuration and IPC.

use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use ssh_client_core::sync::{
    FileBackend, HttpBackend, SyncEngine, SyncReport, SyncStatus as CoreSyncStatus,
};
use tauri::Emitter;
use tauri::State;
use tauri_plugin_dialog::DialogExt;
use ts_rs::TS;

use crate::AppState;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum SyncBackendConfig {
    #[default]
    Disabled,
    File {
        path: String,
    },
    Http {
        url: String,
        token: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SyncSettings {
    pub backend: SyncBackendConfig,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../ui/src/lib/generated/")]
pub struct SyncStatusDto {
    pub configured: bool,
    pub backend_kind: String,
    pub detail: Option<String>,
    pub last_cursor: Option<String>,
    pub last_synced_at: Option<String>,
    pub last_error: Option<String>,
    pub last_pulled: u32,
    pub last_pushed: u32,
    pub last_applied: u32,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../ui/src/lib/generated/")]
pub struct SyncReportDto {
    pub pulled: u32,
    pub applied: u32,
    pub pushed: u32,
    pub cursor: String,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../ui/src/lib/generated/")]
pub struct SyncJoinResultDto {
    /// True when this device adopted the shared vault header just now.
    pub adopted: bool,
    pub vault_exists: bool,
    pub status: SyncStatusDto,
}

impl From<&CoreSyncStatus> for SyncStatusDto {
    fn from(status: &CoreSyncStatus) -> Self {
        Self {
            configured: status.configured,
            backend_kind: status.backend_kind.clone(),
            detail: None,
            last_cursor: status.last_cursor.clone(),
            last_synced_at: status.last_synced_at.clone(),
            last_error: status.last_error.clone(),
            last_pulled: status.last_pulled,
            last_pushed: status.last_pushed,
            last_applied: status.last_applied,
        }
    }
}

impl From<&SyncReport> for SyncReportDto {
    fn from(report: &SyncReport) -> Self {
        Self {
            pulled: report.pulled,
            applied: report.applied,
            pushed: report.pushed,
            cursor: report.cursor.clone(),
        }
    }
}

pub fn settings_path(data_dir: &std::path::Path) -> PathBuf {
    data_dir.join("sync-settings.json")
}

pub fn load_settings(data_dir: &std::path::Path) -> SyncSettings {
    let path = settings_path(data_dir);
    std::fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

pub fn save_settings(data_dir: &std::path::Path, settings: &SyncSettings) -> Result<(), String> {
    let path = settings_path(data_dir);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let bytes = serde_json::to_vec_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(path, bytes).map_err(|e| e.to_string())
}

pub fn build_engine(
    vault: Arc<ssh_client_core::vault::Vault>,
    settings: &SyncSettings,
) -> Option<Arc<SyncEngine>> {
    match &settings.backend {
        SyncBackendConfig::Disabled => None,
        SyncBackendConfig::File { path } => {
            let backend = Arc::new(FileBackend::new(path));
            Some(Arc::new(SyncEngine::new(vault, backend, "file")))
        }
        SyncBackendConfig::Http { url, token } => {
            let backend = Arc::new(HttpBackend::new(url, token.clone()));
            Some(Arc::new(SyncEngine::new(vault, backend, "http")))
        }
    }
}

fn detail_for(settings: &SyncSettings) -> Option<String> {
    match &settings.backend {
        SyncBackendConfig::Disabled => None,
        SyncBackendConfig::File { path } => Some(path.clone()),
        SyncBackendConfig::Http { url, .. } => Some(url.clone()),
    }
}

#[tauri::command]
pub async fn sync_status(state: State<'_, AppState>) -> Result<SyncStatusDto, String> {
    let settings = state.sync_settings.lock().await.clone();
    if let Some(engine) = state.sync_engine.lock().await.as_ref() {
        let mut dto = SyncStatusDto::from(&engine.status().await);
        dto.detail = detail_for(&settings);
        return Ok(dto);
    }
    Ok(SyncStatusDto {
        configured: false,
        backend_kind: "disabled".into(),
        detail: None,
        last_cursor: None,
        last_synced_at: None,
        last_error: None,
        last_pulled: 0,
        last_pushed: 0,
        last_applied: 0,
    })
}

#[tauri::command]
pub async fn sync_configure_file(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<SyncStatusDto, String> {
    let settings = SyncSettings {
        backend: SyncBackendConfig::File { path },
    };
    apply_settings(&app, &state, settings).await
}

#[tauri::command]
pub async fn sync_configure_http(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    url: String,
    token: Option<String>,
) -> Result<SyncStatusDto, String> {
    let settings = SyncSettings {
        backend: SyncBackendConfig::Http {
            url,
            token: token.filter(|value| !value.is_empty()),
        },
    };
    apply_settings(&app, &state, settings).await
}

/// Join an existing sync server before this device has a vault: adopt the
/// shared header so the same master password unlocks the synced rows.
#[tauri::command]
pub async fn sync_join_http(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    url: String,
    token: Option<String>,
) -> Result<SyncJoinResultDto, String> {
    let settings = SyncSettings {
        backend: SyncBackendConfig::Http {
            url,
            token: token.filter(|value| !value.is_empty()),
        },
    };
    let status = apply_settings(&app, &state, settings).await?;

    let engine = {
        let guard = state.sync_engine.lock().await;
        guard
            .clone()
            .ok_or_else(|| "sync is not configured".to_string())?
    };

    // Surface connection/auth failures here rather than silently continuing.
    let adopted = engine
        .bootstrap_from_backend_if_needed()
        .await
        .map_err(|e| e.to_string())?;

    let vault_status = state
        .repo
        .vault()
        .status()
        .await
        .map_err(|e| e.to_string())?;

    if vault_status.exists && !adopted {
        let compatible = engine
            .header_matches_backend()
            .await
            .map_err(|e| e.to_string())?;
        if !compatible {
            return Err(
                "this device already has a different vault; reset it before joining the \
                 synced vault"
                    .into(),
            );
        }
    }

    let _ = app.emit("vault-header-adopted", ());

    Ok(SyncJoinResultDto {
        adopted,
        vault_exists: vault_status.exists,
        status,
    })
}

#[tauri::command]
pub async fn sync_disable(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<SyncStatusDto, String> {
    apply_settings(
        &app,
        &state,
        SyncSettings {
            backend: SyncBackendConfig::Disabled,
        },
    )
    .await
}

#[tauri::command]
pub async fn sync_pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |folder| {
        let path = folder
            .and_then(|p| p.into_path().ok())
            .map(|p| p.display().to_string());
        let _ = tx.send(path);
    });
    rx.await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sync_now(state: State<'_, AppState>) -> Result<SyncReportDto, String> {
    let engine = {
        let guard = state.sync_engine.lock().await;
        guard
            .clone()
            .ok_or_else(|| "sync is not configured".to_string())?
    };
    let _ = engine
        .bootstrap_from_backend_if_needed()
        .await
        .map_err(|e| e.to_string())?;
    let report = engine.sync_now().await.map_err(|e| e.to_string())?;
    Ok(SyncReportDto::from(&report))
}

async fn apply_settings(
    app: &tauri::AppHandle,
    state: &AppState,
    settings: SyncSettings,
) -> Result<SyncStatusDto, String> {
    let data_dir = state.paths.data_dir();
    save_settings(&data_dir, &settings)?;
    *state.sync_settings.lock().await = settings.clone();
    let engine = build_engine(Arc::clone(state.repo.vault()), &settings);
    if let Some(ref engine) = engine {
        let _ = engine.bootstrap_from_backend_if_needed().await;
    }
    *state.sync_engine.lock().await = engine;
    let _ = app.emit("sync-status", sync_status_snapshot(state).await?);
    sync_status_snapshot(state).await
}

async fn sync_status_snapshot(state: &AppState) -> Result<SyncStatusDto, String> {
    let settings = state.sync_settings.lock().await.clone();
    if let Some(engine) = state.sync_engine.lock().await.as_ref() {
        let mut dto = SyncStatusDto::from(&engine.status().await);
        dto.detail = detail_for(&settings);
        return Ok(dto);
    }
    Ok(SyncStatusDto {
        configured: false,
        backend_kind: "disabled".into(),
        detail: None,
        last_cursor: None,
        last_synced_at: None,
        last_error: None,
        last_pulled: 0,
        last_pushed: 0,
        last_applied: 0,
    })
}
