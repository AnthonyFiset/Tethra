//! Self-update from GitHub Releases (`latest.json`).
//!
//! Payloads are minisign-verified against `plugins.updater.pubkey`. The old
//! sync-host update mirror is retired — vault sync HTTP is unrelated.

use serde::Serialize;
use tauri::State;
use tauri_plugin_updater::UpdaterExt;
use ts_rs::TS;

use crate::AppState;

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

fn build_updater(app: &tauri::AppHandle) -> Result<tauri_plugin_updater::Updater, String> {
    // Endpoints come from tauri.conf.json → plugins.updater.endpoints
    // (GitHub Releases latest.json).
    app.updater_builder()
        .build()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_check(
    app: tauri::AppHandle,
    _state: State<'_, AppState>,
) -> Result<UpdateInfoDto, String> {
    let current_version = app.package_info().version.to_string();

    // Dev / `tauri dev` builds must not prompt to install a release.
    if cfg!(debug_assertions) {
        return Ok(UpdateInfoDto {
            available: false,
            current_version,
            version: None,
            notes: None,
            pub_date: None,
        });
    }

    let updater = build_updater(&app)?;

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
    _state: State<'_, AppState>,
) -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Err("updates are disabled in development builds".into());
    }

    let updater = build_updater(&app)?;
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
