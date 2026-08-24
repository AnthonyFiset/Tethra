import { useEffect, useMemo, useRef, useState } from "react";
import { AssistBar } from "./components/AssistBar";
import { CommandPalette } from "./components/CommandPalette";
import { FilesView } from "./components/FilesView";
import {
  Launcher,
  parseQuickConnect,
  type HostDraft,
} from "./components/Launcher";
import { LeftRail, type RailNavId } from "./components/LeftRail";
import { HostAvatar, DEFAULT_HOST_COLOR } from "./components/HostAvatar";
import { Logo } from "./components/Logo";
import {
  ToolsHintDialog,
  shouldShowToolsHint,
} from "./components/ToolsHintDialog";
import {
  SettingsModal,
  surfaceForSettingsSection,
  type SettingsSectionId,
} from "./components/SettingsModal";
import { AgentsSurface } from "./surfaces/AgentsSurface";
import { AssistSurface } from "./surfaces/AssistSurface";
import { IdentitiesSurface } from "./surfaces/IdentitiesSurface";
import { VaultSurface } from "./surfaces/VaultSurface";
import {
  type SurfaceId,
} from "./surfaces/SurfaceShell";
import { TitleBar } from "./components/TitleBar";
import { TunnelsView } from "./components/TunnelsView";
import { TunnelsPanel } from "./components/TunnelsPanel";
import { UpdateBanner } from "./components/UpdateBanner";
import { Button } from "./components/ui/Button";
import { Dialog } from "./components/ui/Dialog";
import { ErrorBanner } from "./components/ui/Field";
import { TooltipProvider } from "./components/ui/Tooltip";
import { HostFormModal } from "./hosts/HostFormModal";
import { SshConfigImportModal } from "./hosts/SshConfigImportModal";
import { SURFACE_NAV_EXPAND_MIN_PX } from "./lib/breakpoints";
import { getIdleLockSecs, getLandingPref } from "./lib/prefs";
import {
  mergeAttention,
  type SessionAttention,
} from "./lib/sessionAttention";
import { maybeNotifyAttention } from "./lib/agentNotify";
import {
  getAppVersion,
  closeSftp,
  closeTerminal,
  deleteHost,
  deleteProject,
  endRunningSession,
  killMuxSession,
  listAgents,
  listHosts,
  listProjects,
  listRunningSessions,
  localHome,
  markProjectRunning,
  onCurrentWebviewCloseRequested,
  onHostKeyPrompt,
  onMenuCommand,
  onSyncCompleted,
  onTerminalEvent,
  onTunnelChanged,
  onVaultLocked,
  onVaultStatus,
  pollSessionWatches,
  setDockBadge,
  focusMainWindow,
  onAgentNotificationAction,
  openExternal,
  openLocalTerminal,
  openSftp,
  openTerminal,
  probeHostTools,
  prepareProjectByok,
  pruneStaleRunningSessions,
  readClipboardText,
  resizeTerminal,
  respondHostKey,
  sendTerminalInput,
  syncNow,
  syncStatus,
  touchProjectOpened,
  tunnelList,
  updateCheck,
  updateProject,
  vaultLock,
  vaultSetIdleLockSecs,
  vaultStatus,
  writeClipboardText,
  type AssistContextPayload,
  type AgentSpecDto,
  type HostKeyPrompt,
  type HostSummaryDto,
  type ProjectSummaryDto,
  type RunningSessionSummaryDto,
  type SyncStatusDto,
  type TerminalEvent,
  type ToolsProbeDto,
  type VaultStatusDto,
} from "./lib/ipc";
import { ProjectFormModal } from "./projects/ProjectFormModal";
import { agentDisplayName, resolveAgentForLaunch } from "./projects/agents";
import { projectLaunchScript, sleep } from "./projects/launch";
import { SftpBrowser } from "./sftp/SftpBrowser";
import {
  clearTerminal,
  copyTerminalSelection,
  createTerminal,
  disposeTerminal,
  focusTerminal,
  persistProjectScrollback,
  resetTerminal,
  restoreProjectScrollback,
  writeTerminal,
  writeTerminalMessage,
} from "./terminal/registry";
import { injectShellText } from "./terminal/inject";
import { clearScrollbackSnapshot } from "./terminal/scrollback";
import {
  lastBlockCommand,
  queueBlockPhase,
  setBlockRerunHandler,
} from "./terminal/blocks";
import { SplitPanes } from "./terminal/SplitPanes";
import { SessionView } from "./components/SessionView";
import {
  type LayoutNode,
  leaf,
  splitLeaf,
  removeSession as removeFromLayout,
  containsSession,
} from "./terminal/layout";
import {
  currentWindowLabel,
  isMainWindow,
  moveTabsToNewWindow,
  openWorkspaceWindow,
  takePendingTransfer,
  workspaceBus,
  type WorkspaceTab,
  type WorkspaceTransfer,
} from "./terminal/windows";
import { VaultGate } from "./vault/VaultGate";

interface Tab {
  sessionId: string;
  hostId: string;
  title: string;
  kind: "terminal" | "local" | "sftp";
  connected: boolean;
  color?: string | null;
  remotePath?: string;
  localPath?: string;
  /** Last OSC 7 working directory, when reported. */
  cwd?: string;
  /** Last OSC 133;G git branch, when reported. */
  gitBranch?: string;
  /** Vault project id when this tab was opened from a project. */
  projectId?: string;
  /** `off` | `active` | `unavailable` — SSH agent forwarding for this session. */
  agentForward?: string;
  agentForwardHint?: string;
}

/** Dedupe paste when macOS fires both keydown and Edit→Paste. */
let lastTerminalPasteAt = 0;

export default function App(): React.JSX.Element {
  const [status, setStatus] = useState<VaultStatusDto>();
  const [bootError, setBootError] = useState<string>();
  const [workspaceOpened, setWorkspaceOpened] = useState(false);

  useEffect(() => {
    vaultStatus()
      .then(setStatus)
      .catch((reason: unknown) => setBootError(String(reason)));

    let unlistenStatus: (() => void) | undefined;
    let unlistenLocked: (() => void) | undefined;
    onVaultStatus(setStatus).then((fn) => {
      unlistenStatus = fn;
    });
    onVaultLocked(() => {
      setStatus((current) =>
        current
          ? { ...current, unlocked: false }
          : { exists: true, unlocked: false, recoveryAvailable: false },
      );
    }).then((fn) => {
      unlistenLocked = fn;
    });

    return () => {
      unlistenStatus?.();
      unlistenLocked?.();
    };
  }, []);

  useEffect(() => {
    if (status?.unlocked) {
      setWorkspaceOpened(true);
    }
  }, [status?.unlocked]);

  if (bootError) {
    return (
      <Splash title="Unable to open vault" kicker="Error">
        <ErrorBanner>{bootError}</ErrorBanner>
      </Splash>
    );
  }

  if (!status) {
    return <Splash title="Loading…" kicker="Encrypted vault" />;
  }

  if (!status.unlocked && !workspaceOpened) {
    return <VaultGate status={status} onUnlocked={setStatus} />;
  }

  return (
    <TooltipProvider>
      <div className="relative size-full">
        <Workspace status={status} onStatus={setStatus} />
        {!status.unlocked && (
          <div className="absolute inset-0 z-50">
            <VaultGate status={status} onUnlocked={setStatus} />
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

function Splash({
  title,
  kicker,
  children,
}: {
  title: string;
  kicker: string;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      data-tauri-drag-region="deep"
      className="grid size-full place-items-center bg-base p-6"
    >
      <div className="w-full max-w-sm rounded-panel border border-line bg-surface p-6">
        <Logo variant="lockup" size={26} className="mb-5" />
        <span className="mb-1.5 block text-micro font-semibold tracking-[0.1em] text-fg-subtle uppercase">
          {kicker}
        </span>
        <h1 className="m-0 mb-3 text-lg font-semibold">{title}</h1>
        {children}
      </div>
    </div>
  );
}

function Workspace({
  status,
  onStatus,
}: {
  status: VaultStatusDto;
  onStatus: (status: VaultStatusDto) => void;
}): React.JSX.Element {
  const [hosts, setHosts] = useState<HostSummaryDto[]>([]);
  const [projects, setProjects] = useState<ProjectSummaryDto[]>([]);
  const [agents, setAgents] = useState<AgentSpecDto[]>([]);
  const [runningSessions, setRunningSessions] = useState<
    RunningSessionSummaryDto[]
  >([]);
  /** Ephemeral attention keyed by running-session id. */
  const [sessionAttention, setSessionAttention] = useState<
    Record<string, SessionAttention>
  >({});
  /** Attention keyed by attached PTY session id (host tabs without a running row). */
  const [ptyAttention, setPtyAttention] = useState<
    Record<string, SessionAttention>
  >({});
  /** PTY session id → running session id (while attached). */
  const ptyToRunning = useRef(new Map<string, string>());
  const runningSessionsRef = useRef(runningSessions);
  runningSessionsRef.current = runningSessions;
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [appMode, setAppMode] = useState<"launcher" | "workspace">("launcher");
  const [activeId, setActiveId] = useState<string>();
  const [layout, setLayout] = useState<LayoutNode | null>(null);
  const [zoomedId, setZoomedId] = useState<string>();
  const [findSessionId, setFindSessionId] = useState<string>();
  const [tunnelActiveBySession, setTunnelActiveBySession] = useState<
    Record<string, number>
  >({});
  const [narrow, setNarrow] = useState(() =>
    window.matchMedia("(max-width: 767px)").matches,
  );
  const outputHandlers = useRef(new Map<string, (event: TerminalEvent) => void>());
  const transcripts = useRef(new Map<string, string>());
  const lastExitCodes = useRef(new Map<string, number>());
  const [connectingHostId, setConnectingHostId] = useState<string>();
  const [openingFilesHostId, setOpeningFilesHostId] = useState<string>();
  const [openingProjectId, setOpeningProjectId] = useState<string>();
  const [openingLocal, setOpeningLocal] = useState(false);
  const [error, setError] = useState<string>();
  const [prompt, setPrompt] = useState<HostKeyPrompt>();
  const [editor, setEditor] = useState<HostSummaryDto | "new">();
  const [hostDraft, setHostDraft] = useState<HostDraft>();
  const [projectEditor, setProjectEditor] = useState<
    ProjectSummaryDto | "new"
  >();
  const [importOpen, setImportOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<HostSummaryDto>();
  const [pendingDeleteProject, setPendingDeleteProject] =
    useState<ProjectSummaryDto>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] =
    useState<SettingsSectionId>("general");
  const [activeSurface, setActiveSurface] = useState<SurfaceId | null>(null);
  const [railNav, setRailNav] = useState<RailNavId>("hosts");
  const [syncInfo, setSyncInfo] = useState<SyncStatusDto>();
  const [railCollapsed, setRailCollapsed] = useState(
    () =>
      !window.matchMedia(`(min-width: ${SURFACE_NAV_EXPAND_MIN_PX}px)`).matches,
  );
  const [assistOpen, setAssistOpen] = useState(false);
  const [assistKeysEpoch, setAssistKeysEpoch] = useState(0);
  const [muxHint, setMuxHint] = useState<{
    probe: ToolsProbeDto;
    sessionId: string;
  }>();
  const [agentNotice, setAgentNotice] = useState<string>();
  const [aboutOpen, setAboutOpen] = useState(false);
  const [appVersion, setAppVersion] = useState<string>();
  const [paletteOpen, setPaletteOpen] = useState(false);

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const zoomedIdRef = useRef(zoomedId);
  zoomedIdRef.current = zoomedId;
  const menuHandlerRef = useRef<(commandId: string) => void>(() => undefined);

  useEffect(() => {
    void getAppVersion()
      .then(setAppVersion)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    listHosts()
      .then(setHosts)
      .catch((reason: unknown) => setError(String(reason)));
    listProjects()
      .then(setProjects)
      .catch((reason: unknown) => setError(String(reason)));
    listAgents()
      .then(setAgents)
      .catch((reason: unknown) => setError(String(reason)));
    void refreshRunningSessions().catch((reason: unknown) =>
      setError(String(reason)),
    );
    let unlistenPrompt: (() => void) | undefined;
    let unlistenSync: (() => void) | undefined;
    onHostKeyPrompt(setPrompt).then((fn) => {
      unlistenPrompt = fn;
    });
    onSyncCompleted(() => {
      void listHosts()
        .then(setHosts)
        .catch((reason: unknown) => setError(String(reason)));
      void listProjects()
        .then(setProjects)
        .catch((reason: unknown) => setError(String(reason)));
      void refreshRunningSessions().catch((reason: unknown) =>
        setError(String(reason)),
      );
    }).then((fn) => {
      unlistenSync = fn;
    });
    return () => {
      unlistenPrompt?.();
      unlistenSync?.();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void onTerminalEvent((sessionId, event) => {
      outputHandlers.current.get(sessionId)?.(event);
    }).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void onTunnelChanged((status) => {
      void tunnelList(status.sessionId)
        .then((list) => {
          if (cancelled) return;
          const active = list.filter((t) => t.state === "active").length;
          setTunnelActiveBySession((current) => ({
            ...current,
            [status.sessionId]: active,
          }));
        })
        .catch(() => undefined);
    }).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${SURFACE_NAV_EXPAND_MIN_PX}px)`);
    const onChange = () => setRailCollapsed(!mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!status.unlocked) return;
    void syncStatus()
      .then(setSyncInfo)
      .catch(() => undefined);
  }, [status.unlocked]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!status.unlocked) return;

    let timer: number | undefined;
    function refreshFromSync(): void {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void syncNow()
          .then(() => Promise.all([listHosts(), listProjects()]))
          .then(([nextHosts, nextProjects]) => {
            setHosts(nextHosts);
            setProjects(nextProjects);
            return refreshRunningSessions();
          })
          .catch(() => undefined);
      }, 500);
    }

    function onVisibility(): void {
      if (document.visibilityState === "visible") refreshFromSync();
    }
    function onFocus(): void {
      refreshFromSync();
    }

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [status.unlocked]);

  useEffect(() => {
    if (!status.unlocked) {
      const closing = tabsRef.current.filter(
        (tab) => tab.kind === "terminal" || tab.kind === "local",
      );
      void (async () => {
        for (const tab of closing) {
          if (tab.projectId) {
            await persistProjectScrollback(tab.sessionId, tab.projectId);
          }
          disposeTerminal(tab.sessionId);
          outputHandlers.current.delete(tab.sessionId);
        }
      })();
      setLayout(null);
      setZoomedId(undefined);
      setAppMode("launcher");
      setTabs((current) => {
        const local = current.filter((tab) => tab.kind === "local");
        setActiveId((active) =>
          local.some((tab) => tab.sessionId === active)
            ? active
            : local[0]?.sessionId,
        );
        return local;
      });
      setPrompt(undefined);
      setEditor(undefined);
      setImportOpen(false);
      setPendingDelete(undefined);
      setPaletteOpen(false);
      setSettingsOpen(false);
    } else {
      void vaultSetIdleLockSecs(getIdleLockSecs()).catch(() => undefined);
      if (getLandingPref() === "workspace") {
        setAppMode("workspace");
      }
    }
  }, [status.unlocked]);

  function handleRailNav(nav: RailNavId): void {
    setRailNav(nav);
    if (nav === "hosts") {
      goLauncher();
      return;
    }
    if (nav === "identities") {
      openSurface("identities");
      return;
    }
    if (nav === "assist") {
      openSurface("assist");
      return;
    }
    setActiveSurface(null);
    if (appMode === "workspace") {
      goLauncher();
    }
  }

  function adoptTransfer(transfer: WorkspaceTransfer): void {
    setTabs((current) => {
      const byId = new Map(current.map((tab) => [tab.sessionId, tab]));
      for (const tab of transfer.tabs) {
        byId.set(tab.sessionId, tab);
      }
      return [...byId.values()];
    });

    if (transfer.layoutJson) {
      try {
        setLayout(JSON.parse(transfer.layoutJson) as LayoutNode);
      } catch {
        setLayout(null);
      }
    } else {
      setLayout(null);
    }

    if (transfer.activeId) setActiveId(transfer.activeId);
    if (transfer.zoomedId) setZoomedId(transfer.zoomedId);

    for (const tab of transfer.tabs) {
      if (tab.kind === "terminal" || tab.kind === "local") {
        wireTerminal(tab.sessionId);
        void attachOutput(
          tab.sessionId,
          tab.kind === "local" ? "Local shell closed." : "Connection closed.",
          tab.projectId ? { restoreProjectId: tab.projectId } : undefined,
        );
      }
    }
  }

  useEffect(() => {
    const label = currentWindowLabel();
    const bus = workspaceBus();

    bus.onmessage = (event) => {
      const transfer = event.data as WorkspaceTransfer;
      if (transfer.fromLabel === label) return;
      if (transfer.type === "adopt" && transfer.toLabel === label) {
        adoptTransfer(transfer);
      } else if (transfer.type === "reclaim" && isMainWindow()) {
        adoptTransfer(transfer);
      }
    };

    const pending = takePendingTransfer(label);
    if (pending) adoptTransfer(pending);

    return () => {
      bus.close();
    };
  }, []);

  useEffect(() => {
    if (isMainWindow()) return;

    let unlisten: (() => void) | undefined;

    void onCurrentWebviewCloseRequested(async ({ preventDefault, destroy }) => {
      preventDefault();

      const currentTabs = tabsRef.current;
      const currentLayout = layoutRef.current;
      const bus = workspaceBus();
      bus.postMessage({
        type: "reclaim",
        fromLabel: currentWindowLabel(),
        tabs: currentTabs as WorkspaceTab[],
        layoutJson: currentLayout ? JSON.stringify(currentLayout) : null,
        activeId: activeIdRef.current,
        zoomedId: zoomedIdRef.current,
      } satisfies WorkspaceTransfer);
      bus.close();

      for (const tab of currentTabs) {
        if (tab.kind === "terminal" || tab.kind === "local") {
          if (tab.projectId) {
            await persistProjectScrollback(tab.sessionId, tab.projectId);
          }
          disposeTerminal(tab.sessionId);
          outputHandlers.current.delete(tab.sessionId);
        }
      }

      await destroy();
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, []);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.sessionId === activeId),
    [activeId, tabs],
  );

  function toggleRail(): void {
    setRailCollapsed((value) => !value);
  }

  async function attachOutput(
    sessionId: string,
    closedMessage: string,
    options?: { restoreProjectId?: string },
  ): Promise<void> {
    const pending: TerminalEvent[] = [];
    let ready = !options?.restoreProjectId;

    function applyPtyAttention(
      ptyId: string,
      next: SessionAttention,
      source: string,
    ): void {
      setPtyAttention((current) => {
        const merged = mergeAttention(current[ptyId], next, source);
        if (
          current[ptyId]?.state === merged.state &&
          current[ptyId]?.message === merged.message
        ) {
          return current;
        }
        return { ...current, [ptyId]: merged };
      });

      const runningId = ptyToRunning.current.get(ptyId);
      if (!runningId) return;
      setSessionAttention((current) => {
        const merged = mergeAttention(current[runningId], next, source);
        if (
          current[runningId]?.state === merged.state &&
          current[runningId]?.message === merged.message
        ) {
          return current;
        }
        const session = runningSessionsRef.current.find((s) => s.id === runningId);
        if (merged.state !== current[runningId]?.state && merged.state !== "running") {
          void maybeNotifyAttention({
            state: merged.state,
            title: session?.projectName ?? "Agent",
            body: merged.message,
            runningSessionId: runningId,
          });
        }
        return { ...current, [runningId]: merged };
      });
    }

    const handle = (event: TerminalEvent) => {
      if (event.kind === "data") {
        const bytes = decodeBase64(event.data);
        writeTerminal(sessionId, bytes);
        appendTranscript(sessionId, bytes);
        if (event.dropped) {
          writeTerminalMessage(
            sessionId,
            "\x1b[33mSome output was dropped because rendering fell behind.\x1b[0m",
          );
        }
      } else if (event.kind === "block") {
        const exitRaw = event as {
          exit_code?: number | null;
          exitCode?: number | null;
        };
        const exitCode =
          typeof exitRaw.exitCode === "number"
            ? exitRaw.exitCode
            : typeof exitRaw.exit_code === "number"
              ? exitRaw.exit_code
              : null;
        queueBlockPhase(sessionId, event.phase, exitCode);
        if (typeof exitCode === "number") {
          lastExitCodes.current.set(sessionId, exitCode);
        }
        if (event.phase === "commandEnd" && typeof exitCode === "number") {
          applyPtyAttention(sessionId, {
            state: exitCode === 0 ? "done" : "failed",
            message: undefined,
          }, "exit");
        } else if (
          event.phase === "commandStart" ||
          event.phase === "outputStart"
        ) {
          applyPtyAttention(sessionId, { state: "running" }, "activity");
        }
      } else if (event.kind === "attention") {
        applyPtyAttention(
          sessionId,
          {
            state: event.state,
            message: event.message ?? undefined,
          },
          event.source,
        );
      } else if (event.kind === "closed") {
        setTabs((current) =>
          current.map((tab) =>
            tab.sessionId === sessionId ? { ...tab, connected: false } : tab,
          ),
        );
        writeTerminalMessage(sessionId, `\x1b[90m${closedMessage}\x1b[0m`);
      }
    };

    outputHandlers.current.set(sessionId, (event) => {
      if (!ready) {
        pending.push(event);
        return;
      }
      handle(event);
    });

    if (options?.restoreProjectId) {
      await restoreProjectScrollback(sessionId, options.restoreProjectId);
      ready = true;
      for (const event of pending) {
        handle(event);
      }
    }
  }

  function appendTranscript(sessionId: string, bytes: Uint8Array): void {
    const chunk = new TextDecoder().decode(bytes);
    const prev = transcripts.current.get(sessionId) ?? "";
    const next = (prev + chunk).slice(-16_384);
    transcripts.current.set(sessionId, next);
  }

  function assistContextForActive(): AssistContextPayload | undefined {
    if (!activeTab || (activeTab.kind !== "terminal" && activeTab.kind !== "local")) {
      return undefined;
    }
    const host =
      activeTab.kind === "local"
        ? undefined
        : hosts.find((entry) => entry.id === activeTab.hostId);
    return {
      cwd: activeTab.cwd,
      hostLabel:
        activeTab.kind === "local"
          ? "Local"
          : (host?.label ?? activeTab.title),
      isLocal: activeTab.kind === "local",
      transcriptTail: transcripts.current.get(activeTab.sessionId) ?? "",
      lastExitCode: lastExitCodes.current.get(activeTab.sessionId),
    };
  }

  function insertAssistCommand(command: string): void {
    if (!activeTab || (activeTab.kind !== "terminal" && activeTab.kind !== "local")) {
      return;
    }
    // Never append newline — user must press Enter to run.
    injectShellText(activeTab.sessionId, command, { run: false });
  }

  function wireTerminal(sessionId: string): void {
    createTerminal(sessionId, {
      onInput: (data) => {
        void sendTerminalInput(sessionId, data).catch((reason: unknown) => {
          writeTerminalMessage(sessionId, `Input error: ${String(reason)}`);
        });
      },
      onResize: (cols, rows) => {
        void resizeTerminal(sessionId, cols, rows);
      },
      onCwd: (cwd) => {
        setTabs((current) =>
          current.map((tab) =>
            tab.sessionId === sessionId ? { ...tab, cwd } : tab,
          ),
        );
      },
      onGitBranch: (gitBranch) => {
        setTabs((current) =>
          current.map((tab) =>
            tab.sessionId === sessionId ? { ...tab, gitBranch } : tab,
          ),
        );
      },
    });
    setBlockRerunHandler(sessionId, (command) => {
      injectShellText(sessionId, command, { run: false });
    });
  }

  /**
   * Focus a session in the tab bar. For a single leaf, always retarget the
   * layout. Only keep an existing layout when it's a split that already
   * contains the session (pane focus within a split).
   */
  function activateSession(sessionId: string): void {
    setActiveId(sessionId);
    setZoomedId((current) =>
      current && current !== sessionId ? undefined : current,
    );
    setLayout((current) => {
      if (current?.type === "split" && containsSession(current, sessionId)) {
        return current;
      }
      return leaf(sessionId);
    });
  }

  function enterWorkspace(): void {
    setAppMode("workspace");
  }

  function openSettings(section: SettingsSectionId | string = "general"): void {
    const surface = surfaceForSettingsSection(section);
    if (surface) {
      openSurface(surface);
      return;
    }
    const prefSections: SettingsSectionId[] = [
      "general",
      "appearance",
      "terminal",
      "shell",
      "keyboard",
      "advanced",
    ];
    setSettingsSection(
      prefSections.includes(section as SettingsSectionId)
        ? (section as SettingsSectionId)
        : "general",
    );
    setActiveSurface(null);
    setSettingsOpen(true);
  }

  function openSurface(surface: SurfaceId): void {
    setSettingsOpen(false);
    setPaletteOpen(false);
    setActiveSurface(surface);
    if (surface === "identities") setRailNav("identities");
    if (surface === "assist") setRailNav("assist");
  }

  function closeSurface(): void {
    setActiveSurface(null);
    if (railNav === "identities" || railNav === "assist") {
      setRailNav("hosts");
    }
  }

  /** View change only — never kills PTYs or remote mux sessions. */
  function goLauncher(): void {
    setAppMode("launcher");
    setAssistOpen(false);
    setZoomedId(undefined);
    if (!activeSurface) {
      setRailNav("hosts");
    }
  }

  function pasteIntoTerminal(sessionId: string, text: string): void {
    // Debounce: macOS may deliver both the keydown and the Edit→Paste.
    const now = Date.now();
    if (now - lastTerminalPasteAt < 80) return;
    lastTerminalPasteAt = now;
    injectShellText(sessionId, text, { run: false, clearLine: false });
  }

  function isEditableField(el: Element | null): boolean {
    if (!el || !(el instanceof HTMLElement)) return false;
    // xterm keeps a hidden textarea for input — that is NOT a form field.
    if (el.closest(".xterm")) return false;
    return (
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el.isContentEditable
    );
  }

  function handleMenuCommand(commandId: string): void {
    const active = tabsRef.current.find(
      (tab) => tab.sessionId === activeIdRef.current,
    );
    const terminalActive =
      active && (active.kind === "terminal" || active.kind === "local");

    switch (commandId) {
      case "app.settings":
        openSettings("general");
        break;
      case "app.lock":
        void lockNow();
        break;
      case "app.check_updates":
        void updateCheck()
          .then((info) => {
            if (info.available) {
              setError(
                `Update available: ${info.version ?? "new version"}. Use the update banner to install.`,
              );
            } else {
              setError("You're on the latest version.");
            }
          })
          .catch((reason: unknown) => setError(String(reason)));
        break;
      case "file.new_terminal":
        if (active && active.kind !== "sftp" && active.hostId !== "local") {
          const host = hosts.find((h) => h.id === active.hostId);
          if (host) void connect(host);
        } else if (hosts[0]) {
          void connect(hosts[0]);
        }
        break;
      case "file.new_local":
        void openLocal();
        break;
      case "file.new_window":
        openNewWindow();
        break;
      case "file.open_project":
        goLauncher();
        setPaletteOpen(true);
        break;
      case "file.import_ssh":
        setImportOpen(true);
        break;
      case "file.close_tab":
        if (activeIdRef.current) void closeTab(activeIdRef.current);
        break;
      case "edit.copy": {
        const el = document.activeElement;
        if (isEditableField(el)) {
          const dom = window.getSelection()?.toString() ?? "";
          if (dom) {
            void writeClipboardText(dom).then((ok) => {
              if (!ok) setError("Couldn't copy to the clipboard.");
            });
            break;
          }
        }
        if (terminalActive && active) {
          void copyTerminalSelection(active.sessionId).then((ok) => {
            if (!ok) setError("Nothing to copy — select text in the terminal first.");
          });
        }
        break;
      }
      case "edit.paste": {
        const el = document.activeElement;
        if (isEditableField(el)) {
          void readClipboardText().then((text) => {
            if (!text) {
              setError("Clipboard is empty.");
              return;
            }
            if (
              el instanceof HTMLInputElement ||
              el instanceof HTMLTextAreaElement
            ) {
              const start = el.selectionStart ?? el.value.length;
              const end = el.selectionEnd ?? el.value.length;
              el.setRangeText(text, start, end, "end");
              el.dispatchEvent(new Event("input", { bubbles: true }));
            } else {
              document.execCommand("insertText", false, text);
            }
          });
          break;
        }
        if (terminalActive && active) {
          void readClipboardText().then((text) => {
            if (!text) {
              setError("Clipboard is empty.");
              return;
            }
            pasteIntoTerminal(active.sessionId, text);
          });
        }
        break;
      }
      case "view.toggle_sidebar":
        toggleRail();
        break;
      case "view.launcher":
        goLauncher();
        break;
      case "view.split_right":
        void splitPane("horizontal");
        break;
      case "view.split_down":
        void splitPane("vertical");
        break;
      case "view.zoom_pane":
        toggleZoom();
        break;
      case "terminal.clear":
        if (terminalActive && active) clearTerminal(active.sessionId);
        break;
      case "terminal.find":
        if (terminalActive && active) setFindSessionId(active.sessionId);
        break;
      case "terminal.reset":
        if (terminalActive && active) resetTerminal(active.sessionId);
        break;
      case "terminal.assist":
        if (terminalActive) setAssistOpen(true);
        break;
      case "terminal.rerun_last":
        if (terminalActive && active) {
          const cmd = lastBlockCommand(active.sessionId);
          if (cmd) injectShellText(active.sessionId, cmd, { run: false });
        }
        break;
      case "go.palette":
        setPaletteOpen(true);
        break;
      case "go.next_tab": {
        const list = tabsRef.current;
        if (list.length === 0) break;
        const idx = list.findIndex(
          (tab) => tab.sessionId === activeIdRef.current,
        );
        const next = list[(idx + 1) % list.length];
        if (next) selectTab(next.sessionId);
        break;
      }
      case "go.prev_tab": {
        const list = tabsRef.current;
        if (list.length === 0) break;
        const idx = list.findIndex(
          (tab) => tab.sessionId === activeIdRef.current,
        );
        const prev = list[(idx - 1 + list.length) % list.length];
        if (prev) selectTab(prev.sessionId);
        break;
      }
      case "help.docs":
        void openExternal(
          "https://github.com/AnthonyFiset/Tethra/blob/main/HANDOFF.md",
        ).catch((reason: unknown) => setError(String(reason)));
        break;
      case "help.shortcuts":
        setPaletteOpen(true);
        break;
      case "help.issue":
        void openExternal(
          "https://github.com/AnthonyFiset/Tethra/issues",
        ).catch((reason: unknown) => setError(String(reason)));
        break;
      case "help.release_notes":
        void openExternal(
          "https://github.com/AnthonyFiset/Tethra/releases",
        ).catch((reason: unknown) => setError(String(reason)));
        break;
      default:
        break;
    }
  }
  menuHandlerRef.current = handleMenuCommand;

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void onMenuCommand((commandId) => {
      menuHandlerRef.current(commandId);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  function selectTab(sessionId: string): void {
    activateSession(sessionId);
    enterWorkspace();
    const tab = tabs.find((item) => item.sessionId === sessionId);
    if (tab && tab.kind !== "sftp") focusTerminal(sessionId);
  }


  const openHostIds = useMemo(() => {
    const ids = new Set<string>();
    for (const tab of tabs) {
      if (tab.hostId && tab.hostId !== "local") ids.add(tab.hostId);
    }
    return ids;
  }, [tabs]);

  function openAgentOnHost(host: HostSummaryDto): void {
    const related = projects
      .filter(
        (project) =>
          project.location.kind === "remote" &&
          project.location.hostId === host.id,
      )
      .sort((a, b) => {
        const aT = a.lastOpened ? Date.parse(a.lastOpened) : 0;
        const bT = b.lastOpened ? Date.parse(b.lastOpened) : 0;
        return bT - aT;
      });
    if (related[0]) {
      void openProject(related[0]);
      return;
    }
    setError(`No project on ${host.label} yet — create one to launch an agent.`);
  }

  function handleQuickConnect(target: string): void {
    const draft = parseQuickConnect(target);
    if (!draft) {
      setError("Quick connect expects user@host or user@host:port.");
      return;
    }
    const match = hosts.find(
      (host) =>
        host.username === draft.username &&
        host.hostname === draft.hostname &&
        host.port === draft.port,
    );
    if (match) {
      void connect(match);
      return;
    }
    setHostDraft(draft);
    setEditor("new");
  }

  async function connect(host: HostSummaryDto): Promise<void> {
    setError(undefined);
    setConnectingHostId(host.id);
    try {
      const opened = await openTerminal(host.id, 80, 24);
      const sessionId = opened.sessionId;
      wireTerminal(sessionId);
      void attachOutput(sessionId, "Connection closed.");
      setTabs((current) => [
        ...current,
        {
          sessionId,
          hostId: host.id,
          title: host.label,
          kind: "terminal",
          connected: true,
          color: host.color,
          agentForward: opened.agentForward,
          agentForwardHint: opened.agentForwardHint ?? undefined,
        },
      ]);
      activateSession(sessionId);
      enterWorkspace();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setConnectingHostId(undefined);
    }
  }

  async function openLocal(): Promise<void> {
    setError(undefined);
    setOpeningLocal(true);
    try {
      const sessionId = await openLocalTerminal(80, 24);
      wireTerminal(sessionId);
      void attachOutput(sessionId, "Local shell closed.");
      setTabs((current) => [
        ...current,
        {
          sessionId,
          hostId: "local",
          title: "Local",
          kind: "local",
          connected: true,
          color: "#8B8B8B",
        },
      ]);
      activateSession(sessionId);
      enterWorkspace();

      void maybeShowToolsHint(sessionId, undefined, []);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setOpeningLocal(false);
    }
  }

  async function maybeShowToolsHint(
    sessionId: string,
    hostId: string | undefined,
    agentCommands: string[],
  ): Promise<void> {
    try {
      const probe = await probeHostTools(hostId, agentCommands);
      if (shouldShowToolsHint(probe)) {
        setMuxHint({ probe, sessionId });
      }
    } catch {
      // Probe is best-effort — never block opening a session.
    }
  }

  function insertToolCommand(
    sessionId: string,
    command: string,
    run: boolean,
  ): void {
    injectShellText(sessionId, command, { run });
  }

  async function openProject(project: ProjectSummaryDto): Promise<void> {
    setError(undefined);
    setOpeningProjectId(project.id);
    try {
      const agents = await listAgents();
      const { agent, migratedFrom } = resolveAgentForLaunch(
        agents,
        project.defaultAgent,
      );
      if (migratedFrom && agent) {
        setAgentNotice(
          `${migratedFrom} is deprecated — launching ${agent.name}. Updated this project’s default agent.`,
        );
        void updateProject(project.id, {
          name: project.name,
          location: project.location,
          defaultAgent: agent.id,
          assistKeyId: project.assistKeyId,
        })
          .then((saved) => {
            setProjects((current) => {
              const index = current.findIndex((item) => item.id === saved.id);
              if (index === -1) return [...current, saved];
              const next = [...current];
              next[index] = saved;
              return next;
            });
          })
          .catch(() => undefined);
      } else {
        setAgentNotice(undefined);
      }

      // Focus an already-open tab for this project.
      const existing = tabsRef.current.find(
        (tab) => tab.projectId === project.id,
      );
      if (existing) {
        activateSession(existing.sessionId);
        enterWorkspace();
        if (existing.kind !== "sftp") focusTerminal(existing.sessionId);
        return;
      }

      // Probe the real machine (local or remote) — never the wrong OS.
      const probeHostId =
        project.location.kind === "remote"
          ? project.location.hostId
          : undefined;
      const agentCmds =
        agent?.command?.trim() && agent.id !== "shell"
          ? [agent.command.trim()]
          : [];
      const probe = await probeHostTools(probeHostId, agentCmds).catch(
        () => undefined,
      );
      const muxOnHost = Boolean(probe?.hasTmux || probe?.hasZellij);

      let sessionId: string;
      let agentForward: string | undefined;
      let agentForwardHint: string | undefined;
      let hostId: string;
      let color: string | null | undefined;
      let kind: Tab["kind"];
      let cwdAlreadySet = false;

      if (project.location.kind === "local") {
        sessionId = await openLocalTerminal(80, 24, project.location.path);
        hostId = "local";
        color = "#8B8B8B";
        kind = "local";
        cwdAlreadySet = true;
      } else {
        const host = hosts.find(
          (entry) =>
            project.location.kind === "remote" &&
            entry.id === project.location.hostId,
        );
        if (!host) {
          throw new Error("Project host is missing from the vault.");
        }
        const opened = await openTerminal(host.id, 80, 24);
        sessionId = opened.sessionId;
        agentForward = opened.agentForward;
        agentForwardHint = opened.agentForwardHint ?? undefined;
        hostId = host.id;
        color = host.color;
        kind = "terminal";
      }

      wireTerminal(sessionId);
      await attachOutput(sessionId, "Connection closed.", {
        restoreProjectId: project.id,
      });
      setTabs((current) => [
        ...current,
        {
          sessionId,
          hostId,
          title: project.name,
          kind,
          connected: true,
          color,
          projectId: project.id,
          agentForward,
          agentForwardHint,
        },
      ]);
      activateSession(sessionId);
      enterWorkspace();

      if (probe && shouldShowToolsHint(probe)) {
        setMuxHint({ probe, sessionId });
      }

      await sleep(450);
      const byok = await prepareProjectByok(project.id).catch(() => null);
      const script = projectLaunchScript({
        projectId: project.id,
        path: project.location.path,
        agent,
        remote: project.location.kind === "remote",
        platform: probe?.platform,
        muxAvailable: muxOnHost,
        cwdAlreadySet,
        byokEnvPath: byok?.envPath,
      });
      if (script) {
        await sendTerminalInput(sessionId, new TextEncoder().encode(script), {
          force: true,
        });
      }
      if (byok?.keyLabel) {
        setAgentNotice(
          (migratedFrom
            ? `${migratedFrom} is deprecated — launching ${agent?.name ?? "agent"}. `
            : "") +
            `Injecting ${byok.keyLabel} (${byok.varNames.join(", ")}).`,
        );
      }

      const touched = await touchProjectOpened(project.id);
      setProjects((current) => {
        const index = current.findIndex((item) => item.id === touched.id);
        if (index === -1) return [...current, touched];
        const next = [...current];
        next[index] = touched;
        return next;
      });

      if (
        project.location.kind === "remote" &&
        agent?.persistent &&
        hostId !== "local"
      ) {
        const marked = await markProjectRunning(
          project.id,
          hostId,
          agent.id,
        );
        ptyToRunning.current.set(sessionId, marked.id);
        setSessionAttention((current) => ({
          ...current,
          [marked.id]: current[marked.id] ?? { state: "running" },
        }));
        setRunningSessions((current) => {
          const index = current.findIndex((item) => item.id === marked.id);
          if (index === -1) return [marked, ...current];
          const next = [...current];
          next[index] = marked;
          return next;
        });
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      setOpeningProjectId(undefined);
    }
  }

  async function reattachSession(
    session: RunningSessionSummaryDto,
  ): Promise<void> {
    const project = projects.find((entry) => entry.id === session.projectId);
    if (!project) {
      setError("Project for that running session is missing from the vault.");
      return;
    }
    await openProject(project);
  }

  async function refreshRunningSessions(): Promise<void> {
    const listed = await listRunningSessions();
    setRunningSessions(listed);
    // Drop vault markers for sessions already dead on the host (failed kills, etc.).
    const removed = await pruneStaleRunningSessions().catch(() => 0);
    if (removed > 0) {
      setRunningSessions(await listRunningSessions());
    }
  }

  useEffect(() => {
    if (!status.unlocked) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void onAgentNotificationAction((runningSessionId) => {
      const session = runningSessionsRef.current.find(
        (s) => s.id === runningSessionId,
      );
      if (!session) return;
      void focusMainWindow().catch(() => undefined);
      void reattachSession(session);
    }).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
    // reattachSession closes over projects — refresh when unlocked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.unlocked, projects]);

  useEffect(() => {
    if (!import.meta.env.VITE_TETHRA_MOCK) return;
    setSessionAttention({
      "run-1": { state: "running" },
      "run-2": {
        state: "waiting",
        message: "Approve pending file edit",
      },
      "run-3": {
        state: "failed",
        message: "Last command exited with code 1",
      },
    });
  }, []);

  useEffect(() => {
    if (!status.unlocked || runningSessions.length === 0) {
      void setDockBadge(0).catch(() => undefined);
      return;
    }
    const badge = runningSessions.filter((session) => {
      const state = sessionAttention[session.id]?.state;
      return state === "waiting" || state === "failed";
    }).length;
    void setDockBadge(badge).catch(() => undefined);
  }, [status.unlocked, runningSessions, sessionAttention]);

  useEffect(() => {
    if (!status.unlocked || runningSessions.length === 0) return;

    let cancelled = false;
    async function poll(): Promise<void> {
      const byHost = new Map<string, string[]>();
      for (const session of runningSessionsRef.current) {
        const list = byHost.get(session.hostId) ?? [];
        list.push(session.muxSession);
        byHost.set(session.hostId, list);
      }
      for (const [hostId, muxSessions] of byHost) {
        if (cancelled) return;
        const watches = await pollSessionWatches(hostId, muxSessions).catch(
          () => [],
        );
        if (cancelled || watches.length === 0) continue;
        setSessionAttention((current) => {
          let next = current;
          for (const watch of watches) {
            const session = runningSessionsRef.current.find(
              (s) => s.muxSession === watch.muxSession && s.hostId === hostId,
            );
            if (!session) continue;
            // Skip detached poll while this session is actively attached —
            // attached BEL/OSC path owns the signal.
            const attached = [...ptyToRunning.current.entries()].some(
              ([, runningId]) => runningId === session.id,
            );
            if (attached) continue;
            if (!watch.watchSupported) {
              const merged = mergeAttention(
                next[session.id],
                {
                  state: next[session.id]?.state ?? "running",
                  noWatch: true,
                  message: watch.message ?? undefined,
                },
                "tmux",
              );
              if (next === current) next = { ...current };
              next[session.id] = merged;
              continue;
            }
            if (watch.alert === "waiting") {
              const prev = next[session.id];
              const merged = mergeAttention(
                prev,
                { state: "waiting", noWatch: false },
                "tmux",
              );
              if (prev?.state !== "waiting") {
                void maybeNotifyAttention({
                  state: "waiting",
                  title: session.projectName,
                  body: "Detached session needs attention",
                  runningSessionId: session.id,
                });
              }
              if (next === current) next = { ...current };
              next[session.id] = merged;
            }
          }
          return next;
        });
      }
    }

    void poll();
    const timer = window.setInterval(() => void poll(), 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [status.unlocked, runningSessions]);

  async function killRunningSession(
    session: RunningSessionSummaryDto,
  ): Promise<void> {
    // Optimistic: disappear from Running immediately.
    setRunningSessions((current) =>
      current.filter((item) => item.id !== session.id),
    );
    setSessionAttention((current) => {
      if (!(session.id in current)) return current;
      const next = { ...current };
      delete next[session.id];
      return next;
    });
    for (const [ptyId, runningId] of [...ptyToRunning.current.entries()]) {
      if (runningId === session.id) ptyToRunning.current.delete(ptyId);
    }
    try {
      const openTab = tabsRef.current.find(
        (tab) => tab.projectId === session.projectId,
      );
      if (openTab) {
        await closeTab(openTab.sessionId);
      }
      // Vault marker first so relaunch never resurrects a killed session.
      await endRunningSession(session.id);
      await killMuxSession(session.hostId, session.muxSession).catch(
        () => undefined,
      );
    } catch (reason) {
      setError(String(reason));
      void refreshRunningSessions().catch(() => undefined);
    }
  }

  async function openFiles(host: HostSummaryDto): Promise<void> {
    setError(undefined);
    setOpeningFilesHostId(host.id);
    try {
      const [opened, home] = await Promise.all([
        openSftp(host.id),
        localHome(),
      ]);
      setTabs((current) => [
        ...current,
        {
          sessionId: opened.sessionId,
          hostId: host.id,
          title: `${host.label} files`,
          kind: "sftp",
          connected: true,
          color: host.color,
          remotePath: opened.remotePath,
          localPath: home,
        },
      ]);
      activateSession(opened.sessionId);
      enterWorkspace();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setOpeningFilesHostId(undefined);
    }
  }

  async function splitPane(
    orientation: "horizontal" | "vertical",
  ): Promise<void> {
    if (
      !activeTab ||
      (activeTab.kind !== "terminal" && activeTab.kind !== "local")
    ) {
      return;
    }

    setError(undefined);
    try {
      let sessionId: string;
      let newTab: Tab;

      if (activeTab.kind === "terminal") {
        const opened = await openTerminal(activeTab.hostId, 80, 24);
        sessionId = opened.sessionId;
        const host = hosts.find((entry) => entry.id === activeTab.hostId);
        newTab = {
          sessionId,
          hostId: activeTab.hostId,
          title: host?.label ?? activeTab.title,
          kind: "terminal",
          connected: true,
          color: host?.color ?? activeTab.color,
          agentForward: opened.agentForward,
          agentForwardHint: opened.agentForwardHint ?? undefined,
        };
      } else {
        sessionId = await openLocalTerminal(80, 24);
        newTab = {
          sessionId,
          hostId: "local",
          title: "Local",
          kind: "local",
          connected: true,
          color: "#8B8B8B",
        };
      }

      wireTerminal(sessionId);
      void attachOutput(
        sessionId,
        activeTab.kind === "local" ? "Local shell closed." : "Connection closed.",
      );
      setTabs((current) => [...current, newTab]);
      setLayout((current) =>
        splitLeaf(
          current ?? leaf(activeTab.sessionId),
          activeTab.sessionId,
          sessionId,
          orientation,
        ),
      );
      setActiveId(sessionId);
    } catch (reason) {
      setError(String(reason));
    }
  }

  function toggleZoom(): void {
    if (!activeId) return;
    const layoutIsSplit = (layout ?? leaf(activeId)).type === "split";
    if (!zoomedId && !layoutIsSplit) return;
    setZoomedId((current) => (current === activeId ? undefined : activeId));
  }

  function openNewWindow(): void {
    void openWorkspaceWindow();
  }

  async function moveActiveToNewWindow(): Promise<void> {
    if (!activeTab) return;

    const tab = activeTab;
    await moveTabsToNewWindow({
      tabs: [tab as WorkspaceTab],
      layoutJson: JSON.stringify(leaf(tab.sessionId)),
      activeId: tab.sessionId,
      zoomedId: zoomedId === tab.sessionId ? tab.sessionId : undefined,
    });

    setTabs((current) => {
      const index = current.findIndex(
        (entry) => entry.sessionId === tab.sessionId,
      );
      const next = current.filter((entry) => entry.sessionId !== tab.sessionId);
      if (activeId === tab.sessionId) {
        setActiveId(next[Math.max(0, index - 1)]?.sessionId);
      }
      return next;
    });
    setLayout((current) =>
      current ? removeFromLayout(current, tab.sessionId) : null,
    );
    if (zoomedId === tab.sessionId) setZoomedId(undefined);

    if (tab.kind === "terminal" || tab.kind === "local") {
      if (tab.projectId) {
        await persistProjectScrollback(tab.sessionId, tab.projectId);
      }
      disposeTerminal(tab.sessionId);
      outputHandlers.current.delete(tab.sessionId);
    }
  }

  async function closeTab(sessionId: string): Promise<void> {
    setTunnelActiveBySession((current) => {
      if (!(sessionId in current)) return current;
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
    const tab = tabs.find((entry) => entry.sessionId === sessionId);
    const index = tabs.findIndex((entry) => entry.sessionId === sessionId);
    const nextTabs = tabs.filter((entry) => entry.sessionId !== sessionId);
    setLayout((current) =>
      current ? removeFromLayout(current, sessionId) : null,
    );
    if (zoomedId === sessionId) setZoomedId(undefined);
    setTabs(nextTabs);
    if (activeId === sessionId) {
      setActiveId(nextTabs[Math.max(0, index - 1)]?.sessionId);
    }
    // Closing the last tab returns to Launcher; sessions (tmux) stay alive.
    if (nextTabs.length === 0) {
      goLauncher();
    }
    outputHandlers.current.delete(sessionId);
    transcripts.current.delete(sessionId);
    lastExitCodes.current.delete(sessionId);
    ptyToRunning.current.delete(sessionId);
    setPtyAttention((current) => {
      if (!(sessionId in current)) return current;
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
    if (tab?.kind === "terminal" || tab?.kind === "local") {
      if (tab.projectId) {
        await persistProjectScrollback(sessionId, tab.projectId);
      }
      disposeTerminal(sessionId);
      // Detach only: drop the UI / PTY client. Remote tmux (and Running marker)
      // stay alive so the sidebar can reattach. Kill is sidebar × only.
      await closeTerminal(sessionId).catch(() => undefined);
    } else {
      await closeSftp(sessionId).catch(() => undefined);
    }
  }

  async function answerPrompt(accepted: boolean): Promise<void> {
    if (!prompt) return;
    const id = prompt.promptId;
    setPrompt(undefined);
    await respondHostKey(id, accepted).catch((reason: unknown) => {
      setError(String(reason));
    });
  }

  async function lockNow(): Promise<void> {
    setError(undefined);
    try {
      for (const tab of tabs) {
        if (tab.kind === "terminal" || tab.kind === "local") {
          if (tab.projectId) {
            await persistProjectScrollback(tab.sessionId, tab.projectId);
          }
          disposeTerminal(tab.sessionId);
          outputHandlers.current.delete(tab.sessionId);
          await closeTerminal(tab.sessionId).catch(() => undefined);
        } else if (tab.kind === "sftp") {
          await closeSftp(tab.sessionId).catch(() => undefined);
        }
      }
      const localTabs = tabs.filter((tab) => tab.kind === "local");
      setTabs(localTabs);
      setLayout(null);
      setZoomedId(undefined);
      setActiveId(localTabs[0]?.sessionId);
      const next = await vaultLock();
      onStatus(next);
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!pendingDelete) return;
    const host = pendingDelete;
    setPendingDelete(undefined);
    try {
      await deleteHost(host.id);
      setHosts((current) => current.filter((item) => item.id !== host.id));
      const related = tabs.filter((tab) => tab.hostId === host.id);
      for (const tab of related) {
        if (tab.kind === "terminal") {
          if (tab.projectId) {
            await persistProjectScrollback(tab.sessionId, tab.projectId);
          }
          disposeTerminal(tab.sessionId);
          outputHandlers.current.delete(tab.sessionId);
          await closeTerminal(tab.sessionId).catch(() => undefined);
        } else {
          await closeSftp(tab.sessionId).catch(() => undefined);
        }
      }
      const nextTabs = tabs.filter((tab) => tab.hostId !== host.id);
      setTabs(nextTabs);
      if (related.some((tab) => tab.sessionId === activeId)) {
        setActiveId(nextTabs[0]?.sessionId);
      }
      setLayout((current) => {
        if (!current) return null;
        let next: LayoutNode | null = current;
        for (const tab of related) {
          next = removeFromLayout(next, tab.sessionId);
          if (!next) break;
        }
        return next;
      });
      if (nextTabs.length === 0) {
        goLauncher();
      }
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function confirmDeleteProject(): Promise<void> {
    if (!pendingDeleteProject) return;
    const project = pendingDeleteProject;
    setPendingDeleteProject(undefined);
    try {
      await deleteProject(project.id);
      setProjects((current) => current.filter((item) => item.id !== project.id));
      setRunningSessions((current) =>
        current.filter((item) => item.projectId !== project.id),
      );
      await clearScrollbackSnapshot(project.id);
      const related = tabs.filter((tab) => tab.projectId === project.id);
      for (const tab of related) {
        if (tab.kind === "terminal" || tab.kind === "local") {
          disposeTerminal(tab.sessionId);
          outputHandlers.current.delete(tab.sessionId);
          await closeTerminal(tab.sessionId).catch(() => undefined);
        }
      }
      const nextTabs = tabs.filter((tab) => tab.projectId !== project.id);
      setTabs(nextTabs);
      if (related.some((tab) => tab.sessionId === activeId)) {
        setActiveId(nextTabs[0]?.sessionId);
      }
      setLayout((current) => {
        if (!current) return null;
        let next: LayoutNode | null = current;
        for (const tab of related) {
          next = removeFromLayout(next, tab.sessionId);
          if (!next) break;
        }
        return next;
      });
      if (nextTabs.length === 0) {
        goLauncher();
      }
    } catch (reason) {
      setError(String(reason));
    }
  }

  useEffect(() => {
    if (!assistOpen) return;
    if (
      !activeTab ||
      (activeTab.kind !== "terminal" && activeTab.kind !== "local")
    ) {
      setAssistOpen(false);
    }
  }, [activeTab, assistOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && assistOpen) {
        event.preventDefault();
        setAssistOpen(false);
        return;
      }
      if (event.key === "Escape" && zoomedIdRef.current) {
        event.preventDefault();
        setZoomedId(undefined);
        return;
      }
      if (!(event.metaKey || event.ctrlKey)) return;
      // Cmd/Ctrl+Escape toggles Launcher ↔ Workspace (never kills sessions).
      if (event.key === "Escape") {
        event.preventDefault();
        setAppMode((mode) => {
          if (mode === "workspace") return "launcher";
          return tabsRef.current.length > 0 ? "workspace" : "launcher";
        });
        setAssistOpen(false);
        setZoomedId(undefined);
        return;
      }
      if (event.key.toLowerCase() === "b") {
        event.preventDefault();
        toggleRail();
      }
      if (event.key.toLowerCase() === "f" && status.unlocked) {
        const tab = tabsRef.current.find(
          (entry) => entry.sessionId === activeIdRef.current,
        );
        const inTerminal =
          tab &&
          (tab.kind === "terminal" || tab.kind === "local") &&
          !isEditableField(document.activeElement);
        if (!inTerminal) return;
        // macOS: ⌘F. Win/Linux: Ctrl+Shift+F (plain Ctrl+F stays with the shell).
        const isMac = navigator.platform.toLowerCase().includes("mac");
        const wantFind = isMac
          ? event.metaKey && !event.ctrlKey && !event.shiftKey
          : event.ctrlKey && event.shiftKey;
        if (wantFind) {
          event.preventDefault();
          setFindSessionId(tab.sessionId);
          return;
        }
      }
      if (event.key.toLowerCase() === "c" && !event.shiftKey && status.unlocked) {
        const tab = tabsRef.current.find(
          (entry) => entry.sessionId === activeIdRef.current,
        );
        const inTerminal =
          tab &&
          (tab.kind === "terminal" || tab.kind === "local") &&
          !isEditableField(document.activeElement);
        if (inTerminal) {
          event.preventDefault();
          void copyTerminalSelection(tab.sessionId);
          return;
        }
      }
      if (event.key.toLowerCase() === "v" && !event.shiftKey && status.unlocked) {
        const tab = tabsRef.current.find(
          (entry) => entry.sessionId === activeIdRef.current,
        );
        const inTerminal =
          tab &&
          (tab.kind === "terminal" || tab.kind === "local") &&
          !isEditableField(document.activeElement);
        if (inTerminal) {
          event.preventDefault();
          void readClipboardText().then((text) => {
            if (text) pasteIntoTerminal(tab.sessionId, text);
          });
          return;
        }
      }
      if (event.key.toLowerCase() === "k" && status.unlocked) {
        event.preventDefault();
        if (event.shiftKey) {
          const tab = tabsRef.current.find(
            (entry) => entry.sessionId === activeIdRef.current,
          );
          if (tab && (tab.kind === "terminal" || tab.kind === "local")) {
            clearTerminal(tab.sessionId);
          }
        } else {
          setPaletteOpen(true);
        }
      }
      if (event.key === "," && status.unlocked) {
        event.preventDefault();
        openSettings("general");
      }
      if (event.key.toLowerCase() === "w" && status.unlocked) {
        event.preventDefault();
        if (activeIdRef.current) void closeTab(activeIdRef.current);
      }
      if (event.key.toLowerCase() === "i" && status.unlocked) {
        const tab = tabsRef.current.find(
          (entry) => entry.sessionId === activeIdRef.current,
        );
        if (tab && (tab.kind === "terminal" || tab.kind === "local")) {
          event.preventDefault();
          setAssistOpen(true);
        }
      }
      if (event.key === "\\") {
        event.preventDefault();
        if (event.shiftKey) {
          void splitPane("vertical");
        } else {
          void splitPane("horizontal");
        }
      }
      if (event.key === "Enter" && event.shiftKey) {
        event.preventDefault();
        toggleZoom();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [status.unlocked, assistOpen]);

  const inWorkspace = appMode === "workspace";

  const activeTunnelCount = useMemo(
    () =>
      Object.values(tunnelActiveBySession).reduce(
        (sum, count) => sum + count,
        0,
      ),
    [tunnelActiveBySession],
  );

  const titlebarTabs = useMemo(
    () =>
      tabs.map((tab) => {
        const host =
          tab.hostId !== "local"
            ? hosts.find((entry) => entry.id === tab.hostId)
            : undefined;
        const project = tab.projectId
          ? projects.find((entry) => entry.id === tab.projectId)
          : undefined;
        const runningId = ptyToRunning.current.get(tab.sessionId);
        return {
          sessionId: tab.sessionId,
          title:
            tab.kind === "local"
              ? "Local"
              : tab.kind === "sftp"
                ? `${host?.label ?? tab.title} files`
                : (host?.label ?? tab.title),
          kind: tab.kind,
          connected: tab.connected,
          color: tab.color,
          projectName: project?.name,
          waiting:
            runningId != null &&
            sessionAttention[runningId]?.state === "waiting",
        };
      }),
    [tabs, hosts, projects, sessionAttention],
  );

  // Tab selection is source of truth for what to show. Layout only wins when
  // it's a real split that still contains the active session.
  const effectiveLayout = (() => {
    if (layout?.type === "split" && activeId && containsSession(layout, activeId)) {
      return layout;
    }
    if (activeId) return leaf(activeId);
    if (layout?.type === "leaf") return layout;
    if (tabs[0]) return leaf(tabs[0].sessionId);
    return null;
  })();
  const canZoom = Boolean(
    zoomedId || (effectiveLayout && effectiveLayout.type === "split"),
  );

  const sessionFocused =
    inWorkspace &&
    Boolean(
      activeTab &&
        (activeTab.kind === "terminal" || activeTab.kind === "local"),
    );
  const effectiveRailCollapsed = railCollapsed || sessionFocused;

  return (
    <div className="flex size-full flex-col bg-base">
      <TitleBar
        tabs={titlebarTabs}
        activeTabId={activeId}
        inWorkspace={inWorkspace}
        openingLocal={openingLocal}
        canSplit={Boolean(activeTab && activeTab.kind !== "sftp")}
        zoomed={Boolean(zoomedId)}
        canZoom={canZoom}
        appVersion={appVersion}
        activeTunnelCount={activeTunnelCount}
        onOpenPalette={() => setPaletteOpen(true)}
        onSelectTab={selectTab}
        onCloseTab={(sessionId) => void closeTab(sessionId)}
        onCloseOtherTabs={(keepId) => {
          for (const tab of tabsRef.current) {
            if (tab.sessionId !== keepId) void closeTab(tab.sessionId);
          }
        }}
        onMoveTabToNewWindow={(sessionId) => {
          activateSession(sessionId);
          void moveActiveToNewWindow();
        }}
        onNewTab={() => {
          if (hosts[0]) void connect(hosts[0]);
          else goLauncher();
        }}
        onOpenLocal={() => void openLocal()}
        onSplitRight={() => void splitPane("horizontal")}
        onSplitDown={() => void splitPane("vertical")}
        onToggleZoom={() => toggleZoom()}
        onNewWindow={() => openNewWindow()}
        onMoveToNewWindow={() => void moveActiveToNewWindow()}
        onSync={() => openSurface("vault")}
        onSettings={() => openSettings("general")}
        onAssistSettings={() => openSurface("assist")}
        onChangePassword={() => openSurface("vault")}
        onAbout={() => setAboutOpen(true)}
        onLock={() => void lockNow()}
        onGoLauncher={inWorkspace ? goLauncher : undefined}
      />

      <UpdateBanner />

      <div className="flex min-h-0 flex-1">
        <LeftRail
          collapsed={effectiveRailCollapsed}
          vaultStatus={status}
          syncStatus={syncInfo}
          hostCount={hosts.length}
          activeTunnelCount={activeTunnelCount}
          runningSessions={runningSessions}
          sessionAttention={sessionAttention}
          hosts={hosts}
          activeNav={
            activeSurface === "identities"
              ? "identities"
              : activeSurface === "assist"
                ? "assist"
                : railNav
          }
          onNav={handleRailNav}
          onOpenVault={() => openSurface("vault")}
          onSettings={() => openSettings("general")}
          onReattach={(session) => void reattachSession(session)}
        />

        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {activeSurface === "vault" ? (
            <VaultSurface
              onClose={closeSurface}
              onHostsMayHaveChanged={() => {
                void listHosts()
                  .then(setHosts)
                  .catch((reason: unknown) => setError(String(reason)));
              }}
              onVaultReplaced={() => {
                closeSurface();
                setHosts([]);
                setProjects([]);
                setRunningSessions([]);
                setTabs([]);
                setActiveId(undefined);
                setLayout(null);
                setAppMode("launcher");
                void vaultStatus()
                  .then(onStatus)
                  .catch((reason: unknown) => setError(String(reason)));
              }}
            />
          ) : activeSurface === "assist" ? (
            <AssistSurface
              onClose={closeSurface}
              onChanged={() => setAssistKeysEpoch((n) => n + 1)}
            />
          ) : activeSurface === "agents" ? (
            <AgentsSurface agents={agents} onClose={closeSurface} />
          ) : activeSurface === "identities" ? (
            <IdentitiesSurface onClose={closeSurface} />
          ) : railNav === "tunnels" ? (
            <TunnelsView
              hosts={hosts}
              activeTunnelCount={activeTunnelCount}
              onClose={() => {
                setRailNav("hosts");
              }}
            />
          ) : railNav === "files" ? (
            <FilesView
              hosts={hosts}
              openingFilesHostId={openingFilesHostId}
              onOpenFiles={(host) => void openFiles(host)}
              onClose={() => setRailNav("hosts")}
            />
          ) : !inWorkspace ? (
            <Launcher
              hosts={hosts}
              projects={projects}
              runningSessions={runningSessions}
              sessionAttention={sessionAttention}
              openHostIds={openHostIds}
              error={error}
              connectingHostId={connectingHostId}
              openingFilesHostId={openingFilesHostId}
              openingProjectId={openingProjectId}
              onConnect={(host) => void connect(host)}
              onFiles={(host) => void openFiles(host)}
              onAgent={openAgentOnHost}
              onEditHost={setEditor}
              onDeleteHost={setPendingDelete}
              onOpenProject={(project) => void openProject(project)}
              onEditProject={setProjectEditor}
              onDeleteProject={setPendingDeleteProject}
              onReattach={(session) => void reattachSession(session)}
              onEndSession={(session) => void killRunningSession(session)}
              onAddHost={() => {
                setHostDraft(undefined);
                setEditor("new");
              }}
              onAddProject={() => setProjectEditor("new")}
              onImport={() => setImportOpen(true)}
              onLocal={() => void openLocal()}
              onQuickConnect={handleQuickConnect}
              agentLabel={(id) => agentDisplayName(agents, id)}
            />
          ) : (
            <>
              {assistOpen &&
                (() => {
                  const context = assistContextForActive();
                  if (!context) return null;
                  return (
                    <AssistBar
                      context={context}
                      reloadToken={assistKeysEpoch}
                      onInsert={insertAssistCommand}
                      onOpenSettings={() => openSurface("assist")}
                      onClose={() => setAssistOpen(false)}
                    />
                  );
                })()}

              {activeTab &&
                activeTab.kind === "terminal" &&
                activeTab.connected && (
                  <TunnelsPanel
                    sessionId={activeTab.sessionId}
                    connected={activeTab.connected}
                    agentForward={activeTab.agentForward}
                    agentForwardHint={activeTab.agentForwardHint}
                  />
                )}

              <section className="relative min-h-0 flex-1">
                {zoomedId && (
                  <div className="pointer-events-none absolute top-2 right-2 z-30 rounded border border-line bg-elevated/90 px-2 py-0.5 text-micro text-fg-muted">
                    Zoomed — Esc to exit
                  </div>
                )}
                {tabs.length === 0 || !effectiveLayout ? (
                  <div className="grid size-full place-items-center gap-2 p-8 text-ui text-fg-muted">
                    <span>No open tabs.</span>
                    <button
                      type="button"
                      className="cursor-pointer text-accent hover:underline"
                      onClick={goLauncher}
                    >
                      Back to hosts
                    </button>
                  </div>
                ) : (
                  <SplitPanes
                    layout={effectiveLayout}
                    focusedId={activeId}
                    zoomedId={zoomedId}
                    narrow={narrow}
                    onFocus={setActiveId}
                    onLayoutChange={setLayout}
                    renderPane={(sessionId, focused) => {
                      const tab = tabs.find(
                        (entry) => entry.sessionId === sessionId,
                      );
                      if (!tab) return null;
                      if (tab.kind === "sftp") {
                        return (
                          <SftpBrowser
                            key={tab.sessionId}
                            pane
                            sessionId={tab.sessionId}
                            initialRemotePath={tab.remotePath ?? "."}
                            initialLocalPath={tab.localPath ?? "/"}
                            active={focused}
                          />
                        );
                      }
                      const runningId = ptyToRunning.current.get(
                        tab.sessionId,
                      );
                      const runningAttention = runningId
                        ? sessionAttention[runningId]
                        : undefined;
                      const attachedAttention = ptyAttention[tab.sessionId];
                      const attention = attachedAttention ?? runningAttention;
                      const runningSession = runningId
                        ? runningSessions.find((s) => s.id === runningId)
                        : undefined;
                      return (
                        <SessionView
                          key={tab.sessionId}
                          pane
                          sessionId={tab.sessionId}
                          host={
                            tab.hostId !== "local"
                              ? hosts.find((h) => h.id === tab.hostId)
                              : undefined
                          }
                          cwd={tab.cwd}
                          gitBranch={tab.gitBranch}
                          connected={tab.connected}
                          active={focused}
                          visible
                          color={tab.color ?? DEFAULT_HOST_COLOR}
                          findOpen={findSessionId === tab.sessionId}
                          waiting={attention?.state === "waiting"}
                          waitingMessage={attention?.message}
                          isAgentSession={Boolean(
                            tab.projectId ?? runningSession?.projectId,
                          )}
                          onReview={() => {
                            activateSession(tab.sessionId);
                            void focusMainWindow();
                          }}
                          onJumpToAgent={() => {
                            activateSession(tab.sessionId);
                            setAssistOpen(true);
                          }}
                          sessionStartedAt={runningSession?.startedAt}
                          onFindOpen={() => setFindSessionId(tab.sessionId)}
                          onFindClose={() =>
                            setFindSessionId((current) =>
                              current === tab.sessionId ? undefined : current,
                            )
                          }
                          onPaste={(text) =>
                            pasteIntoTerminal(tab.sessionId, text)
                          }
                          onSplitRight={() => void splitPane("horizontal")}
                          onSplitDown={() => void splitPane("vertical")}
                          onClose={() => void closeTab(tab.sessionId)}
                          onAssist={() => {
                            activateSession(tab.sessionId);
                            setAssistOpen(true);
                          }}
                        />
                      );
                    }}
                  />
                )}
              </section>

              {agentNotice && (
                <button
                  type="button"
                  onClick={() => setAgentNotice(undefined)}
                  className="absolute right-4 bottom-16 z-20 max-w-96 cursor-pointer rounded-md border border-accent/40 bg-elevated px-3 py-2 text-left text-micro text-fg shadow-lg shadow-black/50"
                >
                  {agentNotice}
                </button>
              )}

              {error && tabs.length > 0 && (
                <button
                  onClick={() => setError(undefined)}
                  className="absolute right-4 bottom-4 z-20 max-w-96 cursor-pointer rounded-md border border-danger/40 bg-elevated px-3 py-2 text-left text-micro text-danger shadow-lg shadow-black/50"
                >
                  {error}
                </button>
              )}
            </>
          )}
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        hosts={hosts}
        projects={projects}
        runningSessions={runningSessions}
        canSplit={Boolean(activeTab && activeTab.kind !== "sftp")}
        zoomed={Boolean(zoomedId)}
        inWorkspace={inWorkspace}
        hasWorkspaceTabs={tabs.length > 0}
        onOpenChange={setPaletteOpen}
        onConnect={(host) => void connect(host)}
        onFiles={(host) => void openFiles(host)}
        onOpenProject={(project) => void openProject(project)}
        onReattach={(session) => void reattachSession(session)}
        onLocal={() => void openLocal()}
        onGoLauncher={goLauncher}
        onGoWorkspace={enterWorkspace}
        onSplitRight={() => void splitPane("horizontal")}
        onSplitDown={() => void splitPane("vertical")}
        onToggleZoom={() => toggleZoom()}
        onNewWindow={() => openNewWindow()}
        onMoveToNewWindow={() => void moveActiveToNewWindow()}
        onAddHost={() => {
          setHostDraft(undefined);
          setEditor("new");
        }}
        onImport={() => setImportOpen(true)}
        onSync={() => openSurface("vault")}
        onSettings={(section) => openSettings(section ?? "general")}
        onAssistSettings={() => openSurface("assist")}
        onOpenSurface={openSurface}
        onLock={() => void lockNow()}
        agentLabel={(id) => agentDisplayName(agents, id)}
      />

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        initialSection={settingsSection}
        sidebarCollapsed={railCollapsed}
        onSidebarCollapsedChange={setRailCollapsed}
        onOpenSurface={(surface) => {
          setSettingsOpen(false);
          openSurface(surface);
        }}
        appVersion={appVersion}
      />

      <Dialog
        open={aboutOpen}
        onOpenChange={setAboutOpen}
        title="Tethra"
        width="sm"
        description="Private, cross-platform SSH and SFTP workspace with an end-to-end encrypted vault."
        footer={
          <Button variant="subtle" onClick={() => setAboutOpen(false)}>
            Close
          </Button>
        }
      >
        <div className="flex items-center gap-3 rounded-md border border-line bg-base px-3 py-2.5">
          <Logo size={28} />
          <span className="flex flex-col">
            <span className="text-ui text-fg">
              Version {appVersion ?? "…"}
              {import.meta.env.DEV ? " (dev)" : ""}
            </span>
            <span className="text-micro text-fg-subtle">
              Vault encrypted with Argon2id and XChaCha20-Poly1305
            </span>
          </span>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(prompt)}
        onOpenChange={(next) => {
          if (!next) void answerPrompt(false);
        }}
        dismissible={false}
        kicker="Unknown host key"
        title="Verify this server"
        description="This host has not been seen before. Confirm the fingerprint using a trusted channel before continuing."
        footer={
          <>
            <Button variant="subtle" onClick={() => void answerPrompt(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void answerPrompt(true)}>
              Trust and connect
            </Button>
          </>
        }
      >
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-md border border-line bg-base px-3 py-2.5 text-micro">
          <dt className="text-fg-subtle">Algorithm</dt>
          <dd className="m-0 font-mono text-fg" data-selectable>
            {prompt?.algorithm}
          </dd>
          <dt className="text-fg-subtle">Fingerprint</dt>
          <dd className="m-0 break-all font-mono text-fg" data-selectable>
            {prompt?.fingerprint}
          </dd>
        </dl>
      </Dialog>

      <Dialog
        open={Boolean(pendingDelete)}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(undefined);
        }}
        kicker="Delete host"
        title={`Remove ${pendingDelete?.label ?? ""}?`}
        description="The host record and its local password identity will be tombstoned in the vault. Active sessions for this host will close."
        footer={
          <>
            <Button variant="subtle" onClick={() => setPendingDelete(undefined)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void confirmDelete()}>
              Delete
            </Button>
          </>
        }
      />

      <Dialog
        open={Boolean(pendingDeleteProject)}
        onOpenChange={(next) => {
          if (!next) setPendingDeleteProject(undefined);
        }}
        kicker="Delete project"
        title={`Remove ${pendingDeleteProject?.name ?? ""}?`}
        description="The project record will be tombstoned in the vault. Open terminals are left alone."
        footer={
          <>
            <Button
              variant="subtle"
              onClick={() => setPendingDeleteProject(undefined)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => void confirmDeleteProject()}
            >
              Delete
            </Button>
          </>
        }
      />

      {editor && (
        <HostFormModal
          initial={editor === "new" ? undefined : editor}
          draft={editor === "new" ? hostDraft : undefined}
          onClose={() => {
            setEditor(undefined);
            setHostDraft(undefined);
          }}
          onSaved={(host) => {
            setHosts((current) => {
              const index = current.findIndex((item) => item.id === host.id);
              if (index === -1) return [...current, host];
              const next = [...current];
              next[index] = host;
              return next;
            });
            setHostDraft(undefined);
          }}
        />
      )}

      {projectEditor && (
        <ProjectFormModal
          initial={projectEditor === "new" ? undefined : projectEditor}
          hosts={hosts}
          onClose={() => setProjectEditor(undefined)}
          onSaved={(project) => {
            setProjects((current) => {
              const index = current.findIndex((item) => item.id === project.id);
              if (index === -1) return [...current, project];
              const next = [...current];
              next[index] = project;
              return next;
            });
          }}
        />
      )}

      {importOpen && (
        <SshConfigImportModal
          onClose={() => setImportOpen(false)}
          onImported={(imported) => {
            setHosts((current) => {
              const byId = new Map(current.map((host) => [host.id, host]));
              for (const host of imported) byId.set(host.id, host);
              return [...byId.values()];
            });
          }}
        />
      )}

      {muxHint && (
        <ToolsHintDialog
          probe={muxHint.probe}
          sessionId={muxHint.sessionId}
          onInsert={insertToolCommand}
          onClose={() => setMuxHint(undefined)}
        />
      )}
    </div>
  );
}

/** Decode standard base64 PTY payloads from the terminal-event bus. */
function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
