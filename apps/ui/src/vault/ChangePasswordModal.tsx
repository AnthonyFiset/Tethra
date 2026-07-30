import { useRef, useState, type FormEvent, type RefObject } from "react";
import { vaultChangePassword } from "../lib/ipc";

interface ChangePasswordModalProps {
  onClose: () => void;
}

function takeValue(ref: RefObject<HTMLInputElement | null>): string {
  const input = ref.current;
  if (!input) return "";
  const value = input.value;
  input.value = "";
  return value;
}

export function ChangePasswordModal({
  onClose,
}: ChangePasswordModalProps): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const currentRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(undefined);
    setBusy(true);

    const currentPassword = takeValue(currentRef);
    const newPassword = takeValue(nextRef);
    const confirm = takeValue(confirmRef);

    try {
      if (newPassword.length < 8) {
        throw new Error("New password must be at least 8 characters.");
      }
      if (newPassword !== confirm) {
        throw new Error("Passwords do not match.");
      }
      await vaultChangePassword(currentPassword, newPassword);
      onClose();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        onSubmit={(event) => void submit(event)}
      >
        <span className="modal-kicker">Vault</span>
        <h2>Change master password</h2>
        <p>
          Rewraps the vault key under a new password. Encrypted host rows are
          not re-encrypted.
        </p>
        {error && <div className="error-banner">{error}</div>}
        <label className="field">
          <span>Current password</span>
          <input
            ref={currentRef}
            type="password"
            autoComplete="current-password"
            disabled={busy}
            required
            autoFocus
          />
        </label>
        <label className="field">
          <span>New password</span>
          <input
            ref={nextRef}
            type="password"
            autoComplete="new-password"
            disabled={busy}
            required
          />
        </label>
        <label className="field">
          <span>Confirm new password</span>
          <input
            ref={confirmRef}
            type="password"
            autoComplete="new-password"
            disabled={busy}
            required
          />
        </label>
        <div className="modal-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={busy}>
            {busy ? "Saving…" : "Change password"}
          </button>
        </div>
      </form>
    </div>
  );
}
