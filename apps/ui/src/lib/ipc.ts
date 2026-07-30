import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { HostKeyPrompt } from "./generated/HostKeyPrompt";
import type { HostSummaryDto } from "./generated/HostSummaryDto";
import type { SshConfigHostDto } from "./generated/SshConfigHostDto";
import type { SshConfigPreviewDto } from "./generated/SshConfigPreviewDto";
import type { TerminalEvent } from "./generated/TerminalEvent";
import type { VaultStatusDto } from "./generated/VaultStatusDto";

export type {
  HostKeyPrompt,
  HostSummaryDto,
  SshConfigHostDto,
  SshConfigPreviewDto,
  TerminalEvent,
  VaultStatusDto,
};

export interface HostMutation {
  label: string;
  hostname: string;
  port: number;
  username: string;
  password?: string;
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
