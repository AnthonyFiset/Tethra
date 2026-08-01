import { useRef, useState, type FormEvent, type RefObject } from "react";
import { vaultChangePassword } from "../lib/ipc";
import { Button } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { ErrorBanner, Field } from "../components/ui/Field";

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
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      kicker="Vault"
      title="Change master password"
      description="Rewraps the vault key under a new password. Encrypted host rows are not re-encrypted. Other devices adopt the new wrap on their next sync — then unlock with this password."
    >
      <form
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-3"
      >
        {error && <ErrorBanner>{error}</ErrorBanner>}
        <Field
          label="Current password"
          inputRef={currentRef}
          type="password"
          autoComplete="current-password"
          disabled={busy}
          required
          autoFocus
        />
        <Field
          label="New password"
          inputRef={nextRef}
          type="password"
          autoComplete="new-password"
          disabled={busy}
          required
        />
        <Field
          label="Confirm new password"
          inputRef={confirmRef}
          type="password"
          autoComplete="new-password"
          disabled={busy}
          required
        />
        <div className="mt-2 flex justify-end gap-2">
          <Button
            type="button"
            variant="subtle"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button variant="primary" disabled={busy}>
            {busy ? "Saving…" : "Change password"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
