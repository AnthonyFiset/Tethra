import { getVersion } from "@tauri-apps/api/app";
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  WebviewWindow,
  getCurrentWebviewWindow,
} from "@tauri-apps/api/webviewWindow";
import {
  isPermissionGranted as notificationPermissionGranted,
  onAction as onNotificationAction,
  requestPermission as requestNotificationPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import type { AgentSpecDto } from "./generated/AgentSpecDto";
import type { ApiKeySummaryDto } from "./generated/ApiKeySummaryDto";
import type { AssistExplainResultDto } from "./generated/AssistExplainResultDto";
import type { AssistProposeResultDto } from "./generated/AssistProposeResultDto";
import type { FileEntryDto } from "./generated/FileEntryDto";
import type { HostKeyPrompt } from "./generated/HostKeyPrompt";
import type { HostSummaryDto } from "./generated/HostSummaryDto";
import type { IdentityDeleteResultDto } from "./generated/IdentityDeleteResultDto";
import type { IdentityProbeDto } from "./generated/IdentityProbeDto";
import type { IdentitySummaryDto } from "./generated/IdentitySummaryDto";
import type { MuxEnsureResultDto } from "./generated/MuxEnsureResultDto";
import type { MissingToolDto } from "./generated/MissingToolDto";
import type { ProjectLocationDto } from "./generated/ProjectLocationDto";
import type { ProjectSummaryDto } from "./generated/ProjectSummaryDto";
import type { ProviderPresetDto } from "./generated/ProviderPresetDto";
import type { RunningSessionSummaryDto } from "./generated/RunningSessionSummaryDto";
import type { SftpOpenResult } from "./generated/SftpOpenResult";
import type { SshConfigHostDto } from "./generated/SshConfigHostDto";
import type { SshConfigPreviewDto } from "./generated/SshConfigPreviewDto";
import type { SyncJoinResultDto } from "./generated/SyncJoinResultDto";
import type { SyncReportDto } from "./generated/SyncReportDto";
import type { SyncStatusDto } from "./generated/SyncStatusDto";
import type { TerminalEvent } from "./generated/TerminalEvent";
import type { TerminalEventEnvelope } from "./generated/TerminalEventEnvelope";
import type { TestProviderResultDto } from "./generated/TestProviderResultDto";
import type { ToolsProbeDto } from "./generated/ToolsProbeDto";
import { getDefaultShell, getLoginShell } from "./prefs";
import type { UpdateInfoDto } from "./generated/UpdateInfoDto";
import type { TransferEvent } from "./generated/TransferEvent";
import type { TunnelDefinitionDto } from "./generated/TunnelDefinitionDto";
import type { TunnelStatusDto } from "./generated/TunnelStatusDto";
import type { OpenTerminalResultDto } from "./generated/OpenTerminalResultDto";
import type { VaultStatusDto } from "./generated/VaultStatusDto";

export type {
  AgentSpecDto,
  ApiKeySummaryDto,
  AssistExplainResultDto,
  AssistProposeResultDto,
  FileEntryDto,
  HostKeyPrompt,
  HostSummaryDto,
  IdentityDeleteResultDto,
  IdentityProbeDto,
  IdentitySummaryDto,
  MissingToolDto,
  MuxEnsureResultDto,
  ProjectLocationDto,
  ProjectSummaryDto,
  ProviderPresetDto,
  RunningSessionSummaryDto,
  SftpOpenResult,
  SshConfigHostDto,
  SshConfigPreviewDto,
  SyncJoinResultDto,
  SyncReportDto,
  SyncStatusDto,
  TerminalEvent,
  TerminalEventEnvelope,
  TestProviderResultDto,
  ToolsProbeDto,
  UpdateInfoDto,
  TransferEvent,
  TunnelDefinitionDto,
  TunnelStatusDto,
  OpenTerminalResultDto,
  VaultStatusDto,
};

export interface HostMutation {
  label: string;
  hostname: string;
  port: number;
  username: string;
  password?: string;
  /** Attach an existing vault identity (password or SSH key). */
  identityId?: string;
  /** Opt-in: sync the encrypted password identity to other devices. */
  syncSecret?: boolean;
  color?: string;
  /** Inject OSC 133 / OSC 7 via connect wrapper. Default on. */
  shellIntegration?: boolean;
  /** Port-forward definitions (no secrets). Omit to leave unchanged on update. */
  tunnels?: TunnelDefinitionDto[];
  /** Opt-in SSH agent forwarding. Default off. */
  forwardAgent?: boolean;
  /** Connect with the machine's default SSH keys (~/.ssh/id_*). */
  useDefaultKeys?: boolean;
}

export function vaultStatus(): Promise<VaultStatusDto> {
  return invoke<VaultStatusDto>("vault_status");
}

export function vaultCreate(
  password: string,
  enableRecovery: boolean,
): Promise<VaultStatusDto> {
  return invoke<VaultStatusDto>("vault_create", {
    password,
    enableRecovery,
  });
}

export function vaultUnlock(password: string): Promise<VaultStatusDto> {
  return invoke<VaultStatusDto>("vault_unlock", { password });
}

export function vaultRecover(newPassword: string): Promise<VaultStatusDto> {
  return invoke<VaultStatusDto>("vault_recover", { newPassword });
}

export function vaultChangePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  return invoke("vault_change_password", {
    currentPassword,
    newPassword,
  });
}

export function vaultLock(): Promise<VaultStatusDto> {
  return invoke<VaultStatusDto>("vault_lock");
}

export function vaultGetIdleLockSecs(): Promise<number> {
  return invoke<number>("vault_get_idle_lock_secs");
}

export function vaultSetIdleLockSecs(secs: number): Promise<number> {
  return invoke<number>("vault_set_idle_lock_secs", { secs });
}

export function listHosts(): Promise<HostSummaryDto[]> {
  return invoke<HostSummaryDto[]>("list_hosts");
}

export function previewSshConfig(): Promise<SshConfigPreviewDto> {
  return invoke<SshConfigPreviewDto>("preview_ssh_config");
}

export function importSshConfig(
  aliases: string[],
): Promise<HostSummaryDto[]> {
  return invoke<HostSummaryDto[]>("import_ssh_config", { aliases });
}

export function createHost(host: HostMutation): Promise<HostSummaryDto> {
  return invoke<HostSummaryDto>("create_host", { host });
}

export function updateHost(
  id: string,
  host: HostMutation,
): Promise<HostSummaryDto> {
  return invoke<HostSummaryDto>("update_host", { id, host });
}

export function deleteHost(id: string): Promise<void> {
  return invoke("delete_host", { id });
}

/** Replace a host's tags only — never touches auth or connection settings. */
export function setHostTags(
  id: string,
  tags: string[],
): Promise<HostSummaryDto> {
  return invoke<HostSummaryDto>("set_host_tags", { id, tags });
}

export function listIdentities(): Promise<IdentitySummaryDto[]> {
  return invoke<IdentitySummaryDto[]>("identity_list");
}

export function identityPickKeyFile(): Promise<string | null> {
  return invoke<string | null>("identity_pick_key_file");
}

export function identityProbe(path: string): Promise<IdentityProbeDto> {
  return invoke<IdentityProbeDto>("identity_probe", { path });
}

export function identityImport(args: {
  path: string;
  label?: string;
  passphrase?: string;
  rememberPassphrase?: boolean;
  syncSecret?: boolean;
}): Promise<IdentitySummaryDto> {
  return invoke<IdentitySummaryDto>("identity_import", {
    path: args.path,
    label: args.label ?? null,
    passphrase: args.passphrase ?? null,
    rememberPassphrase: args.rememberPassphrase ?? false,
    syncSecret: args.syncSecret ?? false,
  });
}

export function identityRename(
  id: string,
  label: string,
): Promise<IdentitySummaryDto> {
  return invoke<IdentitySummaryDto>("identity_rename", { id, label });
}

export function identitySetSyncSecret(
  id: string,
  syncSecret: boolean,
): Promise<IdentitySummaryDto> {
  return invoke<IdentitySummaryDto>("identity_set_sync_secret", {
    id,
    syncSecret,
  });
}

export function identityDelete(
  id: string,
  force: boolean,
): Promise<IdentityDeleteResultDto> {
  return invoke<IdentityDeleteResultDto>("identity_delete", { id, force });
}

export interface ProjectMutation {
  name: string;
  location: ProjectLocationDto;
  defaultAgent?: string;
  /** Vault Assist key id to inject via agent `byokEnv` (never the secret). */
  assistKeyId?: string | null;
}

export type ByokEnvHandleDto = {
  envPath: string;
  varNames: string[];
  keyLabel: string;
};

export function listProjects(): Promise<ProjectSummaryDto[]> {
  return invoke<ProjectSummaryDto[]>("list_projects");
}

export function listAgents(): Promise<AgentSpecDto[]> {
  return invoke<AgentSpecDto[]>("list_agents");
}

export function createProject(
  project: ProjectMutation,
): Promise<ProjectSummaryDto> {
  return invoke<ProjectSummaryDto>("create_project", { project });
}

export function updateProject(
  id: string,
  project: ProjectMutation,
): Promise<ProjectSummaryDto> {
  return invoke<ProjectSummaryDto>("update_project", { id, project });
}

export function deleteProject(id: string): Promise<void> {
  return invoke("delete_project", { id });
}

export function prepareProjectByok(
  projectId: string,
): Promise<ByokEnvHandleDto | null> {
  return invoke<ByokEnvHandleDto | null>("prepare_project_byok", { projectId });
}

export function touchProjectOpened(id: string): Promise<ProjectSummaryDto> {
  return invoke<ProjectSummaryDto>("touch_project_opened", { id });
}

export function listRunningSessions(): Promise<RunningSessionSummaryDto[]> {
  return invoke<RunningSessionSummaryDto[]>("list_running_sessions");
}

export function markProjectRunning(
  projectId: string,
  hostId: string,
  agentId?: string,
): Promise<RunningSessionSummaryDto> {
  return invoke<RunningSessionSummaryDto>("mark_project_running", {
    projectId,
    hostId,
    agentId,
  });
}

export function endRunningSession(id: string): Promise<void> {
  return invoke("end_running_session", { id });
}

export type AssistProviderId = "anthropic" | "openai" | "openaiCompat";

export interface ApiKeyMutation {
  label: string;
  provider: AssistProviderId;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  syncSecret?: boolean;
}

export interface AssistContextPayload {
  cwd?: string;
  hostLabel: string;
  isLocal: boolean;
  transcriptTail: string;
  lastExitCode?: number;
}

export interface TestProviderRequest {
  provider: AssistProviderId;
  baseUrl?: string;
  apiKey?: string;
  presetId?: string;
}

export function listAssistPresets(): Promise<ProviderPresetDto[]> {
  return invoke<ProviderPresetDto[]>("list_assist_presets");
}

export function assistTestProvider(
  request: TestProviderRequest,
): Promise<TestProviderResultDto> {
  return invoke<TestProviderResultDto>("assist_test_provider", { request });
}

export function listApiKeys(): Promise<ApiKeySummaryDto[]> {
  return invoke<ApiKeySummaryDto[]>("list_api_keys");
}

export function createApiKey(key: ApiKeyMutation): Promise<ApiKeySummaryDto> {
  return invoke<ApiKeySummaryDto>("create_api_key", { key });
}

export function updateApiKey(
  id: string,
  key: ApiKeyMutation,
): Promise<ApiKeySummaryDto> {
  return invoke<ApiKeySummaryDto>("update_api_key", { id, key });
}

export function deleteApiKey(id: string): Promise<void> {
  return invoke("delete_api_key", { id });
}

export function assistPropose(
  apiKeyId: string,
  prompt: string,
  context: AssistContextPayload,
): Promise<AssistProposeResultDto> {
  return invoke<AssistProposeResultDto>("assist_propose", {
    apiKeyId,
    prompt,
    context,
  });
}

export function assistExplain(
  apiKeyId: string,
  prompt: string,
  context: AssistContextPayload,
): Promise<AssistExplainResultDto> {
  return invoke<AssistExplainResultDto>("assist_explain", {
    apiKeyId,
    prompt,
    context,
  });
}

export function detectLocalMux(): Promise<MuxEnsureResultDto> {
  return invoke<MuxEnsureResultDto>("detect_local_mux");
}

export function installLocalMux(): Promise<MuxEnsureResultDto> {
  return invoke<MuxEnsureResultDto>("install_local_mux");
}

/** @deprecated Prefer detectLocalMux — no longer auto-installs on open. */
export function ensureLocalMux(): Promise<MuxEnsureResultDto> {
  return invoke<MuxEnsureResultDto>("ensure_local_mux");
}

export function probeHostTools(
  hostId: string | undefined,
  commands: string[],
): Promise<ToolsProbeDto> {
  return invoke<ToolsProbeDto>("probe_host_tools", {
    hostId,
    commands,
  });
}

export function terminalSessionAlive(sessionId: string): Promise<boolean> {
  return invoke<boolean>("terminal_session_alive", { sessionId });
}

export function killMuxSession(
  hostId: string | undefined,
  muxSession: string,
): Promise<void> {
  return invoke("kill_mux_session", {
    hostId,
    muxSession,
  });
}

export function pruneStaleRunningSessions(): Promise<number> {
  return invoke<number>("prune_stale_running_sessions");
}

export function pollSessionWatches(
  hostId: string,
  muxSessions: string[],
): Promise<import("./generated/SessionWatchDto").SessionWatchDto[]> {
  return invoke("poll_session_watches", { hostId, muxSessions });
}

export function setDockBadge(count: number): Promise<void> {
  return invoke("set_dock_badge", { count });
}

export async function focusMainWindow(): Promise<void> {
  await getCurrentWindow().setFocus();
}

export async function sendAgentNotification(options: {
  title: string;
  body: string;
  runningSessionId: string;
}): Promise<void> {
  let granted = await notificationPermissionGranted();
  if (!granted) {
    const permission = await requestNotificationPermission();
    granted = permission === "granted";
  }
  if (!granted) return;
  sendNotification({
    title: options.title,
    body: options.body,
    extra: { runningSessionId: options.runningSessionId },
  });
}

export async function onAgentNotificationAction(
  handler: (runningSessionId: string) => void,
): Promise<() => void> {
  const listener = await onNotificationAction((notification) => {
    const extra = notification.extra as
      | { runningSessionId?: string }
      | undefined;
    const id = extra?.runningSessionId;
    if (id) handler(id);
  });
  return () => {
    void listener.unregister();
  };
}

export function openTerminal(
  hostId: string,
  cols: number,
  rows: number,
  muxSession?: string,
): Promise<OpenTerminalResultDto> {
  return invoke<OpenTerminalResultDto>("open_terminal", {
    hostId,
    cols,
    rows,
    muxSession: muxSession ?? null,
  });
}

export function tunnelList(sessionId: string): Promise<TunnelStatusDto[]> {
  return invoke<TunnelStatusDto[]>("tunnel_list", { sessionId });
}

export function tunnelStart(
  sessionId: string,
  tunnelId: string,
): Promise<TunnelStatusDto> {
  return invoke<TunnelStatusDto>("tunnel_start", { sessionId, tunnelId });
}

export function tunnelStop(
  sessionId: string,
  tunnelId: string,
): Promise<TunnelStatusDto> {
  return invoke<TunnelStatusDto>("tunnel_stop", { sessionId, tunnelId });
}

export function onTunnelChanged(
  handler: (status: TunnelStatusDto) => void,
): Promise<UnlistenFn> {
  return listen<TunnelStatusDto>("tunnel-changed", (event) => {
    handler(event.payload);
  });
}

export function openLocalTerminal(
  cols: number,
  rows: number,
  cwd?: string,
): Promise<string> {
  return invoke<string>("open_local_terminal", {
    cols,
    rows,
    cwd,
    shell: getDefaultShell() || null,
    loginShell: getLoginShell(),
  });
}

/** Subscribe to PTY output for any session (all OS windows receive the bus). */
export function onTerminalEvent(
  handler: (sessionId: string, event: TerminalEvent) => void,
): Promise<UnlistenFn> {
  return listen<TerminalEventEnvelope>("terminal-event", (event) => {
    handler(event.payload.sessionId, event.payload.event);
  });
}

/**
 * Drop accidental xterm onData (dialog click-through / focus DA+OSC replies)
 * at the IPC boundary. Intentional inserts must pass `{ force: true }`.
 */
let ptyUserInputSuppressedUntil = 0;

export function suppressPtyUserInput(durationMs = 800): void {
  ptyUserInputSuppressedUntil = Math.max(
    ptyUserInputSuppressedUntil,
    Date.now() + durationMs,
  );
}

/**
 * Per-session write chain. `terminal_input` is an async Tauri command — every
 * call is its own task racing for the session lock, so two keystrokes in
 * flight at once could reach the PTY swapped (a burst of `qrstuvw` landed as
 * `rusvtw` over SSH). Serialize here; a failed write never poisons the chain.
 */
const terminalInputChains = new Map<string, Promise<void>>();

export function sendTerminalInput(
  sessionId: string,
  data: Uint8Array,
  options?: { force?: boolean },
): Promise<void> {
  if (!options?.force && Date.now() < ptyUserInputSuppressedUntil) {
    return Promise.resolve();
  }
  const payload = Array.from(data);
  const prev = terminalInputChains.get(sessionId) ?? Promise.resolve();
  const next = prev.then(() =>
    invoke<void>("terminal_input", { sessionId, data: payload }),
  );
  const settled = next.catch(() => undefined);
  terminalInputChains.set(sessionId, settled);
  void settled.then(() => {
    if (terminalInputChains.get(sessionId) === settled) {
      terminalInputChains.delete(sessionId);
    }
  });
  return next;
}

export function resizeTerminal(
  sessionId: string,
  cols: number,
  rows: number,
): Promise<void> {
  return invoke("resize_terminal", { sessionId, cols, rows });
}

export function closeTerminal(sessionId: string): Promise<void> {
  return invoke("close_terminal", { sessionId });
}

export function respondHostKey(
  promptId: string,
  accepted: boolean,
): Promise<void> {
  return invoke("respond_host_key", { promptId, accepted });
}

export function onHostKeyPrompt(
  handler: (prompt: HostKeyPrompt) => void,
): Promise<UnlistenFn> {
  return listen<HostKeyPrompt>("host-key-prompt", (event) =>
    handler(event.payload),
  );
}

export function onVaultStatus(
  handler: (status: VaultStatusDto) => void,
): Promise<UnlistenFn> {
  return listen<VaultStatusDto>("vault-status", (event) =>
    handler(event.payload),
  );
}

/** OS file drag over/onto the window (Finder → SFTP upload). */
export type OsFileDropEvent =
  | { type: "enter" | "over" }
  | { type: "drop"; paths: string[] }
  | { type: "leave" };

/**
 * Subscribe to native file drags on the current webview. Resolves with the
 * unlisten fn; the web harness has no OS drags (mock resolves a no-op).
 */
export async function onOsFileDrop(
  handler: (event: OsFileDropEvent) => void,
): Promise<UnlistenFn> {
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  return getCurrentWebview().onDragDropEvent((event) => {
    const p = event.payload;
    if (p.type === "drop") handler({ type: "drop", paths: p.paths });
    else if (p.type === "enter" || p.type === "over") handler({ type: p.type });
    else handler({ type: "leave" });
  });
}

export function onVaultLocked(handler: () => void): Promise<UnlistenFn> {
  return listen("vault-locked", () => handler());
}

export function onSyncCompleted(
  handler: (report: SyncReportDto) => void,
): Promise<UnlistenFn> {
  return listen<SyncReportDto>("sync-completed", (event) =>
    handler(event.payload),
  );
}

/** Native menu bar → UI (M12.5). Payload is a stable command id string. */
export function onMenuCommand(
  handler: (commandId: string) => void,
): Promise<UnlistenFn> {
  return listen<string>("menu-command", (event) => handler(event.payload));
}

export function openExternal(url: string): Promise<void> {
  return invoke("open_external", { url });
}

export function localHome(): Promise<string> {
  return invoke<string>("local_home");
}

export function localList(path: string): Promise<FileEntryDto[]> {
  return invoke<FileEntryDto[]>("local_list", { path });
}

export function localMkdir(path: string): Promise<void> {
  return invoke("local_mkdir", { path });
}

export function localRename(from: string, to: string): Promise<void> {
  return invoke("local_rename", { from, to });
}

export function localRemove(path: string, recursive: boolean): Promise<void> {
  return invoke("local_remove", { path, recursive });
}

export function openSftp(hostId: string): Promise<SftpOpenResult> {
  return invoke<SftpOpenResult>("sftp_open", { hostId });
}

export function closeSftp(sessionId: string): Promise<void> {
  return invoke("sftp_close", { sessionId });
}

export function sftpRemoteList(
  sessionId: string,
  path: string,
): Promise<FileEntryDto[]> {
  return invoke<FileEntryDto[]>("sftp_remote_list", { sessionId, path });
}

export function sftpRemoteCanonicalize(
  sessionId: string,
  path: string,
): Promise<string> {
  return invoke<string>("sftp_remote_canonicalize", { sessionId, path });
}

export function sftpRemoteCreateDirEntry(
  sessionId: string,
  parent: string,
  name: string,
): Promise<FileEntryDto> {
  return invoke<FileEntryDto>("sftp_remote_create_dir_entry", {
    sessionId,
    parent,
    name,
  });
}

export function sftpRemoteRename(
  sessionId: string,
  from: string,
  to: string,
): Promise<void> {
  return invoke("sftp_remote_rename", { sessionId, from, to });
}

export function sftpRemoteRemove(
  sessionId: string,
  path: string,
  fileType: string,
): Promise<void> {
  return invoke("sftp_remote_remove", { sessionId, path, fileType });
}

export function sftpTransfer(
  sessionId: string,
  transferId: string,
  direction: "upload" | "download",
  localPath: string,
  remotePath: string,
  offset: number,
  onProgress: (event: TransferEvent) => void,
): Promise<number> {
  const progress = new Channel<TransferEvent>();
  progress.onmessage = onProgress;
  return invoke<number>("sftp_transfer", {
    sessionId,
    transferId,
    direction,
    localPath,
    remotePath,
    offset,
    progress,
  });
}

export function cancelSftpTransfer(transferId: string): Promise<void> {
  return invoke("sftp_cancel_transfer", { transferId });
}

export function syncStatus(): Promise<SyncStatusDto> {
  return invoke<SyncStatusDto>("sync_status");
}

export function syncConfigureFile(path: string): Promise<SyncStatusDto> {
  return invoke<SyncStatusDto>("sync_configure_file", { path });
}

export function syncConfigureHttp(
  url: string,
  token?: string,
): Promise<SyncStatusDto> {
  return invoke<SyncStatusDto>("sync_configure_http", { url, token });
}

export function syncDisable(): Promise<SyncStatusDto> {
  return invoke<SyncStatusDto>("sync_disable");
}

export function syncPickFolder(): Promise<string | null> {
  return invoke<string | null>("sync_pick_folder");
}

export function syncNow(): Promise<SyncReportDto> {
  return invoke<SyncReportDto>("sync_now");
}

/// Marker returned by `sync_join_http` when joining would abandon a different
/// local vault; retry with `resetExisting` once the user confirms.
export const VAULT_MISMATCH_NEEDS_RESET = "VAULT_MISMATCH_NEEDS_RESET";

export function updateCheck(): Promise<UpdateInfoDto> {
  return invoke<UpdateInfoDto>("update_check");
}

/// Resolves only on failure — a successful install restarts the app.
export function updateInstall(): Promise<void> {
  return invoke<void>("update_install");
}

export function syncJoinHttp(
  url: string,
  token?: string,
  resetExisting = false,
  password?: string,
): Promise<SyncJoinResultDto> {
  return invoke<SyncJoinResultDto>("sync_join_http", {
    url,
    token,
    password,
    resetExisting,
  });
}

export function getAppVersion(): Promise<string> {
  return getVersion();
}

export function currentWebviewLabel(): string {
  return getCurrentWebviewWindow().label;
}

export function onCurrentWebviewCloseRequested(
  handler: (ctx: {
    preventDefault: () => void;
    destroy: () => Promise<void>;
  }) => void | Promise<void>,
): Promise<UnlistenFn> {
  const win = getCurrentWebviewWindow();
  return win.onCloseRequested(async (event) => {
    await handler({
      preventDefault: () => event.preventDefault(),
      destroy: () => win.destroy(),
    });
  });
}

export type CreateWebviewWindowOptions = {
  url: string;
  title?: string;
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  focus?: boolean;
  backgroundColor?: string;
  /** Prefer false so activateWindowChrome can show after overlay titlebar. */
  visible?: boolean;
  /** Required for opt-in materials (Track B); opaque CSS is the default look. */
  transparent?: boolean;
};

/** Create a secondary webview window and wait until it is ready. */
export async function createWebviewWindow(
  label: string,
  options: CreateWebviewWindowOptions,
): Promise<void> {
  const window = new WebviewWindow(label, {
    ...options,
    visible: options.visible ?? false,
  });
  await new Promise<void>((resolve, reject) => {
    window.once("tauri://created", () => resolve());
    window.once("tauri://error", (event) =>
      reject(new Error(String(event.payload))),
    );
  });
}

/** Activate overlay titlebar (tauri-plugin-decoration), then show the window. */
export async function activateWindowChrome(): Promise<void> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    return;
  }

  const win = getCurrentWebviewWindow();
  let activated = false;
  const FALLBACK_MS = 5_000;

  const fallback = window.setTimeout(() => {
    if (activated) return;
    void invoke("restore_native_titlebar")
      .catch(() => undefined)
      .finally(() => {
        void win.show().catch(() => undefined);
      });
  }, FALLBACK_MS);

  try {
    await invoke("activate_custom_titlebar");
    activated = true;
  } catch (error) {
    console.warn("activate_custom_titlebar failed", error);
    try {
      await invoke("restore_native_titlebar");
    } catch {
      // ignore
    }
  } finally {
    window.clearTimeout(fallback);
    try {
      await win.show();
    } catch {
      // already visible
    }
  }
}

export function platformSystemAccent(): Promise<string | null> {
  return invoke<string | null>("platform_system_accent");
}

export type MaterialCapabilities = {
  vibrancy: boolean;
  mica: boolean;
  acrylic: boolean;
  note: string;
};

export type MaterialApplyResult = {
  applied: string;
  message: string | null;
};

export function windowMaterialCapabilities(): Promise<MaterialCapabilities> {
  return invoke<MaterialCapabilities>("window_material_capabilities");
}

export function windowApplyMaterial(
  kind: string,
): Promise<MaterialApplyResult> {
  return invoke<MaterialApplyResult>("window_apply_material", { kind });
}

/** Native clipboard via Tauri plugin, with navigator fallback outside the WebView. */
export async function writeClipboardText(text: string): Promise<boolean> {
  try {
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    await writeText(text);
    return true;
  } catch (pluginError) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      console.error("clipboard write failed", pluginError);
      return false;
    }
  }
}

export async function readClipboardText(): Promise<string> {
  try {
    const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
    const text = await readText();
    return text ?? "";
  } catch (pluginError) {
    try {
      return await navigator.clipboard.readText();
    } catch {
      console.error("clipboard read failed", pluginError);
      return "";
    }
  }
}

