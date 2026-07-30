import { useRef, useState, type FormEvent, type RefObject } from "react";
import {
  createHost,
  updateHost,
  type HostMutation,
  type HostSummaryDto,
} from "../lib/ipc";

interface HostFormModalProps {
  initial?: HostSummaryDto;
  onClose: () => void;
  onSaved: (host: HostSummaryDto) => void;
}

function takeValue(ref: RefObject<HTMLInputElement | null>): string {
  const input = ref.current;
  if (!input) return "";
  const value = input.value;
  input.value = "";
  return value;
}

export function HostFormModal({
  initial,
  onClose,
  onSaved,
}: HostFormModalProps): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [label, setLabel] = useState(initial?.label ?? "");
  const [hostname, setHostname] = useState(initial?.hostname ?? "127.0.0.1");
  const [port, setPort] = useState(String(initial?.port ?? 22));
  const [username, setUsername] = useState(initial?.username ?? "");
  const passwordRef = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(undefined);
    setBusy(true);

    const password = takeValue(passwordRef);
    const parsedPort = Number.parseInt(port, 10);

    try {
      if (!label.trim() || !hostname.trim() || !username.trim()) {
        throw new Error("Label, hostname, and username are required.");
      }
      if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
        throw new Error("Port must be between 1 and 65535.");
      }

      const mutation: HostMutation = {
        label: label.trim(),
        hostname: hostname.trim(),
        port: parsedPort,
        username: username.trim(),
      };
      if (password) {
        mutation.password = password;
      } else if (!initial) {
        throw new Error("Password is required for a new host.");
      }

      const saved = initial
        ? await updateHost(initial.id, mutation)
        : await createHost(mutation);
      onSaved(saved);
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
        className="modal host-form"
        role="dialog"
        aria-modal="true"
        onSubmit={(event) => void submit(event)}
      >
        <span className="modal-kicker">Host</span>
        <h2>{initial ? "Edit host" : "Add host"}</h2>
        <p>
          Metadata and optional password identity are encrypted in the vault.
          Passwords never linger in React state.
        </p>
        {error && <div className="error-banner">{error}</div>}

        <label className="field">
          <span>Label</span>
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            disabled={busy}
            required
            autoFocus
          />
        </label>
        <div className="field-row">
          <label className="field">
            <span>Hostname</span>
            <input
              value={hostname}
              onChange={(event) => setHostname(event.target.value)}
              disabled={busy}
              required
            />
          </label>
          <label className="field field--port">
            <span>Port</span>
            <input
              value={port}
              onChange={(event) => setPort(event.target.value)}
              inputMode="numeric"
              disabled={busy}
              required
            />
          </label>
        </div>
        <label className="field">
          <span>Username</span>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            disabled={busy}
            required
          />
        </label>
        <label className="field">
          <span>
            {initial?.hasPassword
              ? "Password (leave blank to keep)"
              : "Password"}
          </span>
          <input
            ref={passwordRef}
            type="password"
            autoComplete="new-password"
            disabled={busy}
            required={!initial}
          />
        </label>

        <div className="modal-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={busy}>
            {busy ? "Saving…" : initial ? "Save host" : "Create host"}
          </button>
        </div>
      </form>
    </div>
  );
}
