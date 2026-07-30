import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { FileEntryDto } from "./generated/FileEntryDto";
import type { HostKeyPrompt } from "./generated/HostKeyPrompt";
import type { HostSummaryDto } from "./generated/HostSummaryDto";
import type { SftpOpenResult } from "./generated/SftpOpenResult";
import type { SshConfigHostDto } from "./generated/SshConfigHostDto";
import type { SshConfigPreviewDto } from "./generated/SshConfigPreviewDto";
import type { SyncJoinResultDto } from "./generated/SyncJoinResultDto";
import type { SyncReportDto } from "./generated/SyncReportDto";
import type { SyncStatusDto } from "./generated/SyncStatusDto";
import type { TerminalEvent } from "./generated/TerminalEvent";
import type { TransferEvent } from "./generated/TransferEvent";
import type { VaultStatusDto } from "./generated/VaultStatusDto";

export type {
  FileEntryDto,
  HostKeyPrompt,
  HostSummaryDto,
  SftpOpenResult,
  SshConfigHostDto,
  SshConfigPreviewDto,
  SyncJoinResultDto,
  SyncReportDto,
  SyncStatusDto,
  TerminalEvent,
  TransferEvent,
  VaultStatusDto,
};

export interface HostMutation {
  label: string;
  hostname: string;
  port: number;
  username: string;
  password?: string;
  color?: string;
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

export function openTerminal(
  hostId: string,
  cols: number,
  rows: number,
  onOutput: (event: TerminalEvent) => void,
): Promise<string> {
  const output = new Channel<TerminalEvent>();
  output.onmessage = onOutput;
  return invoke<string>("open_terminal", {
    hostId,
    cols,
    rows,
    output,
  });
}

export function openLocalTerminal(
  cols: number,
  rows: number,
  onOutput: (event: TerminalEvent) => void,
): Promise<string> {
  const output = new Channel<TerminalEvent>();
  output.onmessage = onOutput;
  return invoke<string>("open_local_terminal", {
    cols,
    rows,
    output,
  });
}

export function sendTerminalInput(
  sessionId: string,
  data: Uint8Array,
): Promise<void> {
  return invoke("terminal_input", {
    sessionId,
    data: Array.from(data),
  });
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

export function onVaultLocked(handler: () => void): Promise<UnlistenFn> {
  return listen("vault-locked", () => handler());
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

export function syncJoinHttp(
  url: string,
  token?: string,
): Promise<SyncJoinResultDto> {
  return invoke<SyncJoinResultDto>("sync_join_http", { url, token });
}

