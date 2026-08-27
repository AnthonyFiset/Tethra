/**
 * Deterministic mock IPC for `npm run dev:web` (VITE_TETHRA_MOCK=1).
 * Vite aliases this module in place of `ipc.ts` — no Tauri imports.
 * Interactions mutate in-memory fixtures so flows stay clickable.
 */
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
import type { UpdateInfoDto } from "./generated/UpdateInfoDto";
import type { TransferEvent } from "./generated/TransferEvent";
import type { TunnelDefinitionDto } from "./generated/TunnelDefinitionDto";
import type { TunnelStatusDto } from "./generated/TunnelStatusDto";
import type { OpenTerminalResultDto } from "./generated/OpenTerminalResultDto";
import type { VaultStatusDto } from "./generated/VaultStatusDto";
import type { SessionWatchDto } from "./generated/SessionWatchDto";

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
  identityId?: string;
  syncSecret?: boolean;
  color?: string;
  shellIntegration?: boolean;
  tunnels?: TunnelDefinitionDto[];
  forwardAgent?: boolean;
  useDefaultKeys?: boolean;
}

export interface ProjectMutation {
  name: string;
  location: ProjectLocationDto;
  defaultAgent?: string;
  assistKeyId?: string | null;
}

export type ByokEnvHandleDto = {
  envPath: string;
  varNames: string[];
  keyLabel: string;
};

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

export type CreateWebviewWindowOptions = {
  url: string;
  title?: string;
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  focus?: boolean;
  backgroundColor?: string;
  visible?: boolean;
  transparent?: boolean;
};

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

export const VAULT_MISMATCH_NEEDS_RESET = "VAULT_MISMATCH_NEEDS_RESET";

type UnlistenFn = () => void;

const TUNNEL_DB: TunnelDefinitionDto = {
  id: "tun-local-3000",
  label: "App :3000",
  direction: "local",
  bindPort: 3000,
  targetHost: "127.0.0.1",
  targetPort: 3000,
  autoStart: true,
  allowLan: false,
};

const TUNNEL_REMOTE: TunnelDefinitionDto = {
  id: "tun-remote-ssh",
  label: "Remote SSH",
  direction: "remote",
  bindPort: 2222,
  targetHost: "127.0.0.1",
  targetPort: 22,
  autoStart: false,
  allowLan: false,
};

const state: {
  vault: VaultStatusDto;
  idleLockSecs: number;
  hosts: HostSummaryDto[];
  identities: IdentitySummaryDto[];
  projects: ProjectSummaryDto[];
  agents: AgentSpecDto[];
  sessions: RunningSessionSummaryDto[];
  apiKeys: ApiKeySummaryDto[];
  sync: SyncStatusDto;
  tunnelRuntime: Map<string, TunnelStatusDto>;
  nextId: number;
} = {
  vault: {
    exists: true,
    unlocked: true,
    recoveryAvailable: true,
  },
  idleLockSecs: 900,
  hosts: [
    {
      id: "host-vm",
      label: "tethra-vm",
      hostname: "52.150.38.5",
      port: 22,
      username: "anthony",
      hasPassword: false,
      identityId: "id-key",
      authKind: "sshKey",
      syncSecret: true,
      color: "#3fb950",
      tags: ["azure", "prod"],
      shellIntegration: true,
      tunnels: [TUNNEL_DB],
      forwardAgent: true,
      useDefaultKeys: false,
      lastConnectedAt: "2026-08-20T18:00:00Z",
    },
    {
      id: "host-mini",
      label: "Mac mini",
      hostname: "100.80.50.90",
      port: 22,
      username: "anthony",
      hasPassword: false,
      identityId: "id-key",
      authKind: "sshKey",
      syncSecret: false,
      color: "#8bb8ff",
      tags: ["azure", "staging"],
      shellIntegration: true,
      tunnels: [TUNNEL_REMOTE],
      forwardAgent: false,
      useDefaultKeys: false,
      lastConnectedAt: "2026-08-22T12:00:00Z",
    },
    {
      id: "host-vps",
      label: "VPS NLD",
      hostname: "216.250.118.11",
      port: 22,
      username: "root",
      hasPassword: true,
      identityId: "id-password",
      authKind: "password",
      syncSecret: false,
      color: "#ff8a80",
      tags: ["trading"],
      shellIntegration: false,
      tunnels: [],
      forwardAgent: false,
      useDefaultKeys: false,
      lastConnectedAt: null,
    },
    {
      id: "host-win",
      label: "tethra-win",
      hostname: "20.114.7.32",
      port: 22,
      username: "anthony",
      hasPassword: false,
      identityId: "id-key",
      authKind: "sshKey",
      syncSecret: false,
      color: "#c9a6f5",
      tags: ["azure", "rdp"],
      shellIntegration: true,
      tunnels: [],
      forwardAgent: false,
      useDefaultKeys: false,
      lastConnectedAt: "2026-08-10T09:00:00Z",
    },
    {
      id: "host-pi",
      label: "Pi cluster",
      hostname: "10.0.0.12",
      port: 22,
      username: "pi",
      hasPassword: false,
      identityId: "id-key",
      authKind: "sshKey",
      syncSecret: false,
      color: "#4dd0e1",
      tags: ["staging"],
      shellIntegration: true,
      tunnels: [],
      forwardAgent: false,
      useDefaultKeys: false,
      lastConnectedAt: "2026-08-23T08:00:00Z",
    },
    {
      id: "host-lab",
      label: "Home lab",
      hostname: "10.0.1.50",
      port: 22,
      username: "anthony",
      hasPassword: false,
      identityId: "id-key",
      authKind: "sshKey",
      syncSecret: false,
      color: "#3fb950",
      tags: ["staging"],
      shellIntegration: true,
      tunnels: [],
      forwardAgent: false,
      useDefaultKeys: false,
      lastConnectedAt: "2026-08-01T12:00:00Z",
    },
  ] as HostSummaryDto[],
  identities: [
    {
      id: "id-password",
      label: "Deploy password",
      kind: "password",
      fingerprint: null,
      usageCount: 1,
      createdAt: "2026-01-10T12:00:00Z",
      syncSecret: false,
    },
    {
      id: "id-key",
      label: "ops@bastion",
      kind: "sshKey",
      fingerprint: "SHA256:mockFingerprintAbc123",
      usageCount: 1,
      createdAt: "2026-01-11T12:00:00Z",
      syncSecret: true,
    },
  ] as IdentitySummaryDto[],
  projects: [
    {
      id: "proj-1",
      name: "api-refactor",
      location: { kind: "remote", hostId: "host-vm", path: "/srv/tethra" },
      defaultAgent: "claude",
      assistKeyId: "key-1",
      lastOpened: "2026-08-23T08:05:00Z",
    },
    {
      id: "proj-2",
      name: "deploy-watch",
      location: { kind: "remote", hostId: "host-mini", path: "/opt/app" },
      defaultAgent: "claude",
      assistKeyId: "key-1",
      lastOpened: "2026-08-22T14:00:00Z",
    },
    {
      id: "proj-3",
      name: "logs",
      location: { kind: "remote", hostId: "host-pi", path: "/var/log" },
      defaultAgent: "shell",
      assistKeyId: null,
      lastOpened: "2026-08-21T10:00:00Z",
    },
  ] as ProjectSummaryDto[],
  agents: [
    {
      id: "shell",
      name: "Shell",
      command: "",
      args: [],
      persistent: false,
      docsUrl: null,
      status: "active",
      successor: null,
      byokEnv: [],
      supportsOpenaiCompat: false,
      installMacos: null,
      installLinux: null,
      installWindows: null,
      installDefault: null,
    },
    {
      id: "claude",
      name: "Claude Code",
      command: "claude",
      args: [],
      persistent: true,
      docsUrl: "https://docs.anthropic.com",
      status: "active",
      successor: null,
      byokEnv: ["ANTHROPIC_API_KEY"],
      supportsOpenaiCompat: false,
      installMacos: "brew install --cask claude-code",
      installLinux: null,
      installWindows: null,
      installDefault: "npm i -g @anthropic-ai/claude-code",
    },
  ] as AgentSpecDto[],
  sessions: [
    {
      id: "run-1",
      projectId: "proj-1",
      projectName: "api-refactor",
      hostId: "host-vm",
      hostLabel: "tethra-vm",
      agentId: "claude",
      muxSession: "tethra-proj-1",
      startedAt: "2026-08-23T08:00:00Z",
      lastAttachedAt: "2026-08-23T08:05:00Z",
      startedOnDevice: "mock-device",
    },
    {
      id: "run-2",
      projectId: "proj-2",
      projectName: "deploy-watch",
      hostId: "host-mini",
      hostLabel: "Mac mini",
      agentId: "claude",
      muxSession: "tethra-proj-2",
      startedAt: "2026-08-23T06:00:00Z",
      lastAttachedAt: "2026-08-23T07:00:00Z",
      startedOnDevice: "mock-device",
    },
    {
      id: "run-3",
      projectId: "proj-3",
      projectName: "mini · logs",
      hostId: "host-pi",
      hostLabel: "Pi cluster",
      agentId: "shell",
      muxSession: "tethra-proj-3",
      startedAt: "2026-08-23T04:00:00Z",
      lastAttachedAt: "2026-08-23T04:30:00Z",
      startedOnDevice: "mock-device",
    },
  ] as RunningSessionSummaryDto[],
  apiKeys: [
    {
      id: "key-1",
      label: "OpenRouter",
      provider: "openaiCompat",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "anthropic/claude-sonnet-4",
      syncSecret: false,
      hasKey: true,
    },
  ] as ApiKeySummaryDto[],
  sync: {
    configured: true,
    backendKind: "http",
    detail: "https://sync.example.com",
    deviceAuth: "authenticated",
    lastCursor: "cur-42",
    lastSyncedAt: "2026-08-23T07:55:00Z",
    lastError: null,
    lastPulled: 3,
    lastPushed: 1,
    lastApplied: 3,
  },
  tunnelRuntime: new Map<string, TunnelStatusDto>(),
  nextId: 100,
};

const vaultListeners = new Set<(s: VaultStatusDto) => void>();
const vaultLockedListeners = new Set<() => void>();
const syncListeners = new Set<(r: SyncReportDto) => void>();
const terminalListeners = new Set<
  (sessionId: string, event: TerminalEvent) => void
>();
const tunnelListeners = new Set<(status: TunnelStatusDto) => void>();
const hostKeyListeners = new Set<(prompt: HostKeyPrompt) => void>();
const menuListeners = new Set<(commandId: string) => void>();
const notifListeners = new Set<(runningSessionId: string) => void>();

function uid(prefix: string): string {
  state.nextId += 1;
  return `${prefix}-${state.nextId}`;
}

function emitVault(): void {
  for (const listener of vaultListeners) listener({ ...state.vault });
}

function emitTerminal(sessionId: string, event: TerminalEvent): void {
  for (const listener of terminalListeners) listener(sessionId, event);
}

// --- QA replay hooks (mock harness only) -------------------------------
// Lets the Playwright harness stream REAL captured terminal bytes (from
// crates/core/tests/terminal_qa.rs) into the live renderer.
let lastTerminalSession = "";
let feedBuf = "";
let feedIdx = 0;
if (typeof window !== "undefined") {
  const w = window as unknown as Record<string, unknown>;
  w.__tethraFeedB64 = (b64: string) => {
    if (!lastTerminalSession) return false;
    emitTerminal(lastTerminalSession, {
      kind: "data",
      data: b64,
      dropped: false,
    });
    // Mirror the Rust backend: parse OSC 133 marks out of the byte stream
    // and emit the corresponding block events (A/B/C/D → phases). Keeps a
    // carry buffer so marks split across chunks still parse.
    feedBuf += atob(b64);
    const window_ = feedBuf.slice(feedIdx);
    const re = /\x1b\]133;([A-Za-z])((?:;[^\x07\x1b]*)?)(?:\x07|\x1b\\)/g;
    const phases: Record<string, string> = {
      A: "promptStart",
      B: "commandStart",
      C: "outputStart",
      D: "commandEnd",
    };
    let match: RegExpExecArray | null;
    let lastEnd = -1;
    while ((match = re.exec(window_)) !== null) {
      const phase = phases[match[1].toUpperCase()];
      if (phase) {
        const exit =
          phase === "commandEnd" && match[2]
            ? Number.parseInt(match[2].slice(1), 10)
            : null;
        emitTerminal(lastTerminalSession, {
          kind: "block",
          phase: phase as "promptStart" | "commandStart" | "outputStart" | "commandEnd",
          exit_code: Number.isNaN(exit) ? null : exit,
        });
      }
      lastEnd = re.lastIndex;
    }
    if (lastEnd >= 0) {
      feedIdx += lastEnd;
    } else if (window_.length > 4096) {
      feedIdx += window_.length - 64;
    }
    return true;
  };
  w.__tethraLastSession = () => lastTerminalSession;
}

function tunnelStatusFromDef(
  sessionId: string,
  def: TunnelDefinitionDto,
  patch: Partial<TunnelStatusDto> = {},
): TunnelStatusDto {
  return {
    sessionId,
    tunnelId: def.id,
    label: def.label,
    direction: def.direction,
    bindPort: def.bindPort,
    targetHost: def.targetHost,
    targetPort: def.targetPort,
    autoStart: def.autoStart,
    allowLan: def.allowLan,
    state: "stopped",
    boundPort: null,
    error: null,
    localUrl: null,
    ...patch,
  };
}

function ensureSessionTunnels(sessionId: string, hostId: string): void {
  const host = state.hosts.find((h) => h.id === hostId);
  if (!host) return;
  for (const def of host.tunnels) {
    const key = `${sessionId}:${def.id}`;
    if (state.tunnelRuntime.has(key)) continue;
    const initial =
      def.autoStart
        ? tunnelStatusFromDef(sessionId, def, {
            state: "active",
            boundPort: def.bindPort,
            localUrl:
              def.direction === "local"
                ? `http://localhost:${def.bindPort}`
                : null,
          })
        : tunnelStatusFromDef(sessionId, def, {
            state: def.id === "tun-remote-ssh" ? "error" : "stopped",
            error:
              def.id === "tun-remote-ssh"
                ? "Remote bind refused (fixture)"
                : null,
          });
    state.tunnelRuntime.set(key, initial);
  }
}

const PRESETS: ProviderPresetDto[] = [
  {
    id: "openrouter",
    displayName: "OpenRouter",
    transport: "openaiCompat",
    baseUrl: "https://openrouter.ai/api/v1",
    baseUrlHint: null,
    modelsEndpoint: "/models",
    apiKeyUrl: "https://openrouter.ai/keys",
    keyPrefixHint: "sk-or-",
    requiresKey: true,
    defaultModel: "anthropic/claude-sonnet-4",
    authHeader: "bearer",
  },
  {
    id: "ollama",
    displayName: "Ollama",
    transport: "openaiCompat",
    baseUrl: "http://127.0.0.1:11434/v1",
    baseUrlHint: "Local OpenAI-compatible endpoint",
    modelsEndpoint: "/models",
    apiKeyUrl: null,
    keyPrefixHint: null,
    requiresKey: false,
    defaultModel: "llama3.2",
    authHeader: "bearer",
  },
  {
    id: "anthropic",
    displayName: "Anthropic",
    transport: "anthropic",
    baseUrl: "https://api.anthropic.com",
    baseUrlHint: null,
    modelsEndpoint: null,
    apiKeyUrl: "https://console.anthropic.com",
    keyPrefixHint: "sk-ant-",
    requiresKey: true,
    defaultModel: "claude-sonnet-4-20250514",
    authHeader: "api-key",
  },
];

const MUX_OK: MuxEnsureResultDto = {
  platform: "macos",
  available: true,
  kind: "tmux",
  path: "/opt/homebrew/bin/tmux",
  installed: true,
  title: null,
  body: null,
  installCommand: null,
  canAutoInstall: false,
  message: null,
};

function b64Terminal(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function emitMockSessionFixture(sessionId: string): void {
  const cwdOsc = "\x1b]7;file://tethra-vm/home/anthony/srv/tethra\x07";
  const branchOsc = "\x1b]133;G;main\x07";
  // No leading \r\n — promptStart binds to this same line before the command.
  const prompt =
    "\x1b[32manthony@tethra-vm\x1b[0m:\x1b[34m~/srv/tethra\x1b[0m$ ";

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const data = (text: string) => {
    emitTerminal(sessionId, {
      kind: "data",
      data: b64Terminal(text),
      dropped: false,
    });
  };
  const block = (
    phase: "promptStart" | "commandStart" | "outputStart" | "commandEnd",
    exit_code: number | null = null,
  ) => {
    emitTerminal(sessionId, { kind: "block", phase, exit_code });
  };

  void (async () => {
    await sleep(80);
    data(`${cwdOsc}${branchOsc}`);
    await sleep(40);

    // Finished ok — A+B at prompt (matches bash integration), then command, then C/D.
    data(`\r\n${prompt}`);
    await sleep(120);
    block("promptStart");
    block("commandStart");
    await sleep(50);
    data("git status\r\n");
    await sleep(80);
    block("outputStart");
    data("On branch main\r\nnothing to commit, working tree clean\r\n");
    await sleep(80);
    block("commandEnd", 0);

    // Finished failed
    await sleep(60);
    data(`\r\n${prompt}`);
    await sleep(120);
    block("promptStart");
    block("commandStart");
    await sleep(50);
    data("npm test\r\n");
    await sleep(80);
    block("outputStart");
    data("FAIL src/app.test.ts\r\nTests: 0 passed, 1 failed\r\n");
    await sleep(80);
    block("commandEnd", 1);

    // Long finished block (full output visible — no collapse in v0.5)
    await sleep(60);
    data(`\r\n${prompt}`);
    await sleep(120);
    block("promptStart");
    block("commandStart");
    await sleep(50);
    data("npm install\r\n");
    await sleep(80);
    block("outputStart");
    data(
      Array.from(
        { length: 85 },
        (_, i) => `added package-${i + 1}@1.0.0\r\n`,
      ).join(""),
    );
    await sleep(150);
    block("commandEnd", 0);

    // Active block + agent waiting
    await sleep(60);
    data(`\r\n${prompt}`);
    await sleep(120);
    block("promptStart");
    block("commandStart");
    await sleep(50);
    data("claude\r\n");
    await sleep(80);
    block("outputStart");
    // Keep buffer free of the banner copy — chrome owns that string.
    data("Agent running — waiting for approval…\r\n");
    await sleep(100);
    emitTerminal(sessionId, {
      kind: "attention",
      state: "waiting",
      message: "Approve file edit in src/lib.rs",
      source: "osc",
    });
  })();
}

// --- Vault ---

export function vaultStatus(): Promise<VaultStatusDto> {
  return Promise.resolve({ ...state.vault });
}

export function vaultCreate(
  _password: string,
  enableRecovery: boolean,
): Promise<VaultStatusDto> {
  state.vault = {
    exists: true,
    unlocked: true,
    recoveryAvailable: enableRecovery,
  };
  emitVault();
  return Promise.resolve({ ...state.vault });
}

export function vaultUnlock(_password: string): Promise<VaultStatusDto> {
  state.vault = { ...state.vault, unlocked: true };
  emitVault();
  return Promise.resolve({ ...state.vault });
}

export function vaultRecover(_newPassword: string): Promise<VaultStatusDto> {
  state.vault = { exists: true, unlocked: true, recoveryAvailable: true };
  emitVault();
  return Promise.resolve({ ...state.vault });
}

export function vaultChangePassword(
  _currentPassword: string,
  _newPassword: string,
): Promise<void> {
  return Promise.resolve();
}

export function vaultLock(): Promise<VaultStatusDto> {
  state.vault = { ...state.vault, unlocked: false };
  emitVault();
  for (const listener of vaultLockedListeners) listener();
  return Promise.resolve({ ...state.vault });
}

export function vaultGetIdleLockSecs(): Promise<number> {
  return Promise.resolve(state.idleLockSecs);
}

export function vaultSetIdleLockSecs(secs: number): Promise<number> {
  state.idleLockSecs = secs;
  return Promise.resolve(secs);
}

// --- Hosts ---

export function listHosts(): Promise<HostSummaryDto[]> {
  return Promise.resolve(state.hosts.map((h) => ({ ...h, tunnels: [...h.tunnels] })));
}

export function previewSshConfig(): Promise<SshConfigPreviewDto> {
  return Promise.resolve({
    hosts: [
      {
        alias: "staging",
        hostname: "staging.example.com",
        port: 22,
        username: "deploy",
        proxyJump: null,
        hasIdentityFile: false,
        identityFileHint: null,
      },
    ],
    warnings: [],
  });
}

export function importSshConfig(aliases: string[]): Promise<HostSummaryDto[]> {
  const created: HostSummaryDto[] = aliases.map((alias) => ({
    id: uid("host"),
    label: alias,
    hostname: `${alias}.example.com`,
    port: 22,
    username: "user",
    hasPassword: false,
    identityId: null,
    authKind: "none",
    syncSecret: false,
    color: null,
    tags: [],
    shellIntegration: true,
    tunnels: [],
    forwardAgent: false,
    useDefaultKeys: false,
    lastConnectedAt: null,
  }));
  state.hosts.push(...created);
  return Promise.resolve(created);
}

export function createHost(host: HostMutation): Promise<HostSummaryDto> {
  const created: HostSummaryDto = {
    id: uid("host"),
    label: host.label,
    hostname: host.hostname,
    port: host.port,
    username: host.username,
    hasPassword: Boolean(host.password),
    identityId: host.identityId ?? null,
    authKind: host.password
      ? "password"
      : host.identityId
        ? "sshKey"
        : "none",
    syncSecret: host.syncSecret ?? false,
    color: host.color ?? null,
    tags: [],
    shellIntegration: host.shellIntegration ?? true,
    tunnels: host.tunnels ?? [],
    forwardAgent: host.forwardAgent ?? false,
    useDefaultKeys: host.useDefaultKeys ?? false,
    lastConnectedAt: null,
  };
  state.hosts.push(created);
  return Promise.resolve({ ...created });
}

export function updateHost(
  id: string,
  host: HostMutation,
): Promise<HostSummaryDto> {
  const idx = state.hosts.findIndex((h) => h.id === id);
  if (idx < 0) return Promise.reject(new Error("Host not found"));
  const prev = state.hosts[idx]!;
  const next: HostSummaryDto = {
    ...prev,
    label: host.label,
    hostname: host.hostname,
    port: host.port,
    username: host.username,
    hasPassword: host.password !== undefined ? Boolean(host.password) : prev.hasPassword,
    identityId: host.identityId !== undefined ? host.identityId ?? null : prev.identityId,
    syncSecret: host.syncSecret ?? prev.syncSecret,
    color: host.color !== undefined ? host.color ?? null : prev.color,
    shellIntegration: host.shellIntegration ?? prev.shellIntegration,
    tunnels: host.tunnels ?? prev.tunnels,
    forwardAgent: host.forwardAgent ?? prev.forwardAgent,
    useDefaultKeys: host.useDefaultKeys ?? prev.useDefaultKeys,
    authKind: host.password
      ? "password"
      : host.identityId
        ? "sshKey"
        : prev.authKind,
  };
  state.hosts[idx] = next;
  return Promise.resolve({ ...next, tunnels: [...next.tunnels] });
}

export function deleteHost(id: string): Promise<void> {
  state.hosts = state.hosts.filter((h) => h.id !== id);
  return Promise.resolve();
}

export function setHostTags(
  id: string,
  tags: string[],
): Promise<HostSummaryDto> {
  const idx = state.hosts.findIndex((h) => h.id === id);
  if (idx < 0) return Promise.reject(new Error("Host not found"));
  const cleaned = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
  const next = { ...state.hosts[idx]!, tags: cleaned };
  state.hosts[idx] = next;
  return Promise.resolve({ ...next, tunnels: [...next.tunnels] });
}

// --- Identities ---

export function listIdentities(): Promise<IdentitySummaryDto[]> {
  return Promise.resolve(state.identities.map((i) => ({ ...i })));
}

export function identityPickKeyFile(): Promise<string | null> {
  return Promise.resolve("/Users/mock/.ssh/id_ed25519");
}

export function identityProbe(_path: string): Promise<IdentityProbeDto> {
  return Promise.resolve({ encrypted: true, fingerprint: "SHA256:mockNewKey" });
}

export function identityImport(args: {
  path: string;
  label?: string;
  passphrase?: string;
  rememberPassphrase?: boolean;
  syncSecret?: boolean;
}): Promise<IdentitySummaryDto> {
  const created: IdentitySummaryDto = {
    id: uid("id"),
    label: args.label ?? args.path.split("/").pop() ?? "key",
    kind: "sshKey",
    fingerprint: "SHA256:mockNewKey",
    usageCount: 0,
    createdAt: "2026-08-23T00:00:00Z",
    syncSecret: args.syncSecret ?? false,
  };
  state.identities.push(created);
  return Promise.resolve({ ...created });
}

export function identityRename(
  id: string,
  label: string,
): Promise<IdentitySummaryDto> {
  const row = state.identities.find((i) => i.id === id);
  if (!row) return Promise.reject(new Error("Identity not found"));
  row.label = label;
  return Promise.resolve({ ...row });
}

export function identitySetSyncSecret(
  id: string,
  syncSecret: boolean,
): Promise<IdentitySummaryDto> {
  const row = state.identities.find((i) => i.id === id);
  if (!row) return Promise.reject(new Error("Identity not found"));
  row.syncSecret = syncSecret;
  return Promise.resolve({ ...row });
}

export function identityDelete(
  id: string,
  force: boolean,
): Promise<IdentityDeleteResultDto> {
  const dependents = state.hosts
    .filter((h) => h.identityId === id)
    .map((h) => ({ id: h.id, label: h.label }));
  if (dependents.length > 0 && !force) {
    return Promise.resolve({ deleted: false, dependentHosts: dependents });
  }
  state.identities = state.identities.filter((i) => i.id !== id);
  if (force) {
    for (const host of state.hosts) {
      if (host.identityId === id) {
        host.identityId = null;
        host.authKind = host.hasPassword ? "password" : "none";
      }
    }
  }
  return Promise.resolve({ deleted: true, dependentHosts: [] });
}

// --- Projects / agents / sessions ---

export function listProjects(): Promise<ProjectSummaryDto[]> {
  return Promise.resolve(state.projects.map((p) => ({ ...p })));
}

export function listAgents(): Promise<AgentSpecDto[]> {
  return Promise.resolve(state.agents.map((a) => ({ ...a })));
}

export function createProject(
  project: ProjectMutation,
): Promise<ProjectSummaryDto> {
  const created: ProjectSummaryDto = {
    id: uid("proj"),
    name: project.name,
    location: project.location,
    defaultAgent: project.defaultAgent ?? null,
    assistKeyId: project.assistKeyId ?? null,
    lastOpened: null,
  };
  state.projects.push(created);
  return Promise.resolve({ ...created });
}

export function updateProject(
  id: string,
  project: ProjectMutation,
): Promise<ProjectSummaryDto> {
  const idx = state.projects.findIndex((p) => p.id === id);
  if (idx < 0) return Promise.reject(new Error("Project not found"));
  const next: ProjectSummaryDto = {
    ...state.projects[idx]!,
    name: project.name,
    location: project.location,
    defaultAgent: project.defaultAgent ?? null,
    assistKeyId: project.assistKeyId ?? null,
  };
  state.projects[idx] = next;
  return Promise.resolve({ ...next });
}

export function deleteProject(id: string): Promise<void> {
  state.projects = state.projects.filter((p) => p.id !== id);
  return Promise.resolve();
}

export function prepareProjectByok(
  projectId: string,
): Promise<ByokEnvHandleDto | null> {
  const project = state.projects.find((p) => p.id === projectId);
  if (!project?.assistKeyId) return Promise.resolve(null);
  const key = state.apiKeys.find((k) => k.id === project.assistKeyId);
  return Promise.resolve({
    envPath: "/tmp/tethra-mock-byok.env",
    varNames: ["ANTHROPIC_API_KEY"],
    keyLabel: key?.label ?? "key",
  });
}

export function touchProjectOpened(id: string): Promise<ProjectSummaryDto> {
  const project = state.projects.find((p) => p.id === id);
  if (!project) return Promise.reject(new Error("Project not found"));
  project.lastOpened = "2026-08-23T12:00:00Z";
  return Promise.resolve({ ...project });
}

export function listRunningSessions(): Promise<RunningSessionSummaryDto[]> {
  return Promise.resolve(state.sessions.map((s) => ({ ...s })));
}

export function markProjectRunning(
  projectId: string,
  hostId: string,
  agentId?: string,
): Promise<RunningSessionSummaryDto> {
  const project = state.projects.find((p) => p.id === projectId);
  const host = state.hosts.find((h) => h.id === hostId);
  const created: RunningSessionSummaryDto = {
    id: uid("run"),
    projectId,
    projectName: project?.name ?? "project",
    hostId,
    hostLabel: host?.label ?? hostId,
    agentId: agentId ?? null,
    muxSession: `tethra-${projectId}`,
    startedAt: "2026-08-23T12:00:00Z",
    lastAttachedAt: "2026-08-23T12:00:00Z",
    startedOnDevice: "mock-device",
  };
  state.sessions.push(created);
  return Promise.resolve({ ...created });
}

export function endRunningSession(id: string): Promise<void> {
  state.sessions = state.sessions.filter((s) => s.id !== id);
  return Promise.resolve();
}

// --- Assist ---

export function listAssistPresets(): Promise<ProviderPresetDto[]> {
  return Promise.resolve(PRESETS.map((p) => ({ ...p })));
}

export function assistTestProvider(
  _request: TestProviderRequest,
): Promise<TestProviderResultDto> {
  return Promise.resolve({
    ok: true,
    models: ["anthropic/claude-sonnet-4", "openai/gpt-4o", "llama3.2"],
    error: null,
  });
}

export function listApiKeys(): Promise<ApiKeySummaryDto[]> {
  return Promise.resolve(state.apiKeys.map((k) => ({ ...k })));
}

export function createApiKey(key: ApiKeyMutation): Promise<ApiKeySummaryDto> {
  const created: ApiKeySummaryDto = {
    id: uid("key"),
    label: key.label,
    provider: key.provider,
    baseUrl: key.baseUrl ?? null,
    model: key.model ?? null,
    syncSecret: key.syncSecret ?? false,
    hasKey: Boolean(key.apiKey),
  };
  state.apiKeys.push(created);
  return Promise.resolve({ ...created });
}

export function updateApiKey(
  id: string,
  key: ApiKeyMutation,
): Promise<ApiKeySummaryDto> {
  const idx = state.apiKeys.findIndex((k) => k.id === id);
  if (idx < 0) return Promise.reject(new Error("Key not found"));
  const prev = state.apiKeys[idx]!;
  const next: ApiKeySummaryDto = {
    ...prev,
    label: key.label,
    provider: key.provider,
    baseUrl: key.baseUrl ?? null,
    model: key.model ?? null,
    syncSecret: key.syncSecret ?? prev.syncSecret,
    hasKey: key.apiKey !== undefined ? Boolean(key.apiKey) : prev.hasKey,
  };
  state.apiKeys[idx] = next;
  return Promise.resolve({ ...next });
}

export function deleteApiKey(id: string): Promise<void> {
  state.apiKeys = state.apiKeys.filter((k) => k.id !== id);
  return Promise.resolve();
}

export function assistPropose(
  _apiKeyId: string,
  prompt: string,
  _context: AssistContextPayload,
): Promise<AssistProposeResultDto> {
  return Promise.resolve({
    command: `echo ${JSON.stringify(prompt.slice(0, 40))}`,
  });
}

export function assistExplain(
  _apiKeyId: string,
  prompt: string,
  _context: AssistContextPayload,
): Promise<AssistExplainResultDto> {
  return Promise.resolve({
    text: `Mock explain for: ${prompt.slice(0, 80)}`,
  });
}

// --- Mux / tools ---

export function detectLocalMux(): Promise<MuxEnsureResultDto> {
  return Promise.resolve({ ...MUX_OK });
}

export function installLocalMux(): Promise<MuxEnsureResultDto> {
  return Promise.resolve({ ...MUX_OK, installed: true });
}

export function ensureLocalMux(): Promise<MuxEnsureResultDto> {
  return detectLocalMux();
}

export function probeHostTools(
  _hostId: string | undefined,
  _commands: string[],
): Promise<ToolsProbeDto> {
  return Promise.resolve({
    platform: "linux",
    uname: "Linux mock 6.1",
    hasTmux: true,
    hasZellij: false,
    hasBrew: false,
    missing: [] as MissingToolDto[],
  });
}

export function terminalSessionAlive(sessionId: string): Promise<boolean> {
  return Promise.resolve(sessionId.startsWith("term-") || sessionId.startsWith("local-"));
}

export function killMuxSession(
  _hostId: string | undefined,
  _muxSession: string,
): Promise<void> {
  return Promise.resolve();
}

export function pruneStaleRunningSessions(): Promise<number> {
  return Promise.resolve(0);
}

export function pollSessionWatches(
  _hostId: string,
  muxSessions: string[],
): Promise<SessionWatchDto[]> {
  return Promise.resolve(
    muxSessions.map((muxSession) => ({
      muxSession,
      alert: "none",
      watchSupported: true,
      message: null,
    })),
  );
}

export function setDockBadge(_count: number): Promise<void> {
  return Promise.resolve();
}

export async function focusMainWindow(): Promise<void> {}

export async function sendAgentNotification(_options: {
  title: string;
  body: string;
  runningSessionId: string;
}): Promise<void> {}

export async function onAgentNotificationAction(
  handler: (runningSessionId: string) => void,
): Promise<() => void> {
  notifListeners.add(handler);
  return () => {
    notifListeners.delete(handler);
  };
}

// --- Terminal / tunnels ---

export function openTerminal(
  hostId: string,
  _cols: number,
  _rows: number,
  _muxSession?: string,
): Promise<OpenTerminalResultDto> {
  const sessionId = uid("term");
  lastTerminalSession = sessionId;
  feedBuf = "";
  feedIdx = 0;
  ensureSessionTunnels(sessionId, hostId);
  const skipFixture =
    typeof window !== "undefined" &&
    (window as unknown as Record<string, unknown>).__tethraSkipFixture === true;
  if (!skipFixture) {
    queueMicrotask(() => emitMockSessionFixture(sessionId));
  }
  const host = state.hosts.find((h) => h.id === hostId);
  if (host) {
    host.lastConnectedAt = new Date().toISOString();
  }
  return Promise.resolve({
    sessionId,
    agentForward: host?.forwardAgent ? "active" : "off",
    agentForwardHint: host?.forwardAgent
      ? "Agent forwarding active (mock)"
      : null,
  });
}

export function tunnelList(sessionId: string): Promise<TunnelStatusDto[]> {
  const rows = [...state.tunnelRuntime.values()].filter(
    (t) => t.sessionId === sessionId,
  );
  return Promise.resolve(rows.map((r) => ({ ...r })));
}

export function tunnelStart(
  sessionId: string,
  tunnelId: string,
): Promise<TunnelStatusDto> {
  const key = `${sessionId}:${tunnelId}`;
  const prev = state.tunnelRuntime.get(key);
  if (!prev) return Promise.reject(new Error("Tunnel not found"));
  const next: TunnelStatusDto = {
    ...prev,
    state: "active",
    boundPort: prev.bindPort,
    error: null,
    localUrl:
      prev.direction === "local" ? `http://localhost:${prev.bindPort}` : null,
  };
  state.tunnelRuntime.set(key, next);
  for (const listener of tunnelListeners) listener(next);
  return Promise.resolve({ ...next });
}

export function tunnelStop(
  sessionId: string,
  tunnelId: string,
): Promise<TunnelStatusDto> {
  const key = `${sessionId}:${tunnelId}`;
  const prev = state.tunnelRuntime.get(key);
  if (!prev) return Promise.reject(new Error("Tunnel not found"));
  const next: TunnelStatusDto = {
    ...prev,
    state: "stopped",
    boundPort: null,
    localUrl: null,
    error: null,
  };
  state.tunnelRuntime.set(key, next);
  for (const listener of tunnelListeners) listener(next);
  return Promise.resolve({ ...next });
}

export function onTunnelChanged(
  handler: (status: TunnelStatusDto) => void,
): Promise<UnlistenFn> {
  tunnelListeners.add(handler);
  return Promise.resolve(() => {
    tunnelListeners.delete(handler);
  });
}

export function openLocalTerminal(
  _cols: number,
  _rows: number,
  _cwd?: string,
): Promise<string> {
  const sessionId = uid("local");
  queueMicrotask(() => {
    emitTerminal(sessionId, {
      kind: "data",
      data: "\r\n\x1b[36mmock-local\x1b[0m$ ",
      dropped: false,
    });
  });
  return Promise.resolve(sessionId);
}

export function onTerminalEvent(
  handler: (sessionId: string, event: TerminalEvent) => void,
): Promise<UnlistenFn> {
  terminalListeners.add(handler);
  return Promise.resolve(() => {
    terminalListeners.delete(handler);
  });
}

export function suppressPtyUserInput(_durationMs = 800): void {}

export function sendTerminalInput(
  sessionId: string,
  data: Uint8Array,
  _options?: { force?: boolean },
): Promise<void> {
  const text = new TextDecoder().decode(data);
  // Terminal data events carry base64 (matches the Tauri backend).
  emitTerminal(sessionId, {
    kind: "data",
    data: b64Terminal(text),
    dropped: false,
  });
  if (text.includes("\r") || text.includes("\n")) {
    emitTerminal(sessionId, {
      kind: "data",
      data: b64Terminal("\r\nok\r\n$ "),
      dropped: false,
    });
  }
  return Promise.resolve();
}

export function resizeTerminal(
  _sessionId: string,
  _cols: number,
  _rows: number,
): Promise<void> {
  return Promise.resolve();
}

export function closeTerminal(sessionId: string): Promise<void> {
  emitTerminal(sessionId, { kind: "closed" });
  for (const key of [...state.tunnelRuntime.keys()]) {
    if (key.startsWith(`${sessionId}:`)) state.tunnelRuntime.delete(key);
  }
  return Promise.resolve();
}

export function respondHostKey(
  _promptId: string,
  _accepted: boolean,
): Promise<void> {
  return Promise.resolve();
}

export function onHostKeyPrompt(
  handler: (prompt: HostKeyPrompt) => void,
): Promise<UnlistenFn> {
  hostKeyListeners.add(handler);
  return Promise.resolve(() => {
    hostKeyListeners.delete(handler);
  });
}

export function onVaultStatus(
  handler: (status: VaultStatusDto) => void,
): Promise<UnlistenFn> {
  vaultListeners.add(handler);
  return Promise.resolve(() => {
    vaultListeners.delete(handler);
  });
}

export function onVaultLocked(handler: () => void): Promise<UnlistenFn> {
  vaultLockedListeners.add(handler);
  return Promise.resolve(() => {
    vaultLockedListeners.delete(handler);
  });
}

export function onSyncCompleted(
  handler: (report: SyncReportDto) => void,
): Promise<UnlistenFn> {
  syncListeners.add(handler);
  return Promise.resolve(() => {
    syncListeners.delete(handler);
  });
}

export function onMenuCommand(
  handler: (commandId: string) => void,
): Promise<UnlistenFn> {
  menuListeners.add(handler);
  return Promise.resolve(() => {
    menuListeners.delete(handler);
  });
}

// --- Files / SFTP ---

export function openExternal(url: string): Promise<void> {
  window.open(url, "_blank", "noopener,noreferrer");
  return Promise.resolve();
}

export function localHome(): Promise<string> {
  return Promise.resolve("/Users/mock");
}

const localFs = new Map<string, FileEntryDto[]>([
  [
    "/Users/mock",
    [
      {
        name: "Documents",
        path: "/Users/mock/Documents",
        fileType: "dir",
        size: null,
        modifiedUnix: 1_700_000_000n,
      },
      {
        name: "notes.txt",
        path: "/Users/mock/notes.txt",
        fileType: "file",
        size: 128n,
        modifiedUnix: 1_700_000_100n,
      },
    ],
  ],
  [
    "/Users/mock/Documents",
    [
      {
        name: "readme.md",
        path: "/Users/mock/Documents/readme.md",
        fileType: "file",
        size: 64n,
        modifiedUnix: 1_700_000_200n,
      },
    ],
  ],
]);

export function localList(path: string): Promise<FileEntryDto[]> {
  return Promise.resolve([...(localFs.get(path) ?? [])]);
}

export function localMkdir(path: string): Promise<void> {
  const parent = path.replace(/\/[^/]+$/, "") || "/";
  const name = path.split("/").pop() ?? path;
  const entries = localFs.get(parent) ?? [];
  entries.push({
    name,
    path,
    fileType: "dir",
    size: null,
    modifiedUnix: 1_700_000_300n,
  });
  localFs.set(parent, entries);
  localFs.set(path, []);
  return Promise.resolve();
}

export function localRename(from: string, to: string): Promise<void> {
  for (const [dir, entries] of localFs) {
    const idx = entries.findIndex((e) => e.path === from);
    if (idx >= 0) {
      const name = to.split("/").pop() ?? to;
      entries[idx] = { ...entries[idx]!, name, path: to };
      localFs.set(dir, entries);
      break;
    }
  }
  return Promise.resolve();
}

export function localRemove(path: string, _recursive: boolean): Promise<void> {
  for (const [dir, entries] of localFs) {
    localFs.set(
      dir,
      entries.filter((e) => e.path !== path),
    );
  }
  localFs.delete(path);
  return Promise.resolve();
}

export function openSftp(hostId: string): Promise<SftpOpenResult> {
  return Promise.resolve({
    sessionId: uid(`sftp-${hostId}`),
    remotePath: "/home/deploy",
  });
}

export function closeSftp(_sessionId: string): Promise<void> {
  return Promise.resolve();
}

export function sftpRemoteList(
  _sessionId: string,
  path: string,
): Promise<FileEntryDto[]> {
  return Promise.resolve([
    {
      name: "app",
      path: `${path.replace(/\/$/, "")}/app`,
      fileType: "dir",
      size: null,
      modifiedUnix: 1_700_000_400n,
    },
    {
      name: ".bashrc",
      path: `${path.replace(/\/$/, "")}/.bashrc`,
      fileType: "file",
      size: 256n,
      modifiedUnix: 1_700_000_500n,
    },
  ]);
}

export function sftpRemoteCanonicalize(
  _sessionId: string,
  path: string,
): Promise<string> {
  return Promise.resolve(path || "/home/deploy");
}

export function sftpRemoteCreateDirEntry(
  _sessionId: string,
  parent: string,
  name: string,
): Promise<FileEntryDto> {
  return Promise.resolve({
    name,
    path: `${parent.replace(/\/$/, "")}/${name}`,
    fileType: "dir",
    size: null,
    modifiedUnix: 1_700_000_600n,
  });
}

export function sftpRemoteRename(
  _sessionId: string,
  _from: string,
  _to: string,
): Promise<void> {
  return Promise.resolve();
}

export function sftpRemoteRemove(
  _sessionId: string,
  _path: string,
  _fileType: string,
): Promise<void> {
  return Promise.resolve();
}

export function sftpTransfer(
  _sessionId: string,
  transferId: string,
  _direction: "upload" | "download",
  _localPath: string,
  _remotePath: string,
  _offset: number,
  onProgress: (event: TransferEvent) => void,
): Promise<number> {
  onProgress({
    transferId,
    kind: "progress",
    bytesTransferred: 1024n,
    totalBytes: 1024n,
    message: null,
  });
  onProgress({
    transferId,
    kind: "done",
    bytesTransferred: 1024n,
    totalBytes: 1024n,
    message: null,
  });
  return Promise.resolve(1024);
}

export function cancelSftpTransfer(_transferId: string): Promise<void> {
  return Promise.resolve();
}

// --- Sync / updates ---

export function syncStatus(): Promise<SyncStatusDto> {
  return Promise.resolve({ ...state.sync });
}

export function syncConfigureFile(path: string): Promise<SyncStatusDto> {
  state.sync = {
    ...state.sync,
    configured: true,
    backendKind: "file",
    detail: path,
    deviceAuth: null,
    lastError: null,
  };
  return Promise.resolve({ ...state.sync });
}

export function syncConfigureHttp(
  url: string,
  _token?: string,
): Promise<SyncStatusDto> {
  state.sync = {
    ...state.sync,
    configured: true,
    backendKind: "http",
    detail: url,
    deviceAuth: "authenticated",
    lastError: null,
  };
  return Promise.resolve({ ...state.sync });
}

export function syncDisable(): Promise<SyncStatusDto> {
  state.sync = {
    configured: false,
    backendKind: "none",
    detail: null,
    deviceAuth: null,
    lastCursor: null,
    lastSyncedAt: null,
    lastError: null,
    lastPulled: 0,
    lastPushed: 0,
    lastApplied: 0,
  };
  return Promise.resolve({ ...state.sync });
}

export function syncPickFolder(): Promise<string | null> {
  return Promise.resolve("/Users/mock/TethraSync");
}

export function syncNow(): Promise<SyncReportDto> {
  const report: SyncReportDto = { pulled: 1, applied: 1, pushed: 1, cursor: "cur-43" };
  state.sync = {
    ...state.sync,
    lastPulled: report.pulled,
    lastApplied: report.applied,
    lastPushed: report.pushed,
    lastCursor: report.cursor,
    lastSyncedAt: "2026-08-23T12:00:00Z",
    lastError: null,
  };
  for (const listener of syncListeners) listener(report);
  return Promise.resolve(report);
}

export function updateCheck(): Promise<UpdateInfoDto> {
  return Promise.resolve({
    available: false,
    currentVersion: "0.4.0-mock",
    version: null,
    notes: null,
    pubDate: null,
  });
}

export function updateInstall(): Promise<void> {
  return Promise.resolve();
}

export function syncJoinHttp(
  url: string,
  _token?: string,
  _resetExisting = false,
  _password?: string,
): Promise<SyncJoinResultDto> {
  state.sync = {
    ...state.sync,
    configured: true,
    backendKind: "http",
    detail: url,
    deviceAuth: "enrolled",
  };
  return Promise.resolve({
    adopted: true,
    vaultExists: true,
    status: { ...state.sync },
  });
}

// --- App / window ---

export function getAppVersion(): Promise<string> {
  return Promise.resolve("0.4.0-mock");
}

export function currentWebviewLabel(): string {
  return "main";
}

export function onCurrentWebviewCloseRequested(
  _handler: (ctx: {
    preventDefault: () => void;
    destroy: () => Promise<void>;
  }) => void | Promise<void>,
): Promise<UnlistenFn> {
  return Promise.resolve(() => undefined);
}

export async function createWebviewWindow(
  _label: string,
  _options: CreateWebviewWindowOptions,
): Promise<void> {}

export async function activateWindowChrome(): Promise<void> {}

export function platformSystemAccent(): Promise<string | null> {
  return Promise.resolve(null);
}

export function windowMaterialCapabilities(): Promise<MaterialCapabilities> {
  return Promise.resolve({
    vibrancy: false,
    mica: false,
    acrylic: false,
    note: "Materials unavailable in browser mock",
  });
}

export function windowApplyMaterial(
  kind: string,
): Promise<MaterialApplyResult> {
  return Promise.resolve({ applied: kind, message: "Mock no-op" });
}

export async function writeClipboardText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export async function readClipboardText(): Promise<string> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return "";
  }
}
