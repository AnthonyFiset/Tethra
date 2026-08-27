#![forbid(unsafe_code)]

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::AtomicU64;
use std::time::Duration;

use async_trait::async_trait;
use platform::AppPaths;
use serde::{Deserialize, Serialize};
use ssh_client_core::Result as CoreResult;
use ssh_client_core::model::{KnownHostKey, ProjectLocation, PtySize, SecretString};
use ssh_client_core::ssh::{
    Action, AlwaysApprove, ApprovalGate, HostKeyDecision, HostKeyPolicy, PresentedHostKey,
    PtyHandle, SessionManager,
};
use ssh_client_core::ssh_config::{
    SshConfigHost as CoreSshConfigHost, SshConfigPreview as CoreSshConfigPreview, parse_ssh_config,
};
use ssh_client_core::vault::{
    CreateHostRequest, CreateProjectRequest, HostSummary as CoreHostSummary,
    IdentityDeleteResult as CoreIdentityDeleteResult, IdentitySummary as CoreIdentitySummary,
    ProjectSummary as CoreProjectSummary, RunningSessionSummary as CoreRunningSessionSummary,
    Vault, VaultRepository, VaultStatus,
};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::{Mutex, oneshot};
use ts_rs::TS;
use uuid::Uuid;

mod accent;
mod app_menu;
mod assist;
mod local_fs;
mod materials;
mod mux;
mod output_pump;
mod sftp;
mod shell_integration;
mod sync;
mod tunnel;
mod updater;
mod webview_chrome;

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
    pub(crate) approval_gate: Arc<dyn ApprovalGate>,
    sftp_sessions: sftp::SftpSessions,
    active_transfers: sftp::ActiveTransfers,
    tunnels: tunnel::TunnelRuntimes,
    session_hosts: tunnel::SessionHosts,
    prompts: Arc<PromptBroker>,
    sync_settings: Arc<Mutex<sync::SyncSettings>>,
    sync_engine: Arc<Mutex<Option<Arc<ssh_client_core::sync::SyncEngine>>>>,
    http_backend: Arc<Mutex<Option<Arc<ssh_client_core::sync::HttpBackend>>>>,
    background_sync_gen: Arc<AtomicU64>,
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
    identity_id: Option<String>,
    /// `password` | `sshKey` | `none`
    auth_kind: String,
    sync_secret: bool,
    color: Option<String>,
    tags: Vec<String>,
    /// When true, inject OSC 133 / OSC 7 via connect wrapper.
    shell_integration: bool,
    tunnels: Vec<tunnel::TunnelDefinitionDto>,
    /// Opt-in SSH agent forwarding (`ssh -A`).
    forward_agent: bool,
    /// Authenticate with the machine's default SSH keys (~/.ssh/id_*).
    use_default_keys: bool,
    /// ISO-8601 UTC of last successful terminal open, when known.
    last_connected_at: Option<String>,
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
            identity_id: host.identity_id.map(|id| id.to_string()),
            auth_kind: host.auth_kind.clone(),
            sync_secret: host.sync_secret,
            color: host.color.clone(),
            tags: host.tags.clone(),
            shell_integration: host.shell_integration
                != ssh_client_core::model::ShellIntegration::Disabled,
            tunnels: host
                .tunnels
                .iter()
                .map(tunnel::TunnelDefinitionDto::from)
                .collect(),
            forward_agent: host.forward_agent,
            use_default_keys: host.use_default_keys,
            last_connected_at: host.last_connected_at.map(|ts| ts.to_rfc3339()),
        }
    }
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../ui/src/lib/generated/")]
struct IdentitySummaryDto {
    id: String,
    label: String,
    kind: String,
    fingerprint: Option<String>,
    usage_count: u32,
    created_at: Option<String>,
    sync_secret: bool,
}

impl From<&CoreIdentitySummary> for IdentitySummaryDto {
    fn from(identity: &CoreIdentitySummary) -> Self {
        Self {
            id: identity.id.to_string(),
            label: identity.label.clone(),
            kind: identity.kind.clone(),
            fingerprint: identity.fingerprint.clone(),
            usage_count: identity.usage_count,
            created_at: identity.created_at.map(|ts| ts.to_rfc3339()),
            sync_secret: identity.sync_secret,
        }
    }
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../ui/src/lib/generated/")]
struct DependentHostDto {
    id: String,
    label: String,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../ui/src/lib/generated/")]
struct IdentityDeleteResultDto {
    deleted: bool,
    dependent_hosts: Vec<DependentHostDto>,
}

impl From<&CoreIdentityDeleteResult> for IdentityDeleteResultDto {
    fn from(result: &CoreIdentityDeleteResult) -> Self {
        Self {
            deleted: result.deleted,
            dependent_hosts: result
                .dependent_hosts
                .iter()
                .map(|(id, label)| DependentHostDto {
                    id: id.to_string(),
                    label: label.clone(),
                })
                .collect(),
        }
    }
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../ui/src/lib/generated/")]
struct IdentityProbeDto {
    encrypted: bool,
    fingerprint: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export, export_to = "../../../ui/src/lib/generated/")]
enum ProjectLocationDto {
    Local {
        path: String,
    },
    #[allow(non_snake_case)]
    Remote {
        hostId: String,
        path: String,
    },
}

impl From<&ProjectLocation> for ProjectLocationDto {
    fn from(location: &ProjectLocation) -> Self {
        match location {
            ProjectLocation::Local { path } => Self::Local { path: path.clone() },
            ProjectLocation::Remote { host_id, path } => Self::Remote {
                hostId: host_id.to_string(),
                path: path.clone(),
            },
        }
    }
}

impl TryFrom<ProjectLocationDto> for ProjectLocation {
    type Error = String;

    fn try_from(value: ProjectLocationDto) -> Result<Self, Self::Error> {
        match value {
            ProjectLocationDto::Local { path } => Ok(Self::Local { path }),
            ProjectLocationDto::Remote { hostId, path } => Ok(Self::Remote {
                host_id: parse_uuid(&hostId, "host")?,
                path,
            }),
        }
    }
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../ui/src/lib/generated/")]
struct ProjectSummaryDto {
    id: String,
    name: String,
    location: ProjectLocationDto,
    default_agent: Option<String>,
    assist_key_id: Option<String>,
    last_opened: Option<String>,
}

impl From<&CoreProjectSummary> for ProjectSummaryDto {
    fn from(project: &CoreProjectSummary) -> Self {
        Self {
            id: project.id.to_string(),
            name: project.name.clone(),
            location: ProjectLocationDto::from(&project.location),
            default_agent: project.default_agent.clone(),
            assist_key_id: project.assist_key_id.map(|id| id.to_string()),
            last_opened: project.last_opened.map(|ts| ts.to_rfc3339()),
        }
    }
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../ui/src/lib/generated/")]
struct AgentSpecDto {
    id: String,
    name: String,
    command: String,
    args: Vec<String>,
    persistent: bool,
    docs_url: Option<String>,
    /// `active` | `deprecated`
    status: String,
    successor: Option<String>,
    byok_env: Vec<String>,
    supports_openai_compat: bool,
    install_macos: Option<String>,
    install_linux: Option<String>,
    install_windows: Option<String>,
    install_default: Option<String>,
}

fn agent_spec_dto_from_preset(preset: &ssh_client_core::agents::AgentPreset) -> AgentSpecDto {
    use ssh_client_core::agents::AgentPresetStatus;
    let (status, successor) = match &preset.status {
        AgentPresetStatus::Active => ("active".into(), None),
        AgentPresetStatus::Deprecated { successor } => {
            ("deprecated".into(), Some(successor.clone()))
        }
    };
    AgentSpecDto {
        id: preset.id.clone(),
        name: preset.display_name.clone(),
        command: preset.command.clone(),
        args: preset.args.clone(),
        persistent: preset.persistent_default,
        docs_url: preset.docs_url.clone(),
        status,
        successor,
        byok_env: preset.byok_env.clone(),
        supports_openai_compat: preset.supports_openai_compat,
        install_macos: preset.install.macos.clone(),
        install_linux: preset.install.linux.clone(),
        install_windows: preset.install.windows.clone(),
        install_default: preset.install.default.clone(),
    }
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../ui/src/lib/generated/")]
struct RunningSessionSummaryDto {
    id: String,
    project_id: String,
    project_name: String,
    host_id: String,
    host_label: String,
    agent_id: Option<String>,
    mux_session: String,
    started_at: String,
    last_attached_at: String,
    started_on_device: String,
}

impl From<&CoreRunningSessionSummary> for RunningSessionSummaryDto {
    fn from(session: &CoreRunningSessionSummary) -> Self {
        Self {
            id: session.id.to_string(),
            project_id: session.project_id.to_string(),
            project_name: session.project_name.clone(),
            host_id: session.host_id.to_string(),
            host_label: session.host_label.clone(),
            agent_id: session.agent_id.clone(),
            mux_session: session.mux_session.clone(),
            started_at: session.started_at.to_rfc3339(),
            last_attached_at: session.last_attached_at.to_rfc3339(),
            started_on_device: session.started_on_device.clone(),
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
    identity_file_hint: Option<String>,
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
            identity_file_hint: host.identity_file_hint.clone(),
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
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../ui/src/lib/generated/")]
#[allow(dead_code)] // Variants are constructed from the UI / serde wire format.
pub(crate) enum AgentAttentionState {
    Running,
    Waiting,
    Done,
    Failed,
}

#[derive(Clone, Serialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export, export_to = "../../../ui/src/lib/generated/")]
pub(crate) enum TerminalEvent {
    /// PTY bytes as standard base64 (JSON number arrays are too slow for PTY).
    Data {
        data: String,
        dropped: bool,
    },
    /// OSC 133 command-block marker (beside raw bytes, never instead of them).
    Block {
        phase: TerminalBlockPhase,
        exit_code: Option<i32>,
    },
    /// Agent attention / lifecycle hint (BEL, OSC notify, silence, or command end).
    Attention {
        state: AgentAttentionState,
        message: Option<String>,
        /// bel | osc | silence | exit | tmux
        source: String,
    },
    Closed,
}

/// App-wide terminal stream envelope so any OS window can attach to a session.
#[derive(Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../ui/src/lib/generated/")]
pub(crate) struct TerminalEventEnvelope {
    pub session_id: String,
    pub event: TerminalEvent,
}

#[derive(Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../ui/src/lib/generated/")]
pub(crate) enum TerminalBlockPhase {
    PromptStart,
    CommandStart,
    OutputStart,
    CommandEnd,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostMutation {
    label: String,
    hostname: String,
    port: u16,
    username: String,
    password: Option<String>,
    #[serde(default)]
    identity_id: Option<String>,
    #[serde(default)]
    sync_secret: Option<bool>,
    color: Option<String>,
    /// When false, skip OSC 133 wrapper. Default true (Auto).
    #[serde(default)]
    shell_integration: Option<bool>,
    #[serde(default)]
    tunnels: Option<Vec<tunnel::TunnelDefinitionDto>>,
    #[serde(default)]
    forward_agent: Option<bool>,
    /// Authenticate with the machine's default SSH keys (no stored secret).
    #[serde(default)]
    use_default_keys: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectMutation {
    name: String,
    location: ProjectLocationDto,
    default_agent: Option<String>,
    #[serde(default)]
    assist_key_id: Option<String>,
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
    sync::wire_vault_auth(&state).await;
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
    sync::wire_vault_auth(&state).await;
    sync::schedule_background_sync(app.clone(), &state);
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
    sync::wire_vault_auth(&state).await;
    Ok(dto)
}

#[tauri::command]
async fn vault_change_password(
    app: AppHandle,
    state: State<'_, AppState>,
    current_password: String,
    new_password: String,
) -> Result<(), String> {
    let previous = state.repo.vault().export_sync_header().await.ok();
    state
        .repo
        .vault()
        .change_password(
            &SecretString::new(current_password),
            &SecretString::new(new_password),
        )
        .await
        .map_err(redacted_error)?;
    if let Some(previous) = previous.as_ref() {
        sync::publish_rekey_if_configured(&state, previous).await?;
    }
    sync::wire_vault_auth(&state).await;
    sync::schedule_background_sync(app, &state);
    Ok(())
}

#[tauri::command]
async fn vault_lock(app: AppHandle, state: State<'_, AppState>) -> Result<VaultStatusDto, String> {
    lock_vault(&app, &state).await
}

#[tauri::command]
fn vault_get_idle_lock_secs(state: State<'_, AppState>) -> u64 {
    state.repo.vault().idle_timeout_secs()
}

#[tauri::command]
fn vault_set_idle_lock_secs(state: State<'_, AppState>, secs: u64) -> u64 {
    state.repo.vault().set_idle_timeout_secs(secs);
    state.repo.vault().idle_timeout_secs()
}

#[tauri::command]
fn activate_custom_titlebar(window: tauri::WebviewWindow) -> Result<(), String> {
    use tauri_plugin_decoration::WebviewWindowExt;

    // macOS already uses Overlay + our React TitleBar. create_overlay_titlebar
    // still injects a full-width drag strip that steals button clicks — only
    // inset the native traffic lights. Windows/Linux need the overlay for
    // caption buttons + Snap Layout.
    #[cfg(target_os = "macos")]
    {
        window
            .set_traffic_lights_inset(18.0, 20.0)
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        window
            .create_overlay_titlebar()
            .map_err(|error| error.to_string())?;
        Ok(())
    }
}

#[tauri::command]
fn restore_native_titlebar(window: tauri::WebviewWindow) -> Result<(), String> {
    use tauri_plugin_decoration::WebviewWindowExt;
    window
        .restore_native_titlebar()
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn platform_system_accent() -> Option<String> {
    accent::system_accent_hex()
}

#[tauri::command]
fn window_material_capabilities() -> materials::MaterialCapabilities {
    materials::capabilities()
}

#[tauri::command]
fn window_apply_material(
    window: tauri::WebviewWindow,
    kind: String,
) -> Result<materials::MaterialApplyResult, String> {
    materials::apply(&window, &kind)
}

#[tauri::command]
async fn list_hosts(state: State<'_, AppState>) -> Result<Vec<HostSummaryDto>, String> {
    let hosts = state.repo.list_hosts().await.map_err(redacted_error)?;
    Ok(hosts.iter().map(HostSummaryDto::from).collect())
}

#[tauri::command]
async fn list_projects(state: State<'_, AppState>) -> Result<Vec<ProjectSummaryDto>, String> {
    let projects = state.repo.list_projects().await.map_err(redacted_error)?;
    Ok(projects.iter().map(ProjectSummaryDto::from).collect())
}

#[tauri::command]
async fn list_agents() -> Result<Vec<AgentSpecDto>, String> {
    let presets = ssh_client_core::agents::bundled_agent_presets().map_err(redacted_error)?;
    Ok(presets.iter().map(agent_spec_dto_from_preset).collect())
}

#[tauri::command]
async fn create_project(
    app: AppHandle,
    state: State<'_, AppState>,
    project: ProjectMutation,
) -> Result<ProjectSummaryDto, String> {
    let assist_key_id = match project.assist_key_id.as_deref() {
        Some(raw) if !raw.trim().is_empty() => Some(parse_uuid(raw, "assist key")?),
        _ => None,
    };
    let created = state
        .repo
        .create_project(CreateProjectRequest {
            name: project.name,
            location: ProjectLocation::try_from(project.location)?,
            default_agent: project.default_agent,
            assist_key_id,
        })
        .await
        .map_err(redacted_error)?;
    sync::schedule_background_sync(app, &state);
    Ok(ProjectSummaryDto::from(&created))
}

#[tauri::command]
async fn update_project(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    project: ProjectMutation,
) -> Result<ProjectSummaryDto, String> {
    let project_id = parse_uuid(&id, "project")?;
    let assist_key_id = match project.assist_key_id.as_deref() {
        Some(raw) if !raw.trim().is_empty() => Some(parse_uuid(raw, "assist key")?),
        _ => None,
    };
    let updated = state
        .repo
        .update_project(
            project_id,
            CreateProjectRequest {
                name: project.name,
                location: ProjectLocation::try_from(project.location)?,
                default_agent: project.default_agent,
                assist_key_id,
            },
        )
        .await
        .map_err(redacted_error)?;
    sync::schedule_background_sync(app, &state);
    Ok(ProjectSummaryDto::from(&updated))
}

#[tauri::command]
async fn delete_project(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let project_id = parse_uuid(&id, "project")?;
    state
        .repo
        .delete_project(project_id)
        .await
        .map_err(redacted_error)?;
    sync::schedule_background_sync(app, &state);
    Ok(())
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../ui/src/lib/generated/")]
struct ByokEnvHandleDto {
    env_path: String,
    var_names: Vec<String>,
    key_label: String,
}

#[tauri::command]
async fn prepare_project_byok(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Option<ByokEnvHandleDto>, String> {
    let id = parse_uuid(&project_id, "project")?;
    let handle = ssh_client_core::agents::prepare_project_byok(&state.repo, &state.manager, id)
        .await
        .map_err(redacted_error)?;
    Ok(handle.map(|h| ByokEnvHandleDto {
        env_path: h.env_path,
        var_names: h.var_names,
        key_label: h.key_label,
    }))
}

#[tauri::command]
async fn touch_project_opened(
    state: State<'_, AppState>,
    id: String,
) -> Result<ProjectSummaryDto, String> {
    let project_id = parse_uuid(&id, "project")?;
    let updated = state
        .repo
        .touch_project_opened(project_id)
        .await
        .map_err(redacted_error)?;
    Ok(ProjectSummaryDto::from(&updated))
}

#[tauri::command]
async fn list_running_sessions(
    state: State<'_, AppState>,
) -> Result<Vec<RunningSessionSummaryDto>, String> {
    let sessions = state
        .repo
        .list_running_sessions()
        .await
        .map_err(redacted_error)?;
    Ok(sessions
        .iter()
        .map(RunningSessionSummaryDto::from)
        .collect())
}

#[tauri::command]
async fn mark_project_running(
    app: AppHandle,
    state: State<'_, AppState>,
    project_id: String,
    host_id: String,
    agent_id: Option<String>,
) -> Result<RunningSessionSummaryDto, String> {
    let project = parse_uuid(&project_id, "project")?;
    let host = parse_uuid(&host_id, "host")?;
    let marked = state
        .repo
        .mark_project_running(project, host, agent_id, local_device_label())
        .await
        .map_err(redacted_error)?;
    sync::schedule_background_sync(app, &state);
    Ok(RunningSessionSummaryDto::from(&marked))
}

#[tauri::command]
async fn end_running_session(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let session_id = parse_uuid(&id, "running session")?;
    state
        .repo
        .end_running_session(session_id)
        .await
        .map_err(redacted_error)?;
    sync::schedule_background_sync(app, &state);
    Ok(())
}

fn local_device_label() -> String {
    std::process::Command::new("hostname")
        .output()
        .ok()
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "device".into())
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
    app: AppHandle,
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
    sync::schedule_background_sync(app, &state);
    Ok(imported.iter().map(HostSummaryDto::from).collect())
}

fn parse_host_tunnels(
    tunnels: Option<Vec<tunnel::TunnelDefinitionDto>>,
) -> Result<Option<Vec<ssh_client_core::model::TunnelDefinition>>, String> {
    match tunnels {
        None => Ok(None),
        Some(list) => {
            let mut out = Vec::with_capacity(list.len());
            for dto in list {
                out.push(dto.into_core()?);
            }
            Ok(Some(out))
        }
    }
}

fn shell_integration_from_mutation(
    value: Option<bool>,
) -> ssh_client_core::model::ShellIntegration {
    if value.unwrap_or(true) {
        ssh_client_core::model::ShellIntegration::Auto
    } else {
        ssh_client_core::model::ShellIntegration::Disabled
    }
}

#[tauri::command]
async fn create_host(
    app: AppHandle,
    state: State<'_, AppState>,
    host: HostMutation,
) -> Result<HostSummaryDto, String> {
    let identity_id = parse_optional_uuid(host.identity_id.as_deref(), "identity")?;
    let tunnels = parse_host_tunnels(host.tunnels)?.unwrap_or_default();
    let created = state
        .repo
        .create_host(CreateHostRequest {
            use_default_keys: host.use_default_keys.unwrap_or(false),
            label: host.label,
            hostname: host.hostname,
            port: host.port,
            username: host.username,
            password: host.password.map(SecretString::new),
            identity_id,
            sync_secret: host.sync_secret.unwrap_or(false),
            color: host.color,
            shell_integration: shell_integration_from_mutation(host.shell_integration),
            tunnels,
            forward_agent: host.forward_agent.unwrap_or(false),
        })
        .await
        .map_err(redacted_error)?;
    sync::schedule_background_sync(app, &state);
    Ok(HostSummaryDto::from(&created))
}

#[tauri::command]
async fn update_host(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    host: HostMutation,
) -> Result<HostSummaryDto, String> {
    let host_id = parse_uuid(&id, "host")?;
    let identity_id = parse_optional_uuid(host.identity_id.as_deref(), "identity")?;
    let tunnels = match parse_host_tunnels(host.tunnels)? {
        Some(tunnels) => tunnels,
        None => state
            .repo
            .get_host(host_id)
            .await
            .map(|h| h.tunnels)
            .unwrap_or_default(),
    };
    let forward_agent = match host.forward_agent {
        Some(value) => value,
        None => state
            .repo
            .get_host(host_id)
            .await
            .map(|h| h.forward_agent)
            .unwrap_or(false),
    };
    let updated = state
        .repo
        .update_host(
            host_id,
            CreateHostRequest {
                use_default_keys: host.use_default_keys.unwrap_or(false),
                label: host.label,
                hostname: host.hostname,
                port: host.port,
                username: host.username,
                password: host.password.map(SecretString::new),
                identity_id,
                sync_secret: host.sync_secret.unwrap_or(false),
                color: host.color,
                shell_integration: shell_integration_from_mutation(host.shell_integration),
                tunnels,
                forward_agent,
            },
        )
        .await
        .map_err(redacted_error)?;
    sync::schedule_background_sync(app, &state);
    Ok(HostSummaryDto::from(&updated))
}

#[tauri::command]
async fn identity_list(state: State<'_, AppState>) -> Result<Vec<IdentitySummaryDto>, String> {
    ensure_vault_unlocked(&state).await?;
    let identities = state.repo.list_identities().await.map_err(redacted_error)?;
    Ok(identities.iter().map(IdentitySummaryDto::from).collect())
}

#[tauri::command]
async fn identity_pick_key_file(app: AppHandle) -> Result<Option<String>, String> {
    let ssh_dir = platform_desktop::home_dir()
        .ok()
        .map(|home| home.join(".ssh"))
        .filter(|path| path.is_dir());
    let (tx, rx) = oneshot::channel();
    let mut dialog = app.dialog().file();
    if let Some(dir) = ssh_dir {
        dialog = dialog.set_directory(dir);
    }
    dialog.pick_file(move |file| {
        let path = file
            .and_then(|p| p.into_path().ok())
            .map(|p| p.display().to_string());
        let _ = tx.send(path);
    });
    rx.await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn identity_probe(path: String) -> Result<IdentityProbeDto, String> {
    let key_bytes = std::fs::read(expand_tilde(&path)).map_err(|e| e.to_string())?;
    let (encrypted, fingerprint) =
        VaultRepository::probe_ssh_key_file(&key_bytes).map_err(redacted_error)?;
    Ok(IdentityProbeDto {
        encrypted,
        fingerprint,
    })
}

#[tauri::command]
async fn identity_import(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    label: Option<String>,
    passphrase: Option<String>,
    remember_passphrase: bool,
    sync_secret: Option<bool>,
) -> Result<IdentitySummaryDto, String> {
    ensure_vault_unlocked(&state).await?;
    let expanded = expand_tilde(&path);
    let key_bytes = std::fs::read(&expanded).map_err(|e| e.to_string())?;
    let label = label
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| {
            expanded
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("SSH key")
                .to_string()
        });
    let imported = state
        .repo
        .import_ssh_key_identity(
            label,
            &key_bytes,
            passphrase.as_deref(),
            remember_passphrase,
            sync_secret.unwrap_or(false),
        )
        .await
        .map_err(redacted_error)?;
    sync::schedule_background_sync(app, &state);
    Ok(IdentitySummaryDto::from(&imported))
}

#[tauri::command]
async fn identity_rename(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    label: String,
) -> Result<IdentitySummaryDto, String> {
    ensure_vault_unlocked(&state).await?;
    let identity_id = parse_uuid(&id, "identity")?;
    let renamed = state
        .repo
        .rename_identity(identity_id, label)
        .await
        .map_err(redacted_error)?;
    sync::schedule_background_sync(app, &state);
    Ok(IdentitySummaryDto::from(&renamed))
}

#[tauri::command]
async fn identity_set_sync_secret(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    sync_secret: bool,
) -> Result<IdentitySummaryDto, String> {
    ensure_vault_unlocked(&state).await?;
    let identity_id = parse_uuid(&id, "identity")?;
    let updated = state
        .repo
        .set_identity_sync_secret(identity_id, sync_secret)
        .await
        .map_err(redacted_error)?;
    sync::schedule_background_sync(app, &state);
    Ok(IdentitySummaryDto::from(&updated))
}

#[tauri::command]
async fn identity_delete(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    force: bool,
) -> Result<IdentityDeleteResultDto, String> {
    ensure_vault_unlocked(&state).await?;
    let identity_id = parse_uuid(&id, "identity")?;
    let result = state
        .repo
        .delete_identity(identity_id, force)
        .await
        .map_err(redacted_error)?;
    if result.deleted {
        sync::schedule_background_sync(app, &state);
    }
    Ok(IdentityDeleteResultDto::from(&result))
}

#[tauri::command]
async fn set_host_tags(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    tags: Vec<String>,
) -> Result<HostSummaryDto, String> {
    let host_id = parse_uuid(&id, "host")?;
    let summary = state
        .repo
        .set_host_tags(host_id, tags)
        .await
        .map_err(redacted_error)?;
    sync::schedule_background_sync(app, &state);
    Ok(HostSummaryDto::from(&summary))
}

#[tauri::command]
async fn delete_host(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<(), String> {
    let host_id = parse_uuid(&id, "host")?;
    state
        .repo
        .delete_host(host_id)
        .await
        .map_err(redacted_error)?;
    sync::schedule_background_sync(app, &state);
    Ok(())
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

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../ui/src/lib/generated/")]
struct OpenTerminalResultDto {
    session_id: String,
    /// `off` | `active` | `unavailable`
    agent_forward: String,
    agent_forward_hint: Option<String>,
}

#[tauri::command]
async fn open_terminal(
    app: AppHandle,
    state: State<'_, AppState>,
    host_id: String,
    cols: u32,
    rows: u32,
    mux_session: Option<String>,
) -> Result<OpenTerminalResultDto, String> {
    let mux_session = match mux_session.as_deref().map(str::trim) {
        Some(name) if !name.is_empty() => {
            if name.len() > 64
                || !name
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
            {
                return Err("invalid session name".into());
            }
            Some(name.to_string())
        }
        _ => None,
    };
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
    let opened = state
        .manager
        .open_pty_named(host_id, PtySize::new(cols, rows), mux_session.as_deref())
        .await
        .map_err(redacted_error)?;

    // Best-effort: stamp recency for Arrange-by Recent (ignore vault write errors).
    let _ = state.repo.touch_host_connected(host_id).await;

    state
        .sessions
        .lock()
        .await
        .insert(session_id, opened.handle);
    // Tunnels must not block first paint — spawn beside the live PTY.
    {
        let app2 = app.clone();
        let host_id2 = host_id;
        tauri::async_runtime::spawn(async move {
            // Re-borrow AppState via app — use the same helper with cloned handles.
            // auto_start_for_session needs State; call through a thin wrapper.
            tunnel::auto_start_for_session_spawned(app2, session_id, host_id2).await;
        });
    }
    tauri::async_runtime::spawn(output_pump::forward_output(session_id, opened.output, app));
    Ok(OpenTerminalResultDto {
        session_id: session_id.to_string(),
        agent_forward: opened.agent_forward.as_str().into(),
        agent_forward_hint: opened.agent_forward.hint().map(str::to_string),
    })
}

#[tauri::command]
async fn open_local_terminal(
    app: AppHandle,
    state: State<'_, AppState>,
    cols: u32,
    rows: u32,
    cwd: Option<String>,
    shell: Option<String>,
    login_shell: Option<bool>,
) -> Result<String, String> {
    let mut spec = state
        .local_pty
        .default_shell()
        .ok_or_else(|| "no local shell is available".to_string())?;
    if let Some(program) = shell.filter(|s| !s.trim().is_empty()) {
        spec.program = std::path::PathBuf::from(program);
    }
    if login_shell.unwrap_or(true) {
        if !spec.args.iter().any(|a| a == "-l" || a == "--login") {
            spec.args.insert(0, "-l".into());
        }
    } else {
        spec.args.retain(|a| a != "-l" && a != "--login");
    }
    if let Some(dir) = cwd {
        let path = std::path::PathBuf::from(dir);
        if path.is_dir() {
            spec.cwd = Some(path);
        }
    }
    let spec = shell_integration::wrap_local_shell(spec);
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
    tauri::async_runtime::spawn(output_pump::forward_output(session_id, receiver, app));
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
    tunnel::stop_session_tunnels(&state, session_id).await;
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

/// Open a URL in the system browser (Help menu / release notes).
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("only http(s) URLs can be opened".to_string());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
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
    tunnel::close_all_tunnels(state).await;
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

fn parse_optional_uuid(value: Option<&str>, kind: &str) -> Result<Option<Uuid>, String> {
    match value.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) => Ok(Some(parse_uuid(value, kind)?)),
        None => Ok(None),
    }
}

fn expand_tilde(path: &str) -> PathBuf {
    if path == "~" {
        return platform_desktop::home_dir().unwrap_or_else(|_| PathBuf::from(path));
    }
    if let Some(rest) = path.strip_prefix("~/")
        && let Ok(home) = platform_desktop::home_dir()
    {
        return home.join(rest);
    }
    PathBuf::from(path)
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
        ssh_client_core::Error::InvalidKey(msg) => format!("invalid private key: {msg}"),
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
        .plugin(tauri_plugin_decoration::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            app.set_menu(app_menu::build(app)?)?;
            app_menu::wire_menu_events(app.handle());
            webview_chrome::harden_all_webviews(app.handle());
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
            let http_backend = Arc::new(Mutex::new(None));
            let sync_engine = {
                let mut slot = http_backend
                    .try_lock()
                    .expect("http_backend unused during setup");
                sync::build_engine(Arc::clone(&vault), &sync_settings, &mut slot)
            };
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
            let tunnels = Arc::new(Mutex::new(HashMap::new()));
            let session_hosts = Arc::new(Mutex::new(HashMap::new()));
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
                tunnels: Arc::clone(&tunnels),
                session_hosts: Arc::clone(&session_hosts),
                prompts: Arc::clone(&prompts),
                sync_settings: Arc::new(Mutex::new(sync_settings)),
                sync_engine: Arc::new(Mutex::new(sync_engine)),
                http_backend,
                background_sync_gen: Arc::new(AtomicU64::new(0)),
            });

            // Periodic background sync while unlocked.
            let sync_app = app_handle.clone();
            let sync_vault = Arc::clone(&vault);
            let sync_engine_slot = app.state::<AppState>().sync_engine.clone();
            tauri::async_runtime::spawn(async move {
                let mut ticker = tokio::time::interval(sync::BACKGROUND_SYNC_INTERVAL);
                ticker.tick().await; // skip immediate first tick
                loop {
                    ticker.tick().await;
                    if !sync_vault.is_unlocked().await.unwrap_or(false) {
                        continue;
                    }
                    let engine = {
                        let guard = sync_engine_slot.lock().await;
                        guard.clone()
                    };
                    let Some(engine) = engine else {
                        continue;
                    };
                    match engine.sync_now().await {
                        Ok(report) => {
                            let _ =
                                sync_app.emit("sync-completed", sync::SyncReportDto::from(&report));
                        }
                        Err(err) => tracing::debug!(%err, "interval sync skipped"),
                    }
                }
            });

            // Periodic idle-lock watcher.
            let idle_app = app_handle.clone();
            let idle_vault = Arc::clone(&vault);
            let idle_sessions = Arc::clone(&sessions);
            let idle_sftp_sessions = Arc::clone(&sftp_sessions);
            let idle_active_transfers = Arc::clone(&active_transfers);
            let idle_tunnels = Arc::clone(&tunnels);
            let idle_session_hosts = Arc::clone(&session_hosts);
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
                    let tunnel_taken = {
                        let mut guard = idle_tunnels.lock().await;
                        std::mem::take(&mut *guard)
                    };
                    let had_tunnels = !tunnel_taken.is_empty();
                    for (_key, live) in tunnel_taken {
                        live.handle.stop().await;
                    }
                    idle_session_hosts.lock().await.clear();
                    if had_sessions || had_sftp || had_tunnels {
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
                let power_tunnels = Arc::clone(&tunnels);
                let power_session_hosts = Arc::clone(&session_hosts);
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
                            let tunnels = Arc::clone(&power_tunnels);
                            let session_hosts = Arc::clone(&power_session_hosts);
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
                                let tunnel_taken = {
                                    let mut guard = tunnels.lock().await;
                                    std::mem::take(&mut *guard)
                                };
                                for (_key, live) in tunnel_taken {
                                    live.handle.stop().await;
                                }
                                session_hosts.lock().await.clear();
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
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Focused(true) = event
                && let Some(webview) = window.app_handle().get_webview_window(window.label())
            {
                webview_chrome::harden_webview(&webview);
            }
            // macOS convention: the red close button hides the window; the app
            // (and its SSH sessions) keeps running until Quit (⌘Q / menu).
            #[cfg(target_os = "macos")]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event
                && window.label() == "main"
            {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            vault_status,
            vault_create,
            vault_unlock,
            vault_recover,
            vault_change_password,
            vault_lock,
            vault_get_idle_lock_secs,
            vault_set_idle_lock_secs,
            activate_custom_titlebar,
            restore_native_titlebar,
            platform_system_accent,
            window_material_capabilities,
            window_apply_material,
            list_hosts,
            list_projects,
            list_agents,
            create_project,
            update_project,
            delete_project,
            prepare_project_byok,
            touch_project_opened,
            list_running_sessions,
            mark_project_running,
            end_running_session,
            assist::list_assist_presets,
            assist::assist_test_provider,
            assist::list_api_keys,
            assist::create_api_key,
            assist::update_api_key,
            assist::delete_api_key,
            assist::assist_propose,
            assist::assist_explain,
            preview_ssh_config,
            import_ssh_config,
            create_host,
            update_host,
            set_host_tags,
            delete_host,
            identity_list,
            identity_pick_key_file,
            identity_probe,
            identity_import,
            identity_rename,
            identity_set_sync_secret,
            identity_delete,
            open_terminal,
            open_local_terminal,
            terminal_input,
            resize_terminal,
            close_terminal,
            mux::ensure_local_mux,
            mux::detect_local_mux,
            mux::install_local_mux,
            mux::probe_host_tools,
            mux::terminal_session_alive,
            mux::kill_mux_session,
            mux::prune_stale_running_sessions,
            mux::poll_session_watches,
            mux::set_dock_badge,
            respond_host_key,
            open_external,
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
            tunnel::tunnel_list,
            tunnel::tunnel_start,
            tunnel::tunnel_stop,
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
        .build(tauri::generate_context!())
        .expect("failed to build Tauri application")
        .run(|app, event| {
            // Dock icon click (macOS) re-shows the hidden main window.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event
                && let Some(window) = app.get_webview_window("main")
            {
                let _ = window.show();
                let _ = window.set_focus();
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use ssh_client_core::model::SecretString;

    #[test]
    fn export_bindings() {
        let cfg = ts_rs::Config::default();
        HostSummaryDto::export_all(&cfg).unwrap();
        OpenTerminalResultDto::export_all(&cfg).unwrap();
        IdentitySummaryDto::export_all(&cfg).unwrap();
        DependentHostDto::export_all(&cfg).unwrap();
        IdentityDeleteResultDto::export_all(&cfg).unwrap();
        IdentityProbeDto::export_all(&cfg).unwrap();
        ProjectSummaryDto::export_all(&cfg).unwrap();
        ProjectLocationDto::export_all(&cfg).unwrap();
        AgentSpecDto::export_all(&cfg).unwrap();
        ByokEnvHandleDto::export_all(&cfg).unwrap();
        RunningSessionSummaryDto::export_all(&cfg).unwrap();
        AgentAttentionState::export_all(&cfg).unwrap();
        assist::export_bindings(&cfg);
        mux::export_bindings(&cfg);
        tunnel::export_bindings(&cfg);
        VaultStatusDto::export_all(&cfg).unwrap();
        SshConfigHostDto::export_all(&cfg).unwrap();
        SshConfigPreviewDto::export_all(&cfg).unwrap();
        HostKeyPrompt::export_all(&cfg).unwrap();
        TerminalEvent::export_all(&cfg).unwrap();
        TerminalEventEnvelope::export_all(&cfg).unwrap();
        TerminalBlockPhase::export_all(&cfg).unwrap();
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
            use_default_keys: false,
            id: "id".into(),
            label: "lab".into(),
            hostname: "127.0.0.1".into(),
            port: 22,
            username: "user".into(),
            has_password: true,
            identity_id: None,
            auth_kind: "password".into(),
            sync_secret: false,
            color: Some("#70A5F5".into()),
            tags: vec!["lab".into()],
            shell_integration: true,
            tunnels: vec![],
            forward_agent: false,
            last_connected_at: None,
        };
        assert!(dto.has_password);
        let debug = format!("{dto:?}");
        assert!(!debug.contains("testpass"));
        assert!(!debug.contains("must-not-leak"));
        let _ = SecretString::new("must-not-leak");
    }
}
