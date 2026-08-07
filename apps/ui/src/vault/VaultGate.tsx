import { useRef, useState, type FormEvent, type RefObject } from "react";
import {
  syncJoinHttp,
  vaultCreate,
  vaultRecover,
  vaultStatus,
  vaultUnlock,
  VAULT_MISMATCH_NEEDS_RESET,
  type VaultStatusDto,
} from "../lib/ipc";
import { Logo } from "../components/Logo";
import { Button } from "../components/ui/Button";
import { ErrorBanner, Field, inputClass } from "../components/ui/Field";

export type VaultMode = "create" | "unlock" | "recover" | "join";

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
  const [notice, setNotice] = useState<string>();
  const [enableRecovery, setEnableRecovery] = useState(true);
  const [joinUrl, setJoinUrl] = useState("");
  const [joinToken, setJoinToken] = useState("");
  const [needsReset, setNeedsReset] = useState(false);

  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  async function join(reset: boolean): Promise<void> {
    setError(undefined);
    setNotice(undefined);
    setBusy(true);
    try {
      const result = await syncJoinHttp(
        joinUrl.trim(),
        joinToken.trim() || undefined,
        reset,
      );
      const next = await vaultStatus();
      if (result.adopted || next.exists) {
        setNeedsReset(false);
        setMode("unlock");
        setNotice(
          "Joined the synced vault. Unlock with the same master password used on your other device.",
        );
      } else {
        setError(
          "Connected, but that server has no vault yet. Sync from your first device, then join again.",
        );
      }
    } catch (reason) {
      if (String(reason).includes(VAULT_MISMATCH_NEEDS_RESET)) {
        setNeedsReset(true);
      } else {
        setError(String(reason));
      }
    } finally {
      setBusy(false);
    }
  }

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
        : mode === "join"
          ? "Join a synced vault"
          : "Unlock vault";

  const subtitle =
    mode === "create"
      ? "Hosts and passwords are encrypted on disk with Argon2id and XChaCha20-Poly1305."
      : mode === "recover"
        ? "Use the OS keyring recovery key to set a new master password. Existing encrypted items stay intact."
        : mode === "join"
          ? "Point this device at your sync server to adopt the existing vault. Create a vault instead and its key will not match the synced hosts."
          : "Enter your master password to decrypt hosts and identities.";

  return (
    <div
      data-tauri-drag-region="deep"
      className="grid size-full place-items-center bg-base p-6"
    >
      <form
        onSubmit={(event) => {
          if (mode !== "join") {
            void submit(event);
            return;
          }
          event.preventDefault();
          void join(false);
        }}
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
        {notice && (
          <div className="rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-micro text-accent">
            {notice}
          </div>
        )}

        {mode === "join" ? (
          <>
            <Field
              label="Sync server URL"
              value={joinUrl}
              onChange={(event) => setJoinUrl(event.target.value)}
              placeholder="http://sync.example:8787"
              autoFocus
              disabled={busy}
              required
              hint="Include http:// and the port."
            />
            <label className="flex flex-col gap-1.5">
              <span className="text-micro font-medium text-fg-muted">
                Token
              </span>
              <input
                type="password"
                value={joinToken}
                onChange={(event) => setJoinToken(event.target.value)}
                disabled={busy}
                className={inputClass}
                placeholder="Same token as the sync server"
              />
            </label>

            {needsReset && (
              <div className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
                <p className="m-0 text-micro text-warning">
                  This device already has its own vault, and its key cannot
                  decrypt the synced hosts. Joining replaces it with the synced
                  vault. Passwords saved only on this device will be lost; hosts
                  come back from the server.
                </p>
                <Button
                  type="button"
                  variant="danger"
                  disabled={busy}
                  onClick={() => void join(true)}
                >
                  Replace this device&rsquo;s vault and join
                </Button>
              </div>
            )}
          </>
        ) : (
          <>
            <Field
              label={
                mode === "recover" ? "New master password" : "Master password"
              }
              inputRef={passwordRef}
              type="password"
              name="vault-password"
              autoComplete={
                mode === "unlock" ? "current-password" : "new-password"
              }
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
          </>
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
                : mode === "join"
                  ? "Join synced vault"
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
            <ModeLink
              disabled={busy}
              onClick={() => {
                setMode("create");
                setError(undefined);
              }}
            >
              Create a new vault
            </ModeLink>
          )}
          {mode !== "join" && (
            <ModeLink
              disabled={busy}
              onClick={() => {
                setMode("join");
                setError(undefined);
              }}
            >
              Join a synced vault
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
