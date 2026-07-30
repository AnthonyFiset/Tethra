import { useEffect, useMemo, useState } from "react";
import {
  importSshConfig,
  previewSshConfig,
  type HostSummaryDto,
  type SshConfigPreviewDto,
} from "../lib/ipc";

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
    <div className="modal-backdrop" role="presentation">
      <div
        className="modal ssh-import-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ssh-import-title"
      >
        <span className="modal-kicker">OpenSSH</span>
        <h2 id="ssh-import-title">Import ~/.ssh/config</h2>
        <p>
          Select concrete host aliases to save in the encrypted vault.
          Referenced jump hosts are included automatically.
        </p>

        {error && <div className="error-banner">{error}</div>}
        {preview?.warnings.map((warning) => (
          <div className="warn-banner" key={warning}>
            {warning}
          </div>
        ))}
        {hasIdentityFiles && (
          <div className="info-banner">
            IdentityFile references were detected. M4 imports host metadata
            only; add a password by editing the host. Private-key identities
            remain deferred.
          </div>
        )}

        {!preview && !error && <div className="import-loading">Reading config…</div>}
        {preview && preview.hosts.length === 0 && (
          <div className="import-empty">
            No concrete Host aliases were found. Wildcard patterns are defaults
            and are not imported as hosts.
          </div>
        )}
        {preview && preview.hosts.length > 0 && (
          <>
            <div className="import-toolbar">
              <span>
                {selectedCount} of {preview.hosts.length} selected
              </span>
              <button
                className="link-button"
                onClick={() =>
                  setSelected(
                    selectedCount === preview.hosts.length
                      ? new Set()
                      : new Set(preview.hosts.map((host) => host.alias)),
                  )
                }
                disabled={busy}
              >
                {selectedCount === preview.hosts.length
                  ? "Select none"
                  : "Select all"}
              </button>
            </div>
            <div className="import-host-list">
              {preview.hosts.map((host) => (
                <label className="import-host" key={host.alias}>
                  <input
                    type="checkbox"
                    checked={selected.has(host.alias)}
                    disabled={busy}
                    onChange={() => toggle(host.alias)}
                  />
                  <span className="import-host-copy">
                    <strong>{host.alias}</strong>
                    <small>
                      {host.username}@{host.hostname}:{host.port}
                    </small>
                    {host.proxyJump && (
                      <small className="import-jump">
                        via {host.proxyJump}
                      </small>
                    )}
                  </span>
                  {host.hasIdentityFile && (
                    <span className="import-badge">key ref</span>
                  )}
                </label>
              ))}
            </div>
          </>
        )}

        <div className="modal-actions">
          <button disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={busy || selectedCount === 0}
            onClick={() => void importSelected()}
          >
            {busy ? "Importing…" : `Import ${selectedCount || ""}`.trim()}
          </button>
        </div>
      </div>
    </div>
  );
}
