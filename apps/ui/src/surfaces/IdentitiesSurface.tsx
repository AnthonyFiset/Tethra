import { useEffect, useState } from "react";
import {
  identityDelete,
  identityRename,
  identitySetSyncSecret,
  listIdentities,
  type IdentitySummaryDto,
} from "../lib/ipc";
import { Button } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { ErrorBanner, Field } from "../components/ui/Field";
import { SurfaceShell } from "./SurfaceShell";

function IdentitiesPanel(): React.JSX.Element {
  const [identities, setIdentities] = useState<IdentitySummaryDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [renaming, setRenaming] = useState<IdentitySummaryDto>();
  const [renameLabel, setRenameLabel] = useState("");
  const [pendingDelete, setPendingDelete] = useState<{
    identity: IdentitySummaryDto;
    dependents: { id: string; label: string }[];
  }>();

  async function refresh(): Promise<void> {
    setIdentities(await listIdentities());
  }

  useEffect(() => {
    void refresh().catch((reason: unknown) => setError(String(reason)));
  }, []);

  async function saveRename(): Promise<void> {
    if (!renaming) return;
    setBusy(true);
    setError(undefined);
    try {
      await identityRename(renaming.id, renameLabel);
      setRenaming(undefined);
      await refresh();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function remove(
    identity: IdentitySummaryDto,
    force: boolean,
  ): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const result = await identityDelete(identity.id, force);
      if (!result.deleted) {
        setPendingDelete({
          identity,
          dependents: result.dependentHosts,
        });
        return;
      }
      setPendingDelete(undefined);
      await refresh();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h4 className="mt-0 mb-1 text-ui font-medium text-fg">Identities</h4>
        <p className="m-0 text-micro text-fg-subtle">
          Password and SSH key identities stored in the vault. Keys sync only if
          you turn it on per key (same opt-in as passwords).
        </p>
      </div>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {identities.map((identity) => (
          <li
            key={identity.id}
            className="flex flex-col gap-2 rounded-md border border-line bg-base px-3 py-2"
          >
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ui font-medium text-fg">
                  {identity.label}
                </span>
                <span className="block truncate text-micro text-fg-subtle">
                  {identity.kind === "sshKey" ? "SSH key" : "Password"}
                  {identity.fingerprint ? ` · ${identity.fingerprint}` : ""}
                  {` · used by ${identity.usageCount}`}
                  {identity.syncSecret ? " · syncs" : " · local only"}
                </span>
              </span>
              <Button
                variant="subtle"
                disabled={busy}
                onClick={() => {
                  setRenaming(identity);
                  setRenameLabel(identity.label);
                }}
              >
                Rename
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => void remove(identity, false)}
              >
                Delete
              </Button>
            </div>
            <label className="flex cursor-pointer items-start gap-2.5 border-t border-line pt-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={identity.syncSecret}
                disabled={busy}
                onChange={(event) =>
                  void (async () => {
                    setBusy(true);
                    setError(undefined);
                    try {
                      await identitySetSyncSecret(
                        identity.id,
                        event.target.checked,
                      );
                      await refresh();
                    } catch (reason) {
                      setError(String(reason));
                    } finally {
                      setBusy(false);
                    }
                  })()
                }
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-ui font-medium text-fg">
                  {identity.kind === "sshKey"
                    ? "Sync this key to other devices"
                    : "Sync this password to other devices"}
                </span>
                <span className="text-micro text-fg-subtle">
                  Off by default. When on, encrypted credentials ride vault
                  sync. Turning off stops future sync; devices that already
                  have a copy keep it.
                </span>
              </span>
            </label>
          </li>
        ))}
        {identities.length === 0 && (
          <li className="rounded-md border border-dashed border-line px-3 py-4 text-center text-micro text-fg-subtle">
            No identities yet. Import an SSH key when adding a host, or save a
            host with a password.
          </li>
        )}
      </ul>

      {renaming && (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next) setRenaming(undefined);
          }}
          kicker="Identity"
          title="Rename identity"
          description="Update the label shown in host forms and settings."
          footer={
            <>
              <Button
                variant="subtle"
                disabled={busy}
                onClick={() => setRenaming(undefined)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={busy || !renameLabel.trim()}
                onClick={() => void saveRename()}
              >
                Save
              </Button>
            </>
          }
        >
          <Field
            label="Label"
            value={renameLabel}
            onChange={(event) => setRenameLabel(event.target.value)}
            disabled={busy}
            autoFocus
          />
        </Dialog>
      )}

      {pendingDelete && (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next) setPendingDelete(undefined);
          }}
          kicker="Identity"
          title="Delete identity?"
          description="This identity is still attached to hosts. Force delete clears those links."
          footer={
            <>
              <Button
                variant="subtle"
                disabled={busy}
                onClick={() => setPendingDelete(undefined)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => void remove(pendingDelete.identity, true)}
              >
                Delete anyway
              </Button>
            </>
          }
        >
          <p className="m-0 text-ui text-fg-muted">
            Used by:
          </p>
          <ul className="mt-2 mb-0 flex list-none flex-col gap-1 p-0">
            {pendingDelete.dependents.map((host) => (
              <li
                key={host.id}
                className="rounded-md border border-line px-3 py-2 text-ui text-fg"
              >
                {host.label}
              </li>
            ))}
          </ul>
        </Dialog>
      )}
    </div>
  );
}

export function IdentitiesSurface({
  onClose,
}: {
  onClose: () => void;
}): React.JSX.Element {
  return (
    <SurfaceShell
      title="Identities"
      description="Password and SSH key identities stored in the vault. Keys sync only if you opt in per key."
      onClose={onClose}
    >
      <IdentitiesPanel />
    </SurfaceShell>
  );
}
