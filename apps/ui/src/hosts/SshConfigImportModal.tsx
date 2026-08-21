import { useEffect, useMemo, useState } from "react";
import {
  importSshConfig,
  previewSshConfig,
  type HostSummaryDto,
  type SshConfigPreviewDto,
} from "../lib/ipc";
import { Button } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { ErrorBanner } from "../components/ui/Field";

interface SshConfigImportModalProps {
  onClose: () => void;
  onImported: (hosts: HostSummaryDto[]) => void;
}

export function SshConfigImportModal({
  onClose,
  onImported,
}: SshConfigImportModalProps): React.JSX.Element {
  const [preview, setPreview] = useState<SshConfigPreviewDto>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    previewSshConfig()
      .then((result) => {
        if (!active) return;
        setPreview(result);
        setSelected(new Set(result.hosts.map((host) => host.alias)));
      })
      .catch((reason: unknown) => {
        if (active) setError(String(reason));
      });
    return () => {
      active = false;
    };
  }, []);

  const selectedCount = selected.size;
  const hasIdentityFiles = useMemo(
    () => preview?.hosts.some((host) => host.hasIdentityFile) ?? false,
    [preview],
  );

  function toggle(alias: string): void {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(alias)) next.delete(alias);
      else next.add(alias);
      return next;
    });
  }

  async function importSelected(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const imported = await importSshConfig([...selected]);
      onImported(imported);
      onClose();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      width="lg"
      kicker="OpenSSH"
      title="Import ~/.ssh/config"
      description="Select concrete host aliases to save in the encrypted vault. Referenced jump hosts are included automatically."
      footer={
        <>
          <Button variant="subtle" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={busy || selectedCount === 0}
            onClick={() => void importSelected()}
          >
            {busy ? "Importing…" : `Import ${selectedCount || ""}`.trim()}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        {error && <ErrorBanner>{error}</ErrorBanner>}
        {preview?.warnings.map((warning) => (
          <Notice key={warning} tone="warning">
            {warning}
          </Notice>
        ))}
        {hasIdentityFiles && (
          <Notice tone="info">
            IdentityFile references were detected. Import covers host metadata
            only; add a password by editing the host. Private keys stay on each
            device and are not imported.
          </Notice>
        )}

        {!preview && !error && (
          <p className="py-6 text-center text-ui text-fg-subtle">
            Reading config…
          </p>
        )}

        {preview && preview.hosts.length === 0 && (
          <p className="py-6 text-center text-ui text-fg-subtle">
            No concrete Host aliases were found. Wildcard patterns are defaults
            and are not imported as hosts.
          </p>
        )}

        {preview && preview.hosts.length > 0 && (
          <>
            <div className="flex items-center justify-between text-micro text-fg-subtle">
              <span>
                {selectedCount} of {preview.hosts.length} selected
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  setSelected(
                    selectedCount === preview.hosts.length
                      ? new Set()
                      : new Set(preview.hosts.map((host) => host.alias)),
                  )
                }
                className="cursor-pointer text-fg-muted transition-colors hover:text-accent disabled:opacity-45"
              >
                {selectedCount === preview.hosts.length
                  ? "Select none"
                  : "Select all"}
              </button>
            </div>

            <div className="max-h-72 overflow-y-auto rounded-md border border-line bg-base p-1">
              {preview.hosts.map((host) => (
                <label
                  key={host.alias}
                  className="flex cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 transition-colors hover:bg-hover"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(host.alias)}
                    disabled={busy}
                    onChange={() => toggle(host.alias)}
                    className="size-3.5 shrink-0 accent-accent"
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-ui font-medium text-fg">
                      {host.alias}
                    </span>
                    <span className="truncate text-micro text-fg-subtle">
                      {host.username}@{host.hostname}:{host.port}
                      {host.proxyJump && ` · via ${host.proxyJump}`}
                    </span>
                  </span>
                  {host.hasIdentityFile && (
                    <span className="ml-auto shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] text-fg-subtle">
                      key ref
                    </span>
                  )}
                </label>
              ))}
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: "warning" | "info";
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      className={
        tone === "warning"
          ? "rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-micro text-warning"
          : "rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-micro text-accent"
      }
    >
      {children}
    </div>
  );
}
