import { useState } from "react";
import { vaultSetIdleLockSecs } from "../lib/ipc";
import {
  DEFAULTS,
  getIdleLockSecs,
  IDLE_LOCK_OPTIONS,
  setIdleLockSecs,
} from "../lib/prefs";
import { SyncSettingsPanel } from "../components/SyncSettingsModal";
import { ChangePasswordPanel } from "../vault/ChangePasswordModal";
import { SurfaceShell } from "./SurfaceShell";

function PrefRow({
  title,
  detail,
  defaultLabel,
  onReset,
  children,
}: {
  title: string;
  detail: string;
  defaultLabel?: string;
  onReset?: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-base px-3 py-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="text-ui font-medium text-fg">{title}</div>
        <p className="m-0 text-micro text-fg-subtle">{detail}</p>
        {defaultLabel && onReset && (
          <button
            type="button"
            className="mt-1 cursor-pointer text-micro text-accent hover:underline"
            onClick={onReset}
          >
            Reset to {defaultLabel}
          </button>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function VaultSurface({
  onClose,
  onHostsMayHaveChanged,
  onVaultReplaced,
}: {
  onClose: () => void;
  onHostsMayHaveChanged: () => void;
  onVaultReplaced: () => void;
}): React.JSX.Element {
  const [idleSecs, setIdleSecs] = useState(() => getIdleLockSecs());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  return (
    <SurfaceShell
      title="Vault"
      description="Unlock status, sync backend, auto-lock, and master password. Identities live on their own surface."
      onClose={onClose}
    >
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <PrefRow
          title="Auto-lock"
          detail="Lock the vault after idle time with no vault activity"
          defaultLabel="15 minutes"
          onReset={() => {
            setIdleSecs(DEFAULTS.idleLockSecs);
            setIdleLockSecs(DEFAULTS.idleLockSecs);
            setBusy(true);
            void vaultSetIdleLockSecs(DEFAULTS.idleLockSecs)
              .then((applied) => setIdleSecs(applied))
              .catch((reason: unknown) => setError(String(reason)))
              .finally(() => setBusy(false));
          }}
        >
          <select
            className="h-8 rounded-md border border-line bg-base px-2 text-ui text-fg"
            value={idleSecs}
            disabled={busy}
            onChange={(event) => {
              const next = Number(event.target.value);
              setIdleSecs(next);
              setIdleLockSecs(next);
              setError(undefined);
              setBusy(true);
              void vaultSetIdleLockSecs(next)
                .then((applied) => setIdleSecs(applied))
                .catch((reason: unknown) => setError(String(reason)))
                .finally(() => setBusy(false));
            }}
          >
            {IDLE_LOCK_OPTIONS.map((option) => (
              <option key={option.secs} value={option.secs}>
                {option.label}
              </option>
            ))}
          </select>
        </PrefRow>
        {error && <p className="m-0 text-micro text-danger">{error}</p>}

        <section className="flex flex-col gap-2">
          <h2 className="m-0 text-ui font-medium text-fg">Sync</h2>
          <SyncSettingsPanel
            onHostsMayHaveChanged={onHostsMayHaveChanged}
            onVaultReplaced={onVaultReplaced}
          />
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="m-0 text-ui font-medium text-fg">
            Change master password
          </h2>
          <ChangePasswordPanel onDone={onClose} />
        </section>
      </div>
    </SurfaceShell>
  );
}
