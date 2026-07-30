import { useRef, useState, type FormEvent, type RefObject } from "react";
import {
  vaultCreate,
  vaultRecover,
  vaultUnlock,
  type VaultStatusDto,
} from "../lib/ipc";

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
    <div className="vault-gate">
      <form className="vault-card" onSubmit={(event) => void submit(event)}>
        <span className="modal-kicker">Encrypted vault</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>

        {error && <div className="error-banner">{error}</div>}

        <label className="field">
          <span>
            {mode === "recover" ? "New master password" : "Master password"}
          </span>
          <input
            ref={passwordRef}
            type="password"
            name="vault-password"
            autoComplete={mode === "unlock" ? "current-password" : "new-password"}
            autoFocus
            disabled={busy}
            required
          />
        </label>

        {(mode === "create" || mode === "recover") && (
          <label className="field">
            <span>Confirm password</span>
            <input
              ref={confirmRef}
              type="password"
              name="vault-password-confirm"
              autoComplete="new-password"
              disabled={busy}
              required
            />
          </label>
        )}

        {mode === "create" && (
          <>
            <label className="check-field">
              <input
                type="checkbox"
                checked={enableRecovery}
                disabled={busy}
                onChange={(event) => setEnableRecovery(event.target.checked)}
              />
              <span>Enable OS keyring recovery</span>
            </label>
            <p className="field-hint">
              Stores a recovery key in the system keyring so you can reset the
              master password. If the keyring is unavailable, creation continues
              without recovery after you acknowledge that risk.
            </p>
            {!enableRecovery && (
              <div className="warn-banner">
                Password-only vault: losing the master password permanently loses
                access to encrypted hosts and identities.
              </div>
            )}
          </>
        )}

        <button className="primary-button vault-submit" disabled={busy}>
          {busy
            ? "Working…"
            : mode === "create"
              ? "Create vault"
              : mode === "recover"
                ? "Recover and unlock"
                : "Unlock"}
        </button>

        <div className="vault-links">
          {status.exists && mode !== "unlock" && (
            <button
              type="button"
              className="link-button"
              disabled={busy}
              onClick={() => {
                setMode("unlock");
                setError(undefined);
              }}
            >
              Unlock with password
            </button>
          )}
          {status.exists && status.recoveryAvailable && mode !== "recover" && (
            <button
              type="button"
              className="link-button"
              disabled={busy}
              onClick={() => {
                setMode("recover");
                setError(undefined);
              }}
            >
              Recover with keyring
            </button>
          )}
          {!status.exists && mode !== "create" && (
            <button
              type="button"
              className="link-button"
              disabled={busy}
              onClick={() => setMode("create")}
            >
              Create a new vault
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
