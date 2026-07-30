//! SFTP browser sessions, remote file operations, and transfers.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use ssh_client_core::ssh::{RemoteFileType, SftpSession, TransferControl, TransferProgress};
use tauri::State;
use tauri::ipc::Channel;
use tokio::sync::Mutex;
use ts_rs::TS;
use uuid::Uuid;

use crate::local_fs::FileEntryDto;
use crate::{AppState, parse_uuid, redacted_error};

pub type SftpSessions = Arc<Mutex<HashMap<Uuid, SftpBrowserSession>>>;
pub type ActiveTransfers = Arc<Mutex<HashMap<Uuid, TransferControl>>>;

pub struct SftpBrowserSession {
    pub host_id: Uuid,
    pub session: Mutex<SftpSession>,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../ui/src/lib/generated/")]
pub struct TransferEvent {
    pub transfer_id: String,
    pub kind: String,
    pub bytes_transferred: u64,
    pub total_bytes: Option<u64>,
    pub message: Option<String>,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../ui/src/lib/generated/")]
pub struct SftpOpenResult {
    pub session_id: String,
    pub remote_path: String,
}

fn remote_entry_to_dto(
    name: String,
    parent: &str,
    file_type: RemoteFileType,
    size: Option<u64>,
    modified_unix: Option<u32>,
) -> FileEntryDto {
    let path = join_remote(parent, &name);
    FileEntryDto {
        name,
        path,
        file_type: remote_file_type(&file_type).into(),
        size,
        modified_unix: modified_unix.map(u64::from),
    }
}

fn remote_file_type(file_type: &RemoteFileType) -> &'static str {
    match file_type {
        RemoteFileType::Dir => "dir",
        RemoteFileType::Symlink => "symlink",
        RemoteFileType::File => "file",
        RemoteFileType::Other => "other",
    }
}

fn join_remote(parent: &str, name: &str) -> String {
    if parent.is_empty() || parent == "." {
        name.to_string()
    } else if parent.ends_with('/') {
        format!("{parent}{name}")
    } else {
        format!("{parent}/{name}")
    }
}

fn validate_remote_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name == "." || name == ".." || name.contains('/') {
        return Err("invalid remote name".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn local_home() -> Result<String, String> {
    crate::local_fs::local_home()
}

#[tauri::command]
pub async fn local_list(path: String) -> Result<Vec<FileEntryDto>, String> {
    crate::local_fs::local_list(path)
}

#[tauri::command]
pub async fn local_mkdir(path: String) -> Result<(), String> {
    crate::local_fs::local_mkdir(path)
}

#[tauri::command]
pub async fn local_rename(from: String, to: String) -> Result<(), String> {
    crate::local_fs::local_rename(from, to)
}

#[tauri::command]
pub async fn local_remove(path: String, recursive: bool) -> Result<(), String> {
    crate::local_fs::local_remove(path, recursive)
}

#[tauri::command]
pub async fn sftp_open(
    state: State<'_, AppState>,
    host_id: String,
) -> Result<SftpOpenResult, String> {
    crate::ensure_vault_unlocked(&state).await?;
    let host_id = parse_uuid(&host_id, "host")?;
    let session_id = Uuid::now_v7();
    let sftp = state.manager.sftp(host_id).await.map_err(redacted_error)?;
    let remote_path = sftp
        .canonicalize(".")
        .await
        .map_err(redacted_error)?
        .to_string_lossy()
        .into_owned();

    state.sftp_sessions.lock().await.insert(
        session_id,
        SftpBrowserSession {
            host_id,
            session: Mutex::new(sftp),
        },
    );

    Ok(SftpOpenResult {
        session_id: session_id.to_string(),
        remote_path,
    })
}

#[tauri::command]
pub async fn sftp_close(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    let session_id = parse_uuid(&session_id, "session")?;
    cancel_transfers_for_session(&state, session_id).await;
    let session = state
        .sftp_sessions
        .lock()
        .await
        .remove(&session_id)
        .ok_or_else(|| "SFTP session not found".to_string())?;
    let sftp = session.session.into_inner();
    sftp.close().await.map_err(redacted_error)
}

#[tauri::command]
pub async fn sftp_remote_list(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<Vec<FileEntryDto>, String> {
    let session_id = parse_uuid(&session_id, "session")?;
    let sessions = state.sftp_sessions.lock().await;
    let browser = sessions
        .get(&session_id)
        .ok_or_else(|| "SFTP session not found".to_string())?;
    let sftp = browser.session.lock().await;
    let entries = sftp.list(&path).await.map_err(redacted_error)?;
    let parent = if path.is_empty() { "." } else { path.as_str() };
    Ok(entries
        .into_iter()
        .map(|entry| {
            remote_entry_to_dto(
                entry.name,
                parent,
                entry.file_type,
                entry.size,
                entry.modified_unix,
            )
        })
        .collect())
}

#[tauri::command]
pub async fn sftp_remote_canonicalize(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<String, String> {
    let session_id = parse_uuid(&session_id, "session")?;
    let sessions = state.sftp_sessions.lock().await;
    let browser = sessions
        .get(&session_id)
        .ok_or_else(|| "SFTP session not found".to_string())?;
    let sftp = browser.session.lock().await;
    let resolved = sftp.canonicalize(&path).await.map_err(redacted_error)?;
    Ok(resolved.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn sftp_remote_mkdir(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<(), String> {
    let session_id = parse_uuid(&session_id, "session")?;
    let sessions = state.sftp_sessions.lock().await;
    let browser = sessions
        .get(&session_id)
        .ok_or_else(|| "SFTP session not found".to_string())?;
    let sftp = browser.session.lock().await;
    sftp.mkdir(&path).await.map_err(redacted_error)
}

#[tauri::command]
pub async fn sftp_remote_rename(
    state: State<'_, AppState>,
    session_id: String,
    from: String,
    to: String,
) -> Result<(), String> {
    let session_id = parse_uuid(&session_id, "session")?;
    let sessions = state.sftp_sessions.lock().await;
    let browser = sessions
        .get(&session_id)
        .ok_or_else(|| "SFTP session not found".to_string())?;
    let sftp = browser.session.lock().await;
    sftp.rename(&from, &to).await.map_err(redacted_error)
}

#[tauri::command]
pub async fn sftp_remote_remove(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
    file_type: String,
) -> Result<(), String> {
    if path == "." || path == ".." || path.is_empty() {
        return Err("invalid remove path".into());
    }
    let session_id = parse_uuid(&session_id, "session")?;
    let sessions = state.sftp_sessions.lock().await;
    let browser = sessions
        .get(&session_id)
        .ok_or_else(|| "SFTP session not found".to_string())?;
    let sftp = browser.session.lock().await;
    match file_type.as_str() {
        "dir" => sftp.remove_dir(&path).await.map_err(redacted_error),
        _ => sftp.remove_file(&path).await.map_err(redacted_error),
    }
}

#[tauri::command]
pub async fn sftp_remote_create_dir_entry(
    state: State<'_, AppState>,
    session_id: String,
    parent: String,
    name: String,
) -> Result<FileEntryDto, String> {
    validate_remote_name(&name)?;
    let path = join_remote(&parent, &name);
    sftp_remote_mkdir(state, session_id, path.clone()).await?;
    Ok(FileEntryDto {
        name,
        path,
        file_type: "dir".into(),
        size: None,
        modified_unix: None,
    })
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn sftp_transfer(
    state: State<'_, AppState>,
    session_id: String,
    transfer_id: String,
    direction: String,
    local_path: String,
    remote_path: String,
    offset: u64,
    progress: Channel<TransferEvent>,
) -> Result<u64, String> {
    crate::ensure_vault_unlocked(&state).await?;
    let session_id = parse_uuid(&session_id, "session")?;
    let transfer_id = parse_uuid(&transfer_id, "transfer")?;

    let host_id = {
        let sessions = state.sftp_sessions.lock().await;
        let browser = sessions
            .get(&session_id)
            .ok_or_else(|| "SFTP session not found".to_string())?;
        browser.host_id
    };

    let control = TransferControl::new();
    state
        .active_transfers
        .lock()
        .await
        .insert(transfer_id, control.clone());

    let emit = |kind: &str, bytes: u64, total: Option<u64>, message: Option<String>| {
        let _ = progress.send(TransferEvent {
            transfer_id: transfer_id.to_string(),
            kind: kind.into(),
            bytes_transferred: bytes,
            total_bytes: total,
            message,
        });
    };

    emit("started", offset, None, None);

    let local = PathBuf::from(local_path);
    let remote = remote_path;
    let manager = Arc::clone(&state.manager);
    let result = async {
        let sftp = manager.sftp(host_id).await.map_err(redacted_error)?;
        let on_progress = |p: TransferProgress| {
            emit("progress", p.bytes_transferred, p.total_bytes, None);
            Ok(())
        };
        match direction.as_str() {
            "upload" => sftp
                .put_with(&local, &remote, offset, &control, on_progress)
                .await
                .map_err(redacted_error),
            "download" => sftp
                .get_with(&remote, &local, offset, &control, on_progress)
                .await
                .map_err(redacted_error),
            _ => Err("invalid transfer direction".into()),
        }
    }
    .await;

    state.active_transfers.lock().await.remove(&transfer_id);

    match result {
        Ok(bytes) => {
            emit("completed", bytes, Some(bytes), None);
            Ok(bytes)
        }
        Err(error) if error == "transfer cancelled" => {
            let partial = partial_bytes(&direction, &local).await;
            emit("paused", partial, None, Some("transfer cancelled".into()));
            Err(error)
        }
        Err(error) => {
            emit("failed", offset, None, Some(error.clone()));
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn sftp_cancel_transfer(
    state: State<'_, AppState>,
    transfer_id: String,
) -> Result<(), String> {
    let transfer_id = parse_uuid(&transfer_id, "transfer")?;
    if let Some(control) = state.active_transfers.lock().await.get(&transfer_id) {
        control.cancel();
        Ok(())
    } else {
        Err("transfer not found".into())
    }
}

pub async fn close_all_sftp(state: &AppState) {
    for transfer in state.active_transfers.lock().await.values() {
        transfer.cancel();
    }
    state.active_transfers.lock().await.clear();

    let sessions = {
        let mut guard = state.sftp_sessions.lock().await;
        std::mem::take(&mut *guard)
    };
    for (_id, browser) in sessions {
        let sftp = browser.session.into_inner();
        let _ = sftp.close().await;
    }
}

async fn cancel_transfers_for_session(state: &AppState, session_id: Uuid) {
    let _ = session_id;
    for control in state.active_transfers.lock().await.values() {
        control.cancel();
    }
}

async fn partial_bytes(direction: &str, local: &Path) -> u64 {
    match direction {
        "upload" | "download" => tokio::fs::metadata(local)
            .await
            .map(|m| m.len())
            .unwrap_or(0),
        _ => 0,
    }
}

#[allow(dead_code)]
pub fn export_bindings(cfg: &ts_rs::Config) {
    FileEntryDto::export_all(cfg).expect("export FileEntryDto");
    TransferEvent::export_all(cfg).expect("export TransferEvent");
    SftpOpenResult::export_all(cfg).expect("export SftpOpenResult");
}
