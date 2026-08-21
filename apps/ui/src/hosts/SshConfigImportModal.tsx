import { useEffect, useMemo, useRef, useState } from "react";
import {
  identityImport,
  identityProbe,
  importSshConfig,
  previewSshConfig,
  updateHost,
  type HostSummaryDto,
  type SshConfigHostDto,
  type SshConfigPreviewDto,
} from "../lib/ipc";
import { Button } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { ErrorBanner, Field } from "../components/ui/Field";

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
  const [importedByAlias, setImportedByAlias] = useState<
    Map<string, HostSummaryDto>
  >(new Map());
  const [keyImport, setKeyImport] = useState<{
    host: SshConfigHostDto;
    path: string;
    encrypted: boolean;
  }>();
  const [rememberPassphrase, setRememberPassphrase] = useState(false);
  const [keySyncSecret, setKeySyncSecret] = useState(false);
  const passphraseRef = useRef<HTMLInputElement>(null);

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
      const byAlias = new Map(imported.map((host) => [host.label, host]));
      setImportedByAlias(byAlias);
      onImported(imported);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function startKeyImport(host: SshConfigHostDto): Promise<void> {
    if (!host.identityFileHint) return;
    setBusy(true);
    setError(undefined);
    try {
      let vaultHost = importedByAlias.get(host.alias);
      if (!vaultHost) {
        const imported = await importSshConfig([host.alias]);
        vaultHost = imported.find((item) => item.label === host.alias);
        if (!vaultHost) {
          throw new Error(`Could not import host ${host.alias}.`);
        }
        setImportedByAlias((current) => {
          const next = new Map(current);
          for (const item of imported) next.set(item.label, item);
          return next;
        });
        onImported(imported);
      }

      const path = host.identityFileHint;
      const probe = await identityProbe(path);
      if (probe.encrypted) {
        setKeyImport({ host, path, encrypted: true });
        setRememberPassphrase(false);
        setKeySyncSecret(false);
        if (passphraseRef.current) passphraseRef.current.value = "";
        return;
      }

      await attachImportedKey(vaultHost, path, undefined, false);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function attachImportedKey(
    vaultHost: HostSummaryDto,
    path: string,
    passphrase?: string,
    syncSecret = false,
  ): Promise<void> {
    const identity = await identityImport({
      path,
      passphrase,
      rememberPassphrase: passphrase ? rememberPassphrase : false,
      syncSecret,
    });
    const updated = await updateHost(vaultHost.id, {
      label: vaultHost.label,
      hostname: vaultHost.hostname,
      port: vaultHost.port,
      username: vaultHost.username,
      color: vaultHost.color ?? undefined,
      syncSecret: vaultHost.syncSecret,
      shellIntegration: vaultHost.shellIntegration,
      identityId: identity.id,
    });
    setImportedByAlias((current) => {
      const next = new Map(current);
      next.set(updated.label, updated);
      return next;
    });
    onImported([updated]);
    setKeyImport(undefined);
    setRememberPassphrase(false);
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
            {importedByAlias.size > 0 ? "Done" : "Cancel"}
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
            IdentityFile references were detected. Host metadata imports first;
            use “Import this key” to add the private key into the vault and
            attach it to the host. Keys sync only if you turn it on per key.
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
              {preview.hosts.map((host) => {
                const vaultHost = importedByAlias.get(host.alias);
                const keyAttached = vaultHost?.authKind === "sshKey";
                return (
                  <div
                    key={host.alias}
                    className="flex items-center gap-2.5 rounded px-2 py-1.5 transition-colors hover:bg-hover"
                  >
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
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
                          {host.identityFileHint
                            ? ` · ${host.identityFileHint}`
                            : ""}
                        </span>
                      </span>
                    </label>
                    {host.identityFileHint && (
                      <Button
                        variant="subtle"
                        disabled={busy || keyAttached}
                        onClick={() => void startKeyImport(host)}
                      >
                        {keyAttached ? "Key attached" : "Import this key"}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {keyImport && (
          <div className="flex flex-col gap-2 rounded-md border border-line bg-elevated px-3 py-2.5">
            <p className="m-0 text-micro text-fg-muted">
              Encrypted key for{" "}
              <span className="font-medium text-fg">{keyImport.host.alias}</span>
              : <span className="font-mono text-fg">{keyImport.path}</span>
            </p>
            <Field
              label="Passphrase"
              inputRef={passphraseRef}
              type="password"
              autoComplete="off"
              disabled={busy}
              required
            />
            <label className="flex cursor-pointer items-center gap-2 text-micro text-fg-muted">
              <input
                type="checkbox"
                checked={rememberPassphrase}
                disabled={busy}
                onChange={(event) =>
                  setRememberPassphrase(event.target.checked)
                }
              />
              Remember passphrase in vault
            </label>
            <label className="flex cursor-pointer items-start gap-2.5 text-micro text-fg-muted">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={keySyncSecret}
                disabled={busy}
                onChange={(event) => setKeySyncSecret(event.target.checked)}
              />
              <span>
                <span className="block font-medium text-fg">
                  Sync this key to other devices
                </span>
                Off by default. Encrypted key rides vault sync when on.
              </span>
            </label>
            <div className="flex justify-end gap-2">
              <Button
                variant="subtle"
                disabled={busy}
                onClick={() => {
                  setKeyImport(undefined);
                  setKeySyncSecret(false);
                  if (passphraseRef.current) passphraseRef.current.value = "";
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => {
                  void (async () => {
                    if (!keyImport) return;
                    setBusy(true);
                    setError(undefined);
                    try {
                      const vaultHost = importedByAlias.get(
                        keyImport.host.alias,
                      );
                      if (!vaultHost) {
                        throw new Error("Import the host first.");
                      }
                      const passphrase = passphraseRef.current?.value ?? "";
                      if (passphraseRef.current) {
                        passphraseRef.current.value = "";
                      }
                      await attachImportedKey(
                        vaultHost,
                        keyImport.path,
                        passphrase || undefined,
                        keySyncSecret,
                      );
                      setKeyImport(undefined);
                      setKeySyncSecret(false);
                    } catch (reason) {
                      setError(String(reason));
                    } finally {
                      setBusy(false);
                    }
                  })();
                }}
              >
                Import key
              </Button>
            </div>
          </div>
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
