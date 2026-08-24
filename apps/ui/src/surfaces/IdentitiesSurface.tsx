import { useEffect, useRef, useState } from "react";
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

const DELETE_CONFIRM_ARM_MS = 300;

function IdentitiesPanel(): React.JSX.Element {
  const [identities, setIdentities] = useState<IdentitySummaryDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [renaming, setRenaming] = useState<IdentitySummaryDto>();
  const [renameLabel, setRenameLabel] = useState("");
  const [pendingDelete, setPendingDelete] = useState<{
    identity: IdentitySummaryDto;
    dependents: { id: string; label: string }[];
  }>();
  const [dangerReady, setDangerReady] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const armedRowRef = useRef<HTMLLIElement>(null);

  async function refresh(): Promise<void> {
    setIdentities(await listIdentities());
  }

  useEffect(() => {
    void refresh().catch((reason: unknown) => setError(String(reason)));
  }, []);

  useEffect(() => {
    if (!pendingDelete) {
      setDangerReady(false);
      return;
    }
    setDangerReady(false);
    const timer = window.setTimeout(
      () => setDangerReady(true),
      DELETE_CONFIRM_ARM_MS,
    );
    return () => window.clearTimeout(timer);
  }, [pendingDelete?.identity.id]);

  useEffect(() => {
    if (!pendingDelete) return;
    cancelRef.current?.focus();
  }, [pendingDelete?.identity.id]);

  useEffect(() => {
    if (!pendingDelete) return;
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        setPendingDelete(undefined);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingDelete]);

  useEffect(() => {
    if (!pendingDelete) return;
    function onPointerDown(event: PointerEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (armedRowRef.current?.contains(target)) return;
      setPendingDelete(undefined);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [pendingDelete]);

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
    setDeletingId(identity.id);
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
      setDeletingId(null);
    }
  }

  function armDelete(identity: IdentitySummaryDto): void {
    setPendingDelete({ identity, dependents: [] });
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {identities.map((identity) => {
          const confirming =
            pendingDelete?.identity.id === identity.id
              ? pendingDelete
              : undefined;
          const force =
            identity.usageCount > 0 ||
            (confirming?.dependents.length ?? 0) > 0;
          const deleting = deletingId === identity.id;

          return (
            <li
              key={identity.id}
              ref={confirming ? armedRowRef : undefined}
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
                {confirming ? (
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={deleting || !dangerReady}
                      onClick={() => void remove(identity, force)}
                    >
                      {force ? "Delete anyway" : "Delete"}
                    </Button>
                    <Button
                      ref={cancelRef}
                      variant="subtle"
                      size="sm"
                      onClick={() => setPendingDelete(undefined)}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <>
                    <Button
                      variant="subtle"
                      disabled={busy || deletingId !== null}
                      onClick={() => {
                        setRenaming(identity);
                        setRenameLabel(identity.label);
                      }}
                    >
                      Rename
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy || deletingId !== null}
                      className="hover:border-transparent hover:bg-danger/15 hover:text-danger"
                      onClick={() => armDelete(identity)}
                    >
                      Delete
                    </Button>
                  </>
                )}
              </div>
              {confirming && force && (
                <p className="m-0 text-micro text-fg-muted">
                  {confirming.dependents.length > 0
                    ? `Still attached to ${confirming.dependents.map((h) => h.label).join(", ")}. Force delete clears those links.`
                    : `Used by ${identity.usageCount} host${identity.usageCount === 1 ? "" : "s"}. Force delete clears those links.`}
                </p>
              )}
              <label className="flex cursor-pointer items-start gap-2.5 border-t border-line pt-2">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={identity.syncSecret}
                  disabled={busy || deletingId !== null}
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
          );
        })}
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
