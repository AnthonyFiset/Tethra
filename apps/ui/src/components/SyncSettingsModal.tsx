import { useEffect, useState } from "react";
import {
  syncConfigureFile,
  syncConfigureHttp,
  syncDisable,
  syncJoinHttp,
  syncNow,
  syncPickFolder,
  syncStatus,
  type SyncStatusDto,
} from "../lib/ipc";
import { cn } from "../lib/cn";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";
import { ErrorBanner, Field, inputClass } from "./ui/Field";

interface SyncSettingsPanelProps {
  onHostsMayHaveChanged: () => void;
  onVaultReplaced: () => void;
  /** When set, show a Close button (standalone modal footer). */
  onClose?: () => void;
}

export function SyncSettingsPanel({
  onHostsMayHaveChanged,
  onVaultReplaced,
  onClose,
}: SyncSettingsPanelProps): React.JSX.Element {
  const [status, setStatus] = useState<SyncStatusDto>();
  const [mode, setMode] = useState<"file" | "http">("http");
  const [httpUrl, setHttpUrl] = useState("http://thinkpad:8787");
  const [httpToken, setHttpToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [mismatched, setMismatched] = useState(false);

  useEffect(() => {
    void syncStatus()
      .then((next) => {
        setStatus(next);
        if (next.backendKind === "file") setMode("file");
        if (next.backendKind === "http") {
          setMode("http");
          if (next.detail) setHttpUrl(next.detail);
        }
      })
      .catch((reason: unknown) => setError(String(reason)));
  }, []);

  async function refresh(): Promise<void> {
    setStatus(await syncStatus());
  }

  async function chooseFolder(): Promise<void> {
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const path = await syncPickFolder();
      if (!path) return;
      const next = await syncConfigureFile(path);
      setStatus(next);
      setMode("file");
      setMessage(`Sync folder set to ${path}`);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function saveHttp(): Promise<void> {
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const next = await syncConfigureHttp(
        httpUrl.trim(),
        httpToken.trim() || undefined,
      );
      setStatus(next);
      setMode("http");
      setMessage(`Sync server set to ${httpUrl.trim()}`);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function runSync(): Promise<void> {
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const report = await syncNow();
      await refresh();
      onHostsMayHaveChanged();
      setMessage(
        `Synced — pulled ${report.pulled}, applied ${report.applied}, pushed ${report.pushed}`,
      );
    } catch (reason) {
      const text = String(reason);
      setError(text);
      setMismatched(text.includes("created separately"));
      await refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function replaceAndJoin(): Promise<void> {
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      await syncJoinHttp(httpUrl.trim(), httpToken.trim() || undefined, true);
      setMismatched(false);
      onVaultReplaced();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function disable(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      setStatus(await syncDisable());
      setMessage("Sync disabled on this device");
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {mismatched && (
        <div className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
          <p className="m-0 text-micro text-warning">
            This device&rsquo;s vault was created on its own, so its key cannot
            decrypt the synced hosts. Replace it with the synced vault to fix
            this. Passwords saved only on this device will be lost; hosts come
            back from the server.
          </p>
          <Button
            variant="danger"
            disabled={busy || !httpUrl.trim()}
            onClick={() => void replaceAndJoin()}
          >
            Replace this device&rsquo;s vault and join
          </Button>
        </div>
      )}
      {message && (
        <div className="rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-micro text-accent">
          {message}
        </div>
      )}

      <div className="rounded-md border border-line bg-base px-3 py-2.5 text-micro text-fg-muted">
        <div className="flex justify-between gap-3">
          <span>Backend</span>
          <span className="font-medium text-fg">
            {status?.configured ? status.backendKind : "disabled"}
          </span>
        </div>
        {status?.detail && (
          <div className="mt-1 break-all font-mono text-fg-subtle">
            {status.detail}
          </div>
        )}
        {status?.lastSyncedAt && (
          <div className="mt-1">Last sync: {status.lastSyncedAt}</div>
        )}
        {status?.lastError && (
          <div className="mt-1 text-danger">{status.lastError}</div>
        )}
      </div>

      <div className="flex gap-2">
        <ModeChip active={mode === "http"} onClick={() => setMode("http")}>
          HTTP server
        </ModeChip>
        <ModeChip active={mode === "file"} onClick={() => setMode("file")}>
          Shared folder
        </ModeChip>
      </div>

      {mode === "http" ? (
        <div className="flex flex-col gap-3">
          <Field
            label="Server URL"
            value={httpUrl}
            onChange={(event) => setHttpUrl(event.target.value)}
            placeholder="http://thinkpad:8787"
            disabled={busy}
          />
          <label className="flex flex-col gap-1.5">
            <span className="text-micro font-medium text-fg-muted">
              Token (optional)
            </span>
            <input
              type="password"
              value={httpToken}
              onChange={(event) => setHttpToken(event.target.value)}
              disabled={busy}
              className={inputClass}
              placeholder="Same value as TETHRA_SYNC_TOKEN on the server"
            />
          </label>
          <Button
            variant="primary"
            disabled={busy || !httpUrl.trim()}
            onClick={() => void saveHttp()}
          >
            Save HTTP sync
          </Button>
        </div>
      ) : (
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => void chooseFolder()}
        >
          Choose sync folder
        </Button>
      )}

      <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
        <Button
          variant="ghost"
          disabled={busy || !status?.configured}
          onClick={() => void disable()}
        >
          Disable
        </Button>
        <Button
          variant="subtle"
          disabled={busy || !status?.configured}
          onClick={() => void runSync()}
        >
          {busy ? "Working…" : "Sync now"}
        </Button>
        {onClose && (
          <Button variant="subtle" disabled={busy} onClick={onClose}>
            Close
          </Button>
        )}
      </div>
    </div>
  );
}

interface SyncSettingsModalProps {
  onClose: () => void;
  onHostsMayHaveChanged: () => void;
  onVaultReplaced: () => void;
}

export function SyncSettingsModal({
  onClose,
  onHostsMayHaveChanged,
  onVaultReplaced,
}: SyncSettingsModalProps): React.JSX.Element {
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      width="lg"
      kicker="Sync"
      title="Vault sync"
      description="Share encrypted host metadata across Mac, Windows, and Linux. Passwords stay device-local unless you opt in per host. Sync runs in the background; use Sync now when you want certainty."
    >
      <SyncSettingsPanel
        onHostsMayHaveChanged={onHostsMayHaveChanged}
        onVaultReplaced={onVaultReplaced}
        onClose={onClose}
      />
    </Dialog>
  );
}

function ModeChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-7 cursor-pointer rounded-md border px-2.5 text-micro transition-colors",
        active
          ? "border-accent bg-accent/15 text-fg"
          : "border-line text-fg-muted hover:bg-hover",
      )}
    >
      {children}
    </button>
  );
}
