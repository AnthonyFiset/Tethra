import { useEffect, useMemo, useState } from "react";
import { CommandPalette } from "./components/CommandPalette";
import { Logo } from "./components/Logo";
import { Sidebar } from "./components/Sidebar";
import { SyncSettingsModal } from "./components/SyncSettingsModal";
import { TabBar } from "./components/TabBar";
import { TitleBar } from "./components/TitleBar";
import { UpdateBanner } from "./components/UpdateBanner";
import { Button } from "./components/ui/Button";
import { Dialog } from "./components/ui/Dialog";
import { ErrorBanner } from "./components/ui/Field";
import { TooltipProvider } from "./components/ui/Tooltip";
import { HostFormModal } from "./hosts/HostFormModal";
import { SshConfigImportModal } from "./hosts/SshConfigImportModal";
import {
  closeSftp,
  closeTerminal,
  deleteHost,
  listHosts,
  localHome,
  onHostKeyPrompt,
  onVaultLocked,
  onVaultStatus,
  openLocalTerminal,
  openSftp,
  openTerminal,
  resizeTerminal,
  respondHostKey,
  sendTerminalInput,
  vaultLock,
  vaultStatus,
  type HostKeyPrompt,
  type HostSummaryDto,
  type TerminalEvent,
  type VaultStatusDto,
} from "./lib/ipc";
import { SftpBrowser } from "./sftp/SftpBrowser";
import {
  createTerminal,
  disposeTerminal,
  focusTerminal,
  writeTerminal,
  writeTerminalMessage,
} from "./terminal/registry";
import { TerminalView } from "./terminal/TerminalView";
import { ChangePasswordModal } from "./vault/ChangePasswordModal";
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
}

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
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [connectingHostId, setConnectingHostId] = useState<string>();
  const [openingFilesHostId, setOpeningFilesHostId] = useState<string>();
  const [openingLocal, setOpeningLocal] = useState(false);
  const [error, setError] = useState<string>();
  const [prompt, setPrompt] = useState<HostKeyPrompt>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editor, setEditor] = useState<HostSummaryDto | "new">();
  const [importOpen, setImportOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<HostSummaryDto>();
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => window.localStorage.getItem("tethra.sidebar") === "rail",
  );

  useEffect(() => {
    listHosts()
      .then(setHosts)
      .catch((reason: unknown) => setError(String(reason)));
    let unlisten: (() => void) | undefined;
    onHostKeyPrompt(setPrompt).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    if (!status.unlocked) {
      setTabs((current) => {
        for (const tab of current) {
          if (tab.kind === "terminal") {
            disposeTerminal(tab.sessionId);
          }
        }
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
    }
  }, [status.unlocked]);

  useEffect(() => {
    window.localStorage.setItem(
      "tethra.sidebar",
      sidebarCollapsed ? "rail" : "expanded",
    );
  }, [sidebarCollapsed]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === "b") {
        event.preventDefault();
        toggleSidebar();
      }
      if (event.key.toLowerCase() === "k" && status.unlocked) {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [status.unlocked]);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.sessionId === activeId),
    [activeId, tabs],
  );

  function toggleSidebar(): void {
    if (window.matchMedia("(max-width: 767px)").matches) {
      setDrawerOpen((open) => !open);
    } else {
      setSidebarCollapsed((value) => !value);
    }
  }

  /** Buffers output arriving before the xterm instance exists. */
  function makeOutputSink(closedMessage: string) {
    const queued: TerminalEvent[] = [];
    let sink: ((event: TerminalEvent) => void) | undefined;

    return {
      onOutput: (event: TerminalEvent) => {
        if (sink) sink(event);
        else queued.push(event);
      },
      attach: (sessionId: string) => {
        sink = (event) => {
          if (event.kind === "data") {
            writeTerminal(sessionId, event.data);
            if (event.dropped) {
              writeTerminalMessage(
                sessionId,
                "\x1b[33mSome output was dropped because rendering fell behind.\x1b[0m",
              );
            }
          } else {
            setTabs((current) =>
              current.map((tab) =>
                tab.sessionId === sessionId
                  ? { ...tab, connected: false }
                  : tab,
              ),
            );
            writeTerminalMessage(sessionId, `\x1b[90m${closedMessage}\x1b[0m`);
          }
        };
        queued.splice(0).forEach(sink);
      },
    };
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
    });
  }

  async function connect(host: HostSummaryDto): Promise<void> {
    setError(undefined);
    setConnectingHostId(host.id);
    setDrawerOpen(false);

    const pump = makeOutputSink("Connection closed.");
    try {
      const sessionId = await openTerminal(host.id, 80, 24, pump.onOutput);
      wireTerminal(sessionId);
      setTabs((current) => [
        ...current,
        {
          sessionId,
          hostId: host.id,
          title: host.label,
          kind: "terminal",
          connected: true,
          color: host.color,
        },
      ]);
      setActiveId(sessionId);
      pump.attach(sessionId);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setConnectingHostId(undefined);
    }
  }

  async function openLocal(): Promise<void> {
    setError(undefined);
    setOpeningLocal(true);
    setDrawerOpen(false);

    const pump = makeOutputSink("Local shell closed.");
    try {
      const sessionId = await openLocalTerminal(80, 24, pump.onOutput);
      wireTerminal(sessionId);
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
      setActiveId(sessionId);
      pump.attach(sessionId);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setOpeningLocal(false);
    }
  }

  async function openFiles(host: HostSummaryDto): Promise<void> {
    setError(undefined);
    setOpeningFilesHostId(host.id);
    setDrawerOpen(false);
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
      setActiveId(opened.sessionId);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setOpeningFilesHostId(undefined);
    }
  }

  async function closeTab(sessionId: string): Promise<void> {
    const tab = tabs.find((entry) => entry.sessionId === sessionId);
    setTabs((current) => {
      const index = current.findIndex((entry) => entry.sessionId === sessionId);
      const next = current.filter((entry) => entry.sessionId !== sessionId);
      if (activeId === sessionId) {
        setActiveId(next[Math.max(0, index - 1)]?.sessionId);
      }
      return next;
    });
    if (tab?.kind === "terminal" || tab?.kind === "local") {
      disposeTerminal(sessionId);
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
        if (tab.kind === "terminal") {
          disposeTerminal(tab.sessionId);
          await closeTerminal(tab.sessionId).catch(() => undefined);
        } else if (tab.kind === "sftp") {
          await closeSftp(tab.sessionId).catch(() => undefined);
        }
      }
      const localTabs = tabs.filter((tab) => tab.kind === "local");
      setTabs(localTabs);
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
          disposeTerminal(tab.sessionId);
          await closeTerminal(tab.sessionId).catch(() => undefined);
        } else {
          await closeSftp(tab.sessionId).catch(() => undefined);
        }
      }
      setTabs((current) => current.filter((tab) => tab.hostId !== host.id));
    } catch (reason) {
      setError(String(reason));
    }
  }

  const connectionLabel = activeTab?.connected
    ? activeTab.kind === "sftp"
      ? "Files"
      : "Connected"
    : "Vault unlocked";

  return (
    <div className="flex size-full flex-col bg-base">
      <TitleBar
        connectionLabel={connectionLabel}
        connected={Boolean(activeTab?.connected)}
        openingLocal={openingLocal}
        onToggleSidebar={toggleSidebar}
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenLocal={() => void openLocal()}
        onSync={() => setSyncOpen(true)}
        onChangePassword={() => setChangePasswordOpen(true)}
        onAbout={() => setAboutOpen(true)}
        onLock={() => void lockNow()}
      />

      <UpdateBanner />

      <div
        className="relative grid min-h-0 flex-1 transition-[grid-template-columns] duration-150 max-md:block"
        style={{
          gridTemplateColumns: `${sidebarCollapsed ? 52 : 248}px minmax(0, 1fr)`,
        }}
      >
        <Sidebar
          hosts={hosts}
          collapsed={sidebarCollapsed}
          drawerOpen={drawerOpen}
          recoveryAvailable={status.recoveryAvailable}
          connectingHostId={connectingHostId}
          openingFilesHostId={openingFilesHostId}
          onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
          onConnect={(host) => void connect(host)}
          onFiles={(host) => void openFiles(host)}
          onEdit={setEditor}
          onDelete={setPendingDelete}
          onAddHost={() => setEditor("new")}
          onImport={() => setImportOpen(true)}
          onLock={() => void lockNow()}
        />

        {drawerOpen && (
          <button
            aria-label="Close hosts"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 z-20 bg-black/50 md:hidden"
          />
        )}

        <main className="relative flex min-h-0 min-w-0 flex-col">
          {tabs.length > 0 && (
            <TabBar
              tabs={tabs}
              activeId={activeId}
              onSelect={(sessionId) => {
                setActiveId(sessionId);
                const tab = tabs.find((item) => item.sessionId === sessionId);
                if (tab && tab.kind !== "sftp") focusTerminal(sessionId);
              }}
              onClose={(sessionId) => void closeTab(sessionId)}
            />
          )}

          <section className="relative min-h-0 flex-1">
            {tabs.length === 0 ? (
              <EmptyState
                hosts={hosts}
                error={error}
                connecting={Boolean(connectingHostId)}
                openingFiles={Boolean(openingFilesHostId)}
                onAddHost={() => setEditor("new")}
                onConnect={(host) => void connect(host)}
                onFiles={(host) => void openFiles(host)}
                onLocal={() => void openLocal()}
              />
            ) : (
              tabs.map((tab) =>
                tab.kind !== "sftp" ? (
                  <TerminalView
                    key={tab.sessionId}
                    sessionId={tab.sessionId}
                    active={tab.sessionId === activeId}
                    color={tab.color ?? "#4C8DF6"}
                  />
                ) : (
                  <SftpBrowser
                    key={tab.sessionId}
                    sessionId={tab.sessionId}
                    initialRemotePath={tab.remotePath ?? "."}
                    initialLocalPath={tab.localPath ?? "/"}
                    active={tab.sessionId === activeId}
                  />
                ),
              )
            )}
          </section>

          {error && tabs.length > 0 && (
            <button
              onClick={() => setError(undefined)}
              className="absolute right-4 bottom-4 z-20 max-w-96 cursor-pointer rounded-md border border-danger/40 bg-elevated px-3 py-2 text-left text-micro text-danger shadow-lg shadow-black/50"
            >
              {error}
            </button>
          )}
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        hosts={hosts}
        onOpenChange={setPaletteOpen}
        onConnect={(host) => void connect(host)}
        onFiles={(host) => void openFiles(host)}
        onLocal={() => void openLocal()}
        onAddHost={() => setEditor("new")}
        onImport={() => setImportOpen(true)}
        onSync={() => setSyncOpen(true)}
        onLock={() => void lockNow()}
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
            <span className="text-ui text-fg">Version 0.1.0</span>
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

      {editor && (
        <HostFormModal
          initial={editor === "new" ? undefined : editor}
          onClose={() => setEditor(undefined)}
          onSaved={(host) => {
            setHosts((current) => {
              const index = current.findIndex((item) => item.id === host.id);
              if (index === -1) return [...current, host];
              const next = [...current];
              next[index] = host;
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

      {changePasswordOpen && (
        <ChangePasswordModal onClose={() => setChangePasswordOpen(false)} />
      )}

      {syncOpen && (
        <SyncSettingsModal
          onClose={() => setSyncOpen(false)}
          onHostsMayHaveChanged={() => {
            void listHosts()
              .then(setHosts)
              .catch((reason: unknown) => setError(String(reason)));
          }}
          onVaultReplaced={() => {
            // The old key is gone, so drop back to the gate for the shared
            // master password.
            setSyncOpen(false);
            setHosts([]);
            void vaultStatus()
              .then(onStatus)
              .catch((reason: unknown) => setError(String(reason)));
          }}
        />
      )}
    </div>
  );
}

function EmptyState({
  hosts,
  error,
  connecting,
  openingFiles,
  onAddHost,
  onConnect,
  onFiles,
  onLocal,
}: {
  hosts: HostSummaryDto[];
  error?: string;
  connecting: boolean;
  openingFiles: boolean;
  onAddHost: () => void;
  onConnect: (host: HostSummaryDto) => void;
  onFiles: (host: HostSummaryDto) => void;
  onLocal: () => void;
}): React.JSX.Element {
  const first = hosts[0];

  return (
    <div className="grid size-full place-items-center p-8">
      <div className="flex max-w-md flex-col items-center text-center">
        <Logo size={40} className="mb-4 opacity-70" />
        <h1 className="m-0 text-lg font-semibold text-fg">
          Open a secure shell
        </h1>
        <p className="mt-1.5 mb-5 text-ui text-fg-muted">
          Add a host, open a terminal, or browse files over SFTP.
        </p>
        {error && (
          <div className="mb-4 w-full">
            <ErrorBanner>{error}</ErrorBanner>
          </div>
        )}
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="primary" onClick={onAddHost}>
            Add host
          </Button>
          <Button variant="subtle" onClick={onLocal}>
            Local terminal
          </Button>
          {first && (
            <>
              <Button
                variant="subtle"
                onClick={() => onConnect(first)}
                disabled={connecting}
              >
                {connecting ? "Connecting…" : `Connect to ${first.label}`}
              </Button>
              <Button
                variant="subtle"
                onClick={() => onFiles(first)}
                disabled={openingFiles}
              >
                {openingFiles ? "Opening…" : `Browse ${first.label}`}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
