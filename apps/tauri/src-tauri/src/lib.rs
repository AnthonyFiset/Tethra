#![forbid(unsafe_code)]

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use platform::AppPaths;
use serde::{Deserialize, Serialize};
use ssh_client_core::Result as CoreResult;
use ssh_client_core::model::{KnownHostKey, PtySize, SecretString};
use ssh_client_core::ssh::{
    Action, AlwaysApprove, ApprovalGate, HostKeyDecision, HostKeyPolicy, PresentedHostKey,
    PtyHandle, SessionManager,
};
use ssh_client_core::ssh_config::{
    SshConfigHost as CoreSshConfigHost, SshConfigPreview as CoreSshConfigPreview, parse_ssh_config,
};
use ssh_client_core::vault::{
    CreateHostRequest, HostSummary as CoreHostSummary, Vault, VaultRepository, VaultStatus,
};
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{Mutex, oneshot};
use ts_rs::TS;
use uuid::Uuid;

mod app_menu;
mod local_fs;
mod output_pump;
mod sftp;
mod sync;
mod updater;

const IDLE_CHECK: Duration = Duration::from_secs(30);

type Sessions = Arc<Mutex<HashMap<Uuid, PtyHandle>>>;
type LocalSessions = Arc<Mutex<HashMap<Uuid, Box<dyn platform::LocalPtySession>>>>;

pub(crate) struct AppState {
    paths: Arc<dyn platform::AppPaths>,
    repo: Arc<VaultRepository>,
    manager: Arc<SessionManager>,
    sessions: Sessions,
    local_pty: Arc<dyn platform::LocalPty>,
    local_sessions: LocalSessions,
    approval_gate: Arc<dyn ApprovalGate>,
    sftp_sessions: sftp::SftpSessions,
    active_transfers: sftp::ActiveTransfers,
    prompts: Arc<PromptBroker>,
    sync_settings: Arc<Mutex<sync::SyncSettings>>,
    sync_engine: Arc<Mutex<Option<Arc<ssh_client_core::sync::SyncEngine>>>>,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../ui/src/lib/generated/")]
struct HostSummaryDto {
    id: String,
    label: String,
    hostname: String,
    port: u16,
    username: String,
    has_password: bool,
    color: Option<String>,
}

impl From<&CoreHostSummary> for HostSummaryDto {
    fn from(host: &CoreHostSummary) -> Self {
        Self {
            id: host.id.to_string(),
            label: host.label.clone(),
            hostname: host.hostname.clone(),
            port: host.port,
            username: host.username.clone(),
            has_password: host.has_password,
            color: host.color.clone(),
        }
    }
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../ui/src/lib/generated/")]
struct VaultStatusDto {
    exists: bool,
    unlocked: bool,
    recovery_available: bool,
}

impl From<&VaultStatus> for VaultStatusDto {
    fn from(status: &VaultStatus) -> Self {
        Self {
            exists: status.exists,
            unlocked: status.unlocked,
            recovery_available: status.recovery_available,
        }
    }
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../ui/src/lib/generated/")]
struct SshConfigHostDto {
    alias: String,
    hostname: String,
    port: u16,
    username: String,
    proxy_jump: Option<String>,
    has_identity_file: bool,
}

impl From<&CoreSshConfigHost> for SshConfigHostDto {
    fn from(host: &CoreSshConfigHost) -> Self {
        Self {
            alias: host.alias.clone(),
            hostname: host.hostname.clone(),
            port: host.port,
            username: host.username.clone(),
            proxy_jump: host.proxy_jump.clone(),
            has_identity_file: host.has_identity_file,
        }
    }
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../ui/src/lib/generated/")]
struct SshConfigPreviewDto {
    hosts: Vec<SshConfigHostDto>,
    warnings: Vec<String>,
}

impl From<&CoreSshConfigPreview> for SshConfigPreviewDto {
    fn from(preview: &CoreSshConfigPreview) -> Self {
        Self {
            hosts: preview.hosts.iter().map(SshConfigHostDto::from).collect(),
            warnings: preview.warnings.clone(),
        }
    }
}

#[derive(Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../ui/src/lib/generated/")]
struct HostKeyPrompt {
    prompt_id: String,
    host_id: String,
    algorithm: String,
    fingerprint: String,
}

#[derive(Clone, Serialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export, export_to = "../../../ui/src/lib/generated/")]
pub(crate) enum TerminalEvent {
    Data { data: Vec<u8>, dropped: bool },
    Closed,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostMutation {
    label: String,
    hostname: String,
    port: u16,
    username: String,
    password: Option<String>,
    color: Option<String>,
}

struct PromptBroker {
    app: AppHandle,
    pending: Mutex<HashMap<Uuid, oneshot::Sender<bool>>>,
}

impl PromptBroker {
    async fn respond(&self, prompt_id: Uuid, accepted: bool) -> Result<(), String> {
        let sender = self
            .pending
            .lock()
            .await
            .remove(&prompt_id)
            .ok_or_else(|| "host-key prompt expired or was already answered".to_string())?;
        sender
            .send(accepted)
            .map_err(|_| "connection no longer awaits this prompt".to_string())
    }

    async fn clear(&self) {
        self.pending.lock().await.clear();
    }
}

#[async_trait]
impl HostKeyPolicy for PromptBroker {
    async fn decide(
        &self,
        host_id: Uuid,
        presented: &PresentedHostKey,
        _known: Option<&KnownHostKey>,
    ) -> CoreResult<HostKeyDecision> {
        let prompt_id = Uuid::now_v7();
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(prompt_id, tx);

        let payload = HostKeyPrompt {
            prompt_id: prompt_id.to_string(),
            host_id: host_id.to_string(),
            algorithm: presented.algorithm.clone(),
            fingerprint: format!("SHA256:{}", presented.fingerprint_sha256),
        };

        if self.app.emit("host-key-prompt", payload).is_err() {
            self.pending.lock().await.remove(&prompt_id);
            return Ok(HostKeyDecision::Reject);
        }

        let accepted = tokio::time::timeout(Duration::from_secs(60), rx)
            .await
            .ok()
            .and_then(|result| result.ok())
            .unwrap_or(false);
        self.pending.lock().await.remove(&prompt_id);

        Ok(if accepted {
            HostKeyDecision::AcceptAndRemember
        } else {
            HostKeyDecision::Reject
        })
    }
}

#[tauri::command]
async fn vault_status(state: State<'_, AppState>) -> Result<VaultStatusDto, String> {
    let status = state.repo.vault().status().await.map_err(redacted_error)?;
    Ok(VaultStatusDto::from(&status))
}

#[tauri::command]
async fn vault_create(
    app: AppHandle,
    state: State<'_, AppState>,
    password: String,
    enable_recovery: bool,
) -> Result<VaultStatusDto, String> {
    let secret = SecretString::new(password);
    let status = state
        .repo
        .vault()
        .create(&secret, enable_recovery)
        .await
        .map_err(redacted_error)?;
    let dto = VaultStatusDto::from(&status);
    let _ = app.emit("vault-status", dto.clone());
    Ok(dto)
}

#[tauri::command]
async fn vault_unlock(
    app: AppHandle,
    state: State<'_, AppState>,
    password: String,
) -> Result<VaultStatusDto, String> {
    let secret = SecretString::new(password);
    let status = state
        .repo
        .vault()
        .unlock(&secret)
        .await
        .map_err(redacted_error)?;
    let dto = VaultStatusDto::from(&status);
    let _ = app.emit("vault-status", dto.clone());
    Ok(dto)
}

#[tauri::command]
async fn vault_recover(
    app: AppHandle,
    state: State<'_, AppState>,
    new_password: String,
) -> Result<VaultStatusDto, String> {
    let secret = SecretString::new(new_password);
    let status = state
        .repo
        .vault()
        .recover_with_new_password(&secret)
        .await
        .map_err(redacted_error)?;
    let dto = VaultStatusDto::from(&status);
    let _ = app.emit("vault-status", dto.clone());
    Ok(dto)
}

#[tauri::command]
async fn vault_change_password(
    state: State<'_, AppState>,
    current_password: String,
    new_password: String,
) -> Result<(), String> {
    state
        .repo
        .vault()
        .change_password(
            &SecretString::new(current_password),
            &SecretString::new(new_password),
        )
        .await
        .map_err(redacted_error)
}

#[tauri::command]
async fn vault_lock(app: AppHandle, state: State<'_, AppState>) -> Result<VaultStatusDto, String> {
    lock_vault(&app, &state).await
}

#[tauri::command]
async fn list_hosts(state: State<'_, AppState>) -> Result<Vec<HostSummaryDto>, String> {
    let hosts = state.repo.list_hosts().await.map_err(redacted_error)?;
    Ok(hosts.iter().map(HostSummaryDto::from).collect())
}

#[tauri::command]
async fn preview_ssh_config(state: State<'_, AppState>) -> Result<SshConfigPreviewDto, String> {
    ensure_vault_unlocked(&state).await?;
    let contents = load_default_ssh_config()?;
    let preview = parse_ssh_config(&contents).map_err(redacted_error)?;
    Ok(SshConfigPreviewDto::from(&preview))
}

#[tauri::command]
async fn import_ssh_config(
    state: State<'_, AppState>,
    aliases: Vec<String>,
) -> Result<Vec<HostSummaryDto>, String> {
    ensure_vault_unlocked(&state).await?;
    let contents = load_default_ssh_config()?;
    let imported = state
        .repo
        .import_ssh_config(&contents, &aliases)
        .await
        .map_err(redacted_error)?;
    Ok(imported.iter().map(HostSummaryDto::from).collect())
}

#[tauri::command]
async fn create_host(
    state: State<'_, AppState>,
    host: HostMutation,
) -> Result<HostSummaryDto, String> {
    let created = state
        .repo
        .create_host(CreateHostRequest {
            label: host.label,
            hostname: host.hostname,
            port: host.port,
            username: host.username,
            password: host.password.map(SecretString::new),
            color: host.color,
        })
        .await
        .map_err(redacted_error)?;
    Ok(HostSummaryDto::from(&created))
}

#[tauri::command]
async fn update_host(
    state: State<'_, AppState>,
    id: String,
    host: HostMutation,
) -> Result<HostSummaryDto, String> {
    let host_id = parse_uuid(&id, "host")?;
    let updated = state
        .repo
        .update_host(
            host_id,
            CreateHostRequest {
                label: host.label,
                hostname: host.hostname,
                port: host.port,
                username: host.username,
                password: host.password.map(SecretString::new),
                color: host.color,
            },
        )
        .await
        .map_err(redacted_error)?;
    Ok(HostSummaryDto::from(&updated))
}

#[tauri::command]
async fn delete_host(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let host_id = parse_uuid(&id, "host")?;
    state
        .repo
        .delete_host(host_id)
        .await
        .map_err(redacted_error)
}

pub(crate) async fn ensure_vault_unlocked(state: &AppState) -> Result<(), String> {
    if state
        .repo
        .vault()
        .is_unlocked()
        .await
        .map_err(redacted_error)?
    {
        Ok(())
    } else {
        Err("vault is locked".into())
    }
}

fn load_default_ssh_config() -> Result<String, String> {
    platform_desktop::read_default_ssh_config()
        .map_err(|_| "could not read ~/.ssh/config".to_string())?
        .ok_or_else(|| "no SSH config found at ~/.ssh/config".to_string())
}

#[tauri::command]
async fn open_terminal(
    state: State<'_, AppState>,
    host_id: String,
    cols: u32,
    rows: u32,
    output: Channel<TerminalEvent>,
) -> Result<String, String> {
    if !state
        .repo
        .vault()
        .is_unlocked()
        .await
        .map_err(redacted_error)?
    {
        return Err("vault is locked".into());
    }
    let host_id = parse_uuid(&host_id, "host")?;
    let session_id = Uuid::now_v7();
    let (handle, receiver) = state
        .manager
        .open_pty(host_id, PtySize::new(cols, rows))
        .await
        .map_err(redacted_error)?;

    state.sessions.lock().await.insert(session_id, handle);
    tauri::async_runtime::spawn(output_pump::forward_output(receiver, output));
    Ok(session_id.to_string())
}

#[tauri::command]
async fn open_local_terminal(
    state: State<'_, AppState>,
    cols: u32,
    rows: u32,
    output: Channel<TerminalEvent>,
) -> Result<String, String> {
    let spec = state
        .local_pty
        .default_shell()
        .ok_or_else(|| "no local shell is available".to_string())?;
    state
        .approval_gate
        .approve(&Action::OpenLocalPty {
            program: spec.program.to_string_lossy().into_owned(),
        })
        .await
        .map_err(redacted_error)?;

    let (handle, receiver) = state
        .local_pty
        .spawn(spec, platform::PtySize::new(cols, rows))
        .map_err(|error| error.to_string())?;
    let session_id = Uuid::now_v7();
    state.local_sessions.lock().await.insert(session_id, handle);
    tauri::async_runtime::spawn(output_pump::forward_output(receiver, output));
    Ok(session_id.to_string())
}

#[tauri::command]
async fn terminal_input(
    state: State<'_, AppState>,
    session_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    let session_id = parse_uuid(&session_id, "session")?;
    {
        let mut sessions = state.sessions.lock().await;
        if let Some(handle) = sessions.get_mut(&session_id) {
            return handle.write(&data).await.map_err(redacted_error);
        }
    }
    let mut sessions = state.local_sessions.lock().await;
    let handle = sessions
        .get_mut(&session_id)
        .ok_or_else(|| "terminal session not found".to_string())?;
    handle.write(&data).map_err(|error| error.to_string())
}

#[tauri::command]
async fn resize_terminal(
    state: State<'_, AppState>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    let session_id = parse_uuid(&session_id, "session")?;
    {
        let mut sessions = state.sessions.lock().await;
        if let Some(handle) = sessions.get_mut(&session_id) {
            return handle
                .resize(PtySize::new(cols, rows))
                .await
                .map_err(redacted_error);
        }
    }
    let mut sessions = state.local_sessions.lock().await;
    let handle = sessions
        .get_mut(&session_id)
        .ok_or_else(|| "terminal session not found".to_string())?;
    handle
        .resize(platform::PtySize::new(cols, rows))
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn close_terminal(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    let session_id = parse_uuid(&session_id, "session")?;
    if let Some(handle) = state.sessions.lock().await.remove(&session_id) {
        return handle.close().await.map_err(redacted_error);
    }
    let handle = state
        .local_sessions
        .lock()
        .await
        .remove(&session_id)
        .ok_or_else(|| "terminal session not found".to_string())?;
    tokio::task::spawn_blocking(move || handle.close())
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn respond_host_key(
    state: State<'_, AppState>,
    prompt_id: String,
    accepted: bool,
) -> Result<(), String> {
    let prompt_id = parse_uuid(&prompt_id, "prompt")?;
    state.prompts.respond(prompt_id, accepted).await
}

async fn lock_vault(app: &AppHandle, state: &AppState) -> Result<VaultStatusDto, String> {
    // Close all SSH sessions before zeroizing vault keys.
    let sessions = {
        let mut guard = state.sessions.lock().await;
        std::mem::take(&mut *guard)
    };
    for (_id, handle) in sessions {
        let _ = handle.close().await;
    }
    sftp::close_all_sftp(state).await;
    state.prompts.clear().await;
    state.repo.vault().lock().await.map_err(redacted_error)?;
    let status = state.repo.vault().status().await.map_err(redacted_error)?;
    let dto = VaultStatusDto::from(&status);
    let _ = app.emit("vault-status", dto.clone());
    let _ = app.emit("vault-locked", ());
    Ok(dto)
}

pub(crate) fn parse_uuid(value: &str, kind: &str) -> Result<Uuid, String> {
    Uuid::parse_str(value).map_err(|_| format!("invalid {kind} id"))
}

pub(crate) fn redacted_error(error: ssh_client_core::Error) -> String {
    match error {
        ssh_client_core::Error::AuthenticationFailed => "authentication failed".to_string(),
        ssh_client_core::Error::IncorrectPassword => "incorrect master password".to_string(),
        ssh_client_core::Error::VaultLocked => "vault is locked".to_string(),
        ssh_client_core::Error::VaultAlreadyExists => "vault already exists".to_string(),
        ssh_client_core::Error::VaultNotFound => "vault does not exist".to_string(),
        ssh_client_core::Error::RecoveryUnavailable => "vault recovery is unavailable".to_string(),
        ssh_client_core::Error::TransferCancelled => "transfer cancelled".to_string(),
        ssh_client_core::Error::HostKeyMismatch { .. } => {
            "host key changed; connection refused".to_string()
        }
        ssh_client_core::Error::HostKeyRejected => "host key was not accepted".to_string(),
        _ => error.to_string(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .with_target(false)
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            app.set_menu(app_menu::build(app)?)?;
            let paths = Arc::new(
                platform_desktop::DesktopAppPaths::new()
                    .map_err(|e| std::io::Error::other(e.to_string()))?,
            );
            let sync_settings = sync::load_settings(&paths.data_dir());
            let secrets: Arc<dyn platform::SecretStore> =
                Arc::new(platform_desktop::KeyringSecretStore::new());
            let vault = Arc::new(
                Vault::open(
                    Arc::clone(&paths) as Arc<dyn platform::AppPaths>,
                    Arc::clone(&secrets),
                )
                .map_err(|e| std::io::Error::other(e.to_string()))?,
            );
            let sync_engine = sync::build_engine(Arc::clone(&vault), &sync_settings);
            let repo = Arc::new(VaultRepository::new(Arc::clone(&vault)));

            // A device that has sync configured but no vault yet (fresh install
            // or a reset) adopts the shared header so the same master password
            // unlocks the synced rows.
            if let Some(engine) = sync_engine.clone() {
                let boot_app = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    match engine.bootstrap_from_backend_if_needed().await {
                        Ok(true) => {
                            tracing::info!("adopted synced vault header");
                            let _ = boot_app.emit("vault-header-adopted", ());
                        }
                        Ok(false) => {}
                        Err(err) => tracing::warn!(%err, "sync bootstrap failed"),
                    }
                });
            }
            let prompts = Arc::new(PromptBroker {
                app: app_handle.clone(),
                pending: Mutex::new(HashMap::new()),
            });
            let approval_gate: Arc<dyn ApprovalGate> = Arc::new(AlwaysApprove);
            let manager = Arc::new(SessionManager::new(
                Arc::clone(&repo) as Arc<dyn ssh_client_core::ssh::HostStore>,
                Arc::clone(&repo) as Arc<dyn ssh_client_core::ssh::AuthProvider>,
                Arc::clone(&prompts) as Arc<dyn HostKeyPolicy>,
                Arc::clone(&approval_gate),
            ));

            let sessions: Sessions = Arc::new(Mutex::new(HashMap::new()));
            let local_pty: Arc<dyn platform::LocalPty> =
                Arc::new(platform_desktop::DesktopLocalPty);
            let local_sessions: LocalSessions = Arc::new(Mutex::new(HashMap::new()));
            let sftp_sessions = Arc::new(Mutex::new(HashMap::new()));
            let active_transfers = Arc::new(Mutex::new(HashMap::new()));
            app.manage(AppState {
                paths: Arc::clone(&paths) as Arc<dyn platform::AppPaths>,
                repo: Arc::clone(&repo),
                manager,
                sessions: Arc::clone(&sessions),
                local_pty,
                local_sessions,
                approval_gate,
                sftp_sessions: Arc::clone(&sftp_sessions),
                active_transfers: Arc::clone(&active_transfers),
                prompts: Arc::clone(&prompts),
                sync_settings: Arc::new(Mutex::new(sync_settings)),
                sync_engine: Arc::new(Mutex::new(sync_engine)),
            });

            // Periodic idle-lock watcher.
            let idle_app = app_handle.clone();
            let idle_vault = Arc::clone(&vault);
            let idle_sessions = Arc::clone(&sessions);
            let idle_sftp_sessions = Arc::clone(&sftp_sessions);
            let idle_active_transfers = Arc::clone(&active_transfers);
            let idle_prompts = Arc::clone(&prompts);
            tauri::async_runtime::spawn(async move {
                let mut ticker = tokio::time::interval(IDLE_CHECK);
                loop {
                    ticker.tick().await;
                    if idle_vault.is_unlocked().await.unwrap_or(false) {
                        continue;
                    }
                    // Vault auto-locked via idle timeout inside status/is_unlocked.
                    let sessions = {
                        let mut guard = idle_sessions.lock().await;
                        std::mem::take(&mut *guard)
                    };
                    let had_sessions = !sessions.is_empty();
                    if !sessions.is_empty() {
                        for (_id, handle) in sessions {
                            let _ = handle.close().await;
                        }
                    }
                    for transfer in idle_active_transfers.lock().await.values() {
                        transfer.cancel();
                    }
                    idle_active_transfers.lock().await.clear();
                    let sftp_taken = {
                        let mut guard = idle_sftp_sessions.lock().await;
                        std::mem::take(&mut *guard)
                    };
                    let had_sftp = !sftp_taken.is_empty();
                    for (_id, browser) in sftp_taken {
                        let sftp = browser.session.into_inner();
                        let _ = sftp.close().await;
                    }
                    if had_sessions || had_sftp {
                        idle_prompts.clear().await;
                        let status = idle_vault.status().await.unwrap_or(VaultStatus {
                            exists: true,
                            unlocked: false,
                            recovery_available: false,
                        });
                        let _ = idle_app.emit("vault-status", VaultStatusDto::from(&status));
                        let _ = idle_app.emit("vault-locked", ());
                    }
                }
            });

            // Best-effort power monitor → lock.
            let power = platform_desktop::DesktopPowerMonitor;
            if platform::PowerMonitor::is_available(&power)
                && let Ok(rx) = platform::PowerMonitor::subscribe(&power)
            {
                let power_app = app_handle.clone();
                let power_vault = Arc::clone(&vault);
                let power_sessions = Arc::clone(&sessions);
                let power_sftp_sessions = Arc::clone(&sftp_sessions);
                let power_active_transfers = Arc::clone(&active_transfers);
                let power_prompts = Arc::clone(&prompts);
                std::thread::spawn(move || {
                    while let Ok(event) = rx.recv() {
                        if matches!(
                            event,
                            platform::PowerEvent::Suspend | platform::PowerEvent::ScreenLocked
                        ) {
                            let app = power_app.clone();
                            let vault = Arc::clone(&power_vault);
                            let sessions = Arc::clone(&power_sessions);
                            let sftp_sessions = Arc::clone(&power_sftp_sessions);
                            let active_transfers = Arc::clone(&power_active_transfers);
                            let prompts = Arc::clone(&power_prompts);
                            tauri::async_runtime::block_on(async move {
                                let taken = {
                                    let mut guard = sessions.lock().await;
                                    std::mem::take(&mut *guard)
                                };
                                for (_id, handle) in taken {
                                    let _ = handle.close().await;
                                }
                                for transfer in active_transfers.lock().await.values() {
                                    transfer.cancel();
                                }
                                active_transfers.lock().await.clear();
                                let sftp_taken = {
                                    let mut guard = sftp_sessions.lock().await;
                                    std::mem::take(&mut *guard)
                                };
                                for (_id, browser) in sftp_taken {
                                    let sftp = browser.session.into_inner();
                                    let _ = sftp.close().await;
                                }
                                prompts.clear().await;
                                let _ = vault.lock().await;
                                if let Ok(status) = vault.status().await {
                                    let _ = app.emit("vault-status", VaultStatusDto::from(&status));
                                    let _ = app.emit("vault-locked", ());
                                }
                            });
                        }
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            vault_status,
            vault_create,
            vault_unlock,
            vault_recover,
            vault_change_password,
            vault_lock,
            list_hosts,
            preview_ssh_config,
            import_ssh_config,
            create_host,
            update_host,
            delete_host,
            open_terminal,
            open_local_terminal,
            terminal_input,
            resize_terminal,
            close_terminal,
            respond_host_key,
            sftp::local_home,
            sftp::local_list,
            sftp::local_mkdir,
            sftp::local_rename,
            sftp::local_remove,
            sftp::sftp_open,
            sftp::sftp_close,
            sftp::sftp_remote_list,
            sftp::sftp_remote_canonicalize,
            sftp::sftp_remote_mkdir,
            sftp::sftp_remote_rename,
            sftp::sftp_remote_remove,
            sftp::sftp_remote_create_dir_entry,
            sftp::sftp_transfer,
            sftp::sftp_cancel_transfer,
            sync::sync_status,
            sync::sync_configure_file,
            sync::sync_configure_http,
            sync::sync_disable,
            sync::sync_pick_folder,
            sync::sync_join_http,
            sync::sync_now,
            updater::update_check,
            updater::update_install,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use ssh_client_core::model::SecretString;

    #[test]
    fn export_bindings() {
        let cfg = ts_rs::Config::default();
        HostSummaryDto::export_all(&cfg).unwrap();
        VaultStatusDto::export_all(&cfg).unwrap();
        SshConfigHostDto::export_all(&cfg).unwrap();
        SshConfigPreviewDto::export_all(&cfg).unwrap();
        HostKeyPrompt::export_all(&cfg).unwrap();
        TerminalEvent::export_all(&cfg).unwrap();
        sync::SyncStatusDto::export_all(&cfg).unwrap();
        sync::SyncReportDto::export_all(&cfg).unwrap();
        sync::SyncJoinResultDto::export_all(&cfg).unwrap();
        updater::UpdateInfoDto::export_all(&cfg).unwrap();
        sftp::export_bindings(&cfg);
    }

    #[test]
    fn redacted_errors_hide_internal_variants() {
        assert_eq!(
            redacted_error(ssh_client_core::Error::IncorrectPassword),
            "incorrect master password"
        );
        assert_eq!(
            redacted_error(ssh_client_core::Error::VaultLocked),
            "vault is locked"
        );
        assert_eq!(
            redacted_error(ssh_client_core::Error::RecoveryUnavailable),
            "vault recovery is unavailable"
        );
    }

    #[test]
    fn dto_status_exposes_no_secrets() {
        let status = VaultStatusDto {
            exists: true,
            unlocked: false,
            recovery_available: true,
        };
        assert!(status.exists);
        assert!(!status.unlocked);
        assert!(status.recovery_available);
        let debug = format!("{status:?}");
        assert!(!debug.to_lowercase().contains("password"));
    }

    #[test]
    fn host_dto_never_embeds_password() {
        let dto = HostSummaryDto {
            id: "id".into(),
            label: "lab".into(),
            hostname: "127.0.0.1".into(),
            port: 22,
            username: "user".into(),
            has_password: true,
            color: Some("#70A5F5".into()),
        };
        assert!(dto.has_password);
        let debug = format!("{dto:?}");
        assert!(!debug.contains("testpass"));
        assert!(!debug.contains("must-not-leak"));
        let _ = SecretString::new("must-not-leak");
    }
}
