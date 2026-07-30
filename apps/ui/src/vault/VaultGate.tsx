import { useRef, useState, type FormEvent, type RefObject } from "react";
import {
  vaultCreate,
  vaultRecover,
  vaultUnlock,
  type VaultStatusDto,
} from "../lib/ipc";
import { Logo } from "../components/Logo";
import { Button } from "../components/ui/Button";
import { ErrorBanner, Field } from "../components/ui/Field";

export type VaultMode = "create" | "unlock" | "recover";

interface VaultGateProps {
  status: VaultStatusDto;
  onUnlocked: (status: VaultStatusDto) => void;
}

function takeValue(ref: RefObject<HTMLInputElement | null>): string {
  const input = ref.current;
  if (!input) return "";
  const value = input.value;
  input.value = "";
  return value;
}

export function VaultGate({
  status,
  onUnlocked,
}: VaultGateProps): React.JSX.Element {
  const [mode, setMode] = useState<VaultMode>(
    status.exists ? "unlock" : "create",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [enableRecovery, setEnableRecovery] = useState(true);

  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(undefined);
    setBusy(true);

    const password = takeValue(passwordRef);
    const confirm = takeValue(confirmRef);

    try {
      if (mode === "create" || mode === "recover") {
        if (password.length < 8) {
          throw new Error("Password must be at least 8 characters.");
        }
        if (password !== confirm) {
          throw new Error("Passwords do not match.");
        }
      }
      if (!password) {
        throw new Error("Password is required.");
      }

      let next: VaultStatusDto;
      if (mode === "create") {
        next = await vaultCreate(password, enableRecovery);
      } else if (mode === "unlock") {
        next = await vaultUnlock(password);
      } else {
        next = await vaultRecover(password);
      }
      onUnlocked(next);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  const title =
    mode === "create"
      ? "Create encrypted vault"
      : mode === "recover"
        ? "Recover vault"
        : "Unlock vault";

  const subtitle =
    mode === "create"
      ? "Hosts and passwords are encrypted on disk with Argon2id and XChaCha20-Poly1305."
      : mode === "recover"
        ? "Use the OS keyring recovery key to set a new master password. Existing encrypted items stay intact."
        : "Enter your master password to decrypt hosts and identities.";

  return (
    <div
      data-tauri-drag-region="deep"
      className="grid size-full place-items-center bg-base p-6"
    >
      <form
        onSubmit={(event) => void submit(event)}
        className="flex w-full max-w-sm flex-col gap-4 rounded-panel border border-line bg-surface p-6"
      >
        <Logo variant="lockup" size={26} />

        <div>
          <span className="mb-1.5 block text-micro font-semibold tracking-[0.1em] text-fg-subtle uppercase">
            Encrypted vault
          </span>
          <h1 className="m-0 text-lg font-semibold text-fg">{title}</h1>
          <p className="mt-1.5 mb-0 text-ui text-fg-muted">{subtitle}</p>
        </div>

        {error && <ErrorBanner>{error}</ErrorBanner>}

        <Field
          label={mode === "recover" ? "New master password" : "Master password"}
          inputRef={passwordRef}
          type="password"
          name="vault-password"
          autoComplete={mode === "unlock" ? "current-password" : "new-password"}
          autoFocus
          disabled={busy}
          required
        />

        {(mode === "create" || mode === "recover") && (
          <Field
            label="Confirm password"
            inputRef={confirmRef}
            type="password"
            name="vault-password-confirm"
            autoComplete="new-password"
            disabled={busy}
            required
          />
        )}

        {mode === "create" && (
          <div className="flex flex-col gap-2">
            <label className="flex cursor-pointer items-center gap-2 text-ui text-fg">
              <input
                type="checkbox"
                checked={enableRecovery}
                disabled={busy}
                onChange={(event) => setEnableRecovery(event.target.checked)}
                className="size-3.5 accent-accent"
              />
              Enable OS keyring recovery
            </label>
            <p className="m-0 text-micro text-fg-subtle">
              Stores a recovery key in the system keyring so you can reset the
              master password. If the keyring is unavailable, creation continues
              without recovery after you acknowledge that risk.
            </p>
            {!enableRecovery && (
              <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-micro text-warning">
                Password-only vault: losing the master password permanently
                loses access to encrypted hosts and identities.
              </div>
            )}
          </div>
        )}

        <Button variant="primary" disabled={busy} className="w-full">
          {busy
            ? "Working…"
            : mode === "create"
              ? "Create vault"
              : mode === "recover"
                ? "Recover and unlock"
                : "Unlock"}
        </Button>

        <div className="flex flex-wrap justify-center gap-4">
          {status.exists && mode !== "unlock" && (
            <ModeLink
              disabled={busy}
              onClick={() => {
                setMode("unlock");
                setError(undefined);
              }}
            >
              Unlock with password
            </ModeLink>
          )}
          {status.exists && status.recoveryAvailable && mode !== "recover" && (
            <ModeLink
              disabled={busy}
              onClick={() => {
                setMode("recover");
                setError(undefined);
              }}
            >
              Recover with keyring
            </ModeLink>
          )}
          {!status.exists && mode !== "create" && (
            <ModeLink disabled={busy} onClick={() => setMode("create")}>
              Create a new vault
            </ModeLink>
          )}
        </div>
      </form>
    </div>
  );
}

function ModeLink({
  disabled,
  onClick,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="cursor-pointer bg-transparent text-micro text-fg-muted transition-colors hover:text-accent disabled:opacity-45"
    >
      {children}
    </button>
  );
}
