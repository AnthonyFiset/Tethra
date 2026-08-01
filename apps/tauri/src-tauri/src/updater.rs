//! Self-update against the same server that hosts vault sync.
//!
//! Updates are minisign-verified by the updater plugin, so the transport only
//! needs to be reachable — on a tailnet that is the ThinkPad sync server the
//! user already configured. Deriving the endpoint from the sync settings keeps
//! update delivery zero-config.

use serde::Serialize;
use tauri::State;
use tauri_plugin_updater::UpdaterExt;
use ts_rs::TS;

use crate::AppState;
use crate::sync::{SyncBackendConfig, SyncSettings};

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../ui/src/lib/generated/")]
pub struct UpdateInfoDto {
    pub available: bool,
    pub current_version: String,
    pub version: Option<String>,
    pub notes: Option<String>,
    pub pub_date: Option<String>,
}

/// `http://host:8787` → `http://host:8787/updates/{{target}}/{{arch}}/{{current_version}}`
fn endpoint_for(settings: &SyncSettings) -> Option<String> {
    match &settings.backend {
        SyncBackendConfig::Http { url, .. } => {
            let base = url.trim_end_matches('/');
            Some(format!(
                "{base}/updates/{{{{target}}}}/{{{{arch}}}}/{{{{current_version}}}}"
            ))
        }
        _ => None,
    }
}

async fn build_updater(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
) -> Result<tauri_plugin_updater::Updater, String> {
    let endpoint = {
        let settings = state.sync_settings.lock().await;
        endpoint_for(&settings)
    }
    .ok_or_else(|| {
        "updates come from your sync server — configure Vault sync with an HTTP server first"
            .to_string()
    })?;

    let url = endpoint
        .parse()
        .map_err(|e| format!("bad update URL: {e}"))?;
    app.updater_builder()
        .endpoints(vec![url])
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_check(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<UpdateInfoDto, String> {
    let current_version = app.package_info().version.to_string();

    // Dev / `tauri dev` builds must not prompt to install a release — that
    // only makes sense for packaged installs that came from the update mirror.
    if cfg!(debug_assertions) {
        return Ok(UpdateInfoDto {
            available: false,
            current_version,
            version: None,
            notes: None,
            pub_date: None,
        });
    }

    let updater = build_updater(&app, &state).await?;

    match updater.check().await.map_err(|e| e.to_string())? {
        Some(update) => Ok(UpdateInfoDto {
            available: true,
            current_version,
            version: Some(update.version.clone()),
            notes: update.body.clone(),
            pub_date: update.date.map(|d| d.to_string()),
        }),
        None => Ok(UpdateInfoDto {
            available: false,
            current_version,
            version: None,
            notes: None,
            pub_date: None,
        }),
    }
}

/// Download, install, and restart. Returns only on failure.
#[tauri::command]
pub async fn update_install(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Err("updates are disabled in development builds".into());
    }

    let updater = build_updater(&app, &state).await?;
    let update = updater
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "already up to date".to_string())?;

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;

    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_is_derived_from_sync_server() {
        let settings = SyncSettings {
            backend: SyncBackendConfig::Http {
                url: "http://thinkpad:8787/".into(),
                token: None,
            },
        };
        assert_eq!(
            endpoint_for(&settings).unwrap(),
            "http://thinkpad:8787/updates/{{target}}/{{arch}}/{{current_version}}"
        );
    }

    #[test]
    fn no_endpoint_without_http_backend() {
        assert!(
            endpoint_for(&SyncSettings {
                backend: SyncBackendConfig::Disabled,
            })
            .is_none()
        );
        assert!(
            endpoint_for(&SyncSettings {
                backend: SyncBackendConfig::File {
                    path: "/tmp".into()
                },
            })
            .is_none()
        );
    }
}
