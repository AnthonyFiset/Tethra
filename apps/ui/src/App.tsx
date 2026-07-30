import { useEffect, useMemo, useState } from "react";
import { HostFormModal } from "./hosts/HostFormModal";
import { SshConfigImportModal } from "./hosts/SshConfigImportModal";
import {
  closeTerminal,
  deleteHost,
  listHosts,
  onHostKeyPrompt,
  onVaultLocked,
  onVaultStatus,
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
import {
  createTerminal,
  disposeAllTerminals,
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
  connected: boolean;
}

export default function App(): React.JSX.Element {
  const [status, setStatus] = useState<VaultStatusDto>();
  const [bootError, setBootError] = useState<string>();

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
      disposeAllTerminals();
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

  if (bootError) {
    return (
      <div className="vault-gate">
        <div className="vault-card">
          <span className="modal-kicker">Error</span>
          <h1>Unable to open vault</h1>
          <div className="error-banner">{bootError}</div>
        </div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="vault-gate">
        <div className="vault-card">
          <span className="modal-kicker">Encrypted vault</span>
          <h1>Loading…</h1>
        </div>
      </div>
    );
  }

  if (!status.unlocked) {
    return (
      <VaultGate
        status={status}
        onUnlocked={(next) => {
          setStatus(next);
        }}
      />
    );
  }

  return (
    <Workspace
      status={status}
      onStatus={setStatus}
    />
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
  const [error, setError] = useState<string>();
  const [prompt, setPrompt] = useState<HostKeyPrompt>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editor, setEditor] = useState<HostSummaryDto | "new">();
  const [importOpen, setImportOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<HostSummaryDto>();
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);

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
      setTabs([]);
      setActiveId(undefined);
      setPrompt(undefined);
      setEditor(undefined);
      setImportOpen(false);
      setPendingDelete(undefined);
      disposeAllTerminals();
    }
  }, [status.unlocked]);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.sessionId === activeId),
    [activeId, tabs],
  );

  async function connect(host: HostSummaryDto): Promise<void> {
    setError(undefined);
    setConnectingHostId(host.id);
    setDrawerOpen(false);

    const queued: TerminalEvent[] = [];
    let sink: ((event: TerminalEvent) => void) | undefined;
    const onOutput = (event: TerminalEvent) => {
      if (sink) sink(event);
      else queued.push(event);
    };

    try {
      const sessionId = await openTerminal(host.id, 80, 24, onOutput);
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
          writeTerminalMessage(sessionId, "\x1b[90mConnection closed.\x1b[0m");
        }
      };

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

      setTabs((current) => [
        ...current,
        {
          sessionId,
          hostId: host.id,
          title: host.label,
          connected: true,
        },
      ]);
      setActiveId(sessionId);
      queued.splice(0).forEach(sink);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setConnectingHostId(undefined);
    }
  }

  async function closeTab(sessionId: string): Promise<void> {
    setTabs((current) => {
      const index = current.findIndex((tab) => tab.sessionId === sessionId);
      const next = current.filter((tab) => tab.sessionId !== sessionId);
      if (activeId === sessionId) {
        setActiveId(next[Math.max(0, index - 1)]?.sessionId);
      }
      return next;
    });
    disposeTerminal(sessionId);
    await closeTerminal(sessionId).catch(() => undefined);
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
        disposeTerminal(tab.sessionId);
        await closeTerminal(tab.sessionId).catch(() => undefined);
      }
      setTabs([]);
      setActiveId(undefined);
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
        disposeTerminal(tab.sessionId);
        await closeTerminal(tab.sessionId).catch(() => undefined);
      }
      setTabs((current) => current.filter((tab) => tab.hostId !== host.id));
    } catch (reason) {
      setError(String(reason));
    }
  }

  return (
    <div className="app-shell">
      <header className="titlebar">
        <button
          className="icon-button menu-button"
          onClick={() => setDrawerOpen((open) => !open)}
          aria-label="Toggle hosts"
        >
          ☰
        </button>
        <div className="brand">
          <span className="brand-mark">&gt;_</span>
          <span>Tethra</span>
        </div>
        <div className="titlebar-actions">
          <button
            className="ghost-button"
            onClick={() => setChangePasswordOpen(true)}
          >
            Password
          </button>
          <button className="ghost-button" onClick={() => void lockNow()}>
            Lock
          </button>
          <div className="connection-state">
            {activeTab?.connected ? (
              <>
                <span className="status-dot status-dot--online" />
                Connected
              </>
            ) : (
              "Vault unlocked"
            )}
          </div>
        </div>
      </header>

      <div className="workspace">
        <aside className={`sidebar ${drawerOpen ? "sidebar--open" : ""}`}>
          <div className="sidebar-heading">
            <span>Hosts</span>
            <div className="sidebar-heading-actions">
              <span className="host-count">{hosts.length}</span>
              <button
                className="import-button"
                onClick={() => setImportOpen(true)}
              >
                Import
              </button>
              <button
                className="icon-button add-host-button"
                aria-label="Add host"
                onClick={() => setEditor("new")}
              >
                +
              </button>
            </div>
          </div>
          <nav className="host-list" aria-label="Saved hosts">
            {hosts.map((host) => (
              <div className="host-card" key={host.id}>
                <button
                  className="host-row"
                  onClick={() => void connect(host)}
                  disabled={connectingHostId === host.id}
                >
                  <span className="host-icon">⌘</span>
                  <span className="host-copy">
                    <strong>{host.label}</strong>
                    <small>
                      {host.username}@{host.hostname}:{host.port}
                    </small>
                  </span>
                  <span className="connect-arrow">
                    {connectingHostId === host.id ? "…" : "›"}
                  </span>
                </button>
                <div className="host-actions">
                  <button
                    className="link-button"
                    onClick={() => setEditor(host)}
                  >
                    Edit
                  </button>
                  <button
                    className="link-button link-button--danger"
                    onClick={() => setPendingDelete(host)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </nav>
          <div className="sidebar-note">
            Credentials stay in the encrypted vault.{" "}
            {status.recoveryAvailable
              ? "Keyring recovery is available."
              : "Recovery is not configured."}
          </div>
        </aside>
        {drawerOpen && (
          <button
            className="drawer-scrim"
            aria-label="Close hosts"
            onClick={() => setDrawerOpen(false)}
          />
        )}

        <main className="main-panel">
          {tabs.length > 0 && (
            <div className="tabbar" role="tablist">
              {tabs.map((tab) => (
                <button
                  role="tab"
                  aria-selected={activeId === tab.sessionId}
                  className={`tab ${activeId === tab.sessionId ? "tab--active" : ""}`}
                  key={tab.sessionId}
                  onClick={() => {
                    setActiveId(tab.sessionId);
                    focusTerminal(tab.sessionId);
                  }}
                >
                  <span
                    className={`status-dot ${tab.connected ? "status-dot--online" : ""}`}
                  />
                  <span className="tab-title">{tab.title}</span>
                  <span
                    className="tab-close"
                    role="button"
                    aria-label={`Close ${tab.title}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      void closeTab(tab.sessionId);
                    }}
                  >
                    ×
                  </span>
                </button>
              ))}
            </div>
          )}

          <section className="terminal-stack">
            {tabs.length === 0 ? (
              <div className="empty-state">
                <div className="empty-glyph">&gt;_</div>
                <h1>Open a secure shell</h1>
                <p>Add a host or select one to start an SSH session.</p>
                {error && <div className="error-banner">{error}</div>}
                <div className="empty-actions">
                  <button
                    className="primary-button"
                    onClick={() => setEditor("new")}
                  >
                    Add host
                  </button>
                  {hosts[0] && (
                    <button
                      className="ghost-button"
                      onClick={() => void connect(hosts[0])}
                      disabled={Boolean(connectingHostId)}
                    >
                      {connectingHostId
                        ? "Connecting…"
                        : `Connect to ${hosts[0].label}`}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              tabs.map((tab) => (
                <TerminalView
                  key={tab.sessionId}
                  sessionId={tab.sessionId}
                  active={tab.sessionId === activeId}
                />
              ))
            )}
          </section>
          {error && tabs.length > 0 && (
            <button className="error-toast" onClick={() => setError(undefined)}>
              {error}
            </button>
          )}
        </main>
      </div>

      {prompt && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal" role="alertdialog" aria-modal="true">
            <span className="modal-kicker">Unknown host key</span>
            <h2>Verify this server</h2>
            <p>
              This host has not been seen before. Confirm the fingerprint using a
              trusted channel before continuing.
            </p>
            <dl className="fingerprint">
              <dt>Algorithm</dt>
              <dd>{prompt.algorithm}</dd>
              <dt>Fingerprint</dt>
              <dd>{prompt.fingerprint}</dd>
            </dl>
            <div className="modal-actions">
              <button onClick={() => void answerPrompt(false)}>Cancel</button>
              <button
                className="primary-button"
                onClick={() => void answerPrompt(true)}
              >
                Trust and connect
              </button>
            </div>
          </div>
        </div>
      )}

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

      {pendingDelete && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal" role="alertdialog" aria-modal="true">
            <span className="modal-kicker">Delete host</span>
            <h2>Remove {pendingDelete.label}?</h2>
            <p>
              The host record and its local password identity will be tombstoned
              in the vault. Active sessions for this host will close.
            </p>
            <div className="modal-actions">
              <button onClick={() => setPendingDelete(undefined)}>Cancel</button>
              <button
                className="primary-button danger-button"
                onClick={() => void confirmDelete()}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {changePasswordOpen && (
        <ChangePasswordModal onClose={() => setChangePasswordOpen(false)} />
      )}
    </div>
  );
}
