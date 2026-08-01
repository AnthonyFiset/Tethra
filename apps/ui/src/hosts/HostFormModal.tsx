import { useRef, useState, type FormEvent, type RefObject } from "react";
import {
  createHost,
  updateHost,
  type HostMutation,
  type HostSummaryDto,
} from "../lib/ipc";
import { HostAvatar } from "../components/HostAvatar";
import { Button } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { ErrorBanner, Field } from "../components/ui/Field";
import { cn } from "../lib/cn";

const SWATCHES = [
  "#4C8DF6",
  "#5AC8A8",
  "#E5C07B",
  "#E5544B",
  "#C678DD",
  "#56B6C2",
  "#98C379",
  "#8B8B8B",
];

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
  const [color, setColor] = useState(initial?.color ?? SWATCHES[0]);
  const [syncSecret, setSyncSecret] = useState(initial?.syncSecret ?? false);
  const [shellIntegration, setShellIntegration] = useState(
    initial?.shellIntegration ?? true,
  );
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
      if (
        !Number.isInteger(parsedPort) ||
        parsedPort < 1 ||
        parsedPort > 65535
      ) {
        throw new Error("Port must be between 1 and 65535.");
      }

      const mutation: HostMutation = {
        label: label.trim(),
        hostname: hostname.trim(),
        port: parsedPort,
        username: username.trim(),
        color,
        syncSecret,
        shellIntegration,
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
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      kicker="Host"
      title={initial ? "Edit host" : "Add host"}
      description="Metadata and the optional password identity are encrypted in the vault. Passwords never linger in React state."
    >
      <form
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-3"
      >
        {error && <ErrorBanner>{error}</ErrorBanner>}

        <div className="flex items-center gap-3 rounded-md border border-line bg-base px-3 py-2.5">
          <HostAvatar label={label || "?"} color={color} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-ui font-medium text-fg">
              {label || "Untitled host"}
            </span>
            <span className="truncate text-micro text-fg-subtle">
              {username || "user"}@{hostname || "hostname"}:{port || "22"}
            </span>
          </span>
        </div>

        <Field
          label="Label"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          disabled={busy}
          required
          autoFocus
        />

        <div className="flex gap-3">
          <Field
            label="Hostname"
            containerClassName="flex-1"
            value={hostname}
            onChange={(event) => setHostname(event.target.value)}
            disabled={busy}
            required
          />
          <Field
            label="Port"
            containerClassName="w-20"
            value={port}
            onChange={(event) => setPort(event.target.value)}
            inputMode="numeric"
            disabled={busy}
            required
          />
        </div>

        <Field
          label="Username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          disabled={busy}
          required
        />

        <div className="flex flex-col gap-1.5">
          <span className="text-micro font-medium text-fg-muted">
            Host color
          </span>
          <div className="flex items-center gap-1.5">
            {SWATCHES.map((swatch) => (
              <button
                key={swatch}
                type="button"
                aria-label={`Use color ${swatch}`}
                aria-pressed={color.toUpperCase() === swatch}
                disabled={busy}
                onClick={() => setColor(swatch)}
                style={{ backgroundColor: swatch }}
                className={cn(
                  "size-6 cursor-pointer rounded-md border-2 transition-transform",
                  color.toUpperCase() === swatch
                    ? "border-fg"
                    : "border-transparent hover:scale-110",
                )}
              />
            ))}
            <input
              type="color"
              aria-label="Custom host color"
              value={color}
              disabled={busy}
              onChange={(event) => setColor(event.target.value.toUpperCase())}
              className="ml-1 size-6 cursor-pointer rounded-md border border-line bg-transparent p-0.5"
            />
          </div>
        </div>

        <Field
          label={
            initial?.hasPassword ? "Password (leave blank to keep)" : "Password"
          }
          inputRef={passwordRef}
          type="password"
          autoComplete="new-password"
          disabled={busy}
          required={!initial}
        />

        <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-line bg-base px-3 py-2.5">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={shellIntegration}
            disabled={busy}
            onChange={(event) => setShellIntegration(event.target.checked)}
          />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-ui font-medium text-fg">
              Shell integration
            </span>
            <span className="text-micro text-fg-subtle">
              Wraps the remote shell to report command blocks and working
              directory. Turn off for exotic shells that reject the wrapper.
            </span>
          </span>
        </label>

        <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-line bg-base px-3 py-2.5">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={syncSecret}
            disabled={busy}
            onChange={(event) => setSyncSecret(event.target.checked)}
          />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-ui font-medium text-fg">
              Sync password to other devices
            </span>
            <span className="text-micro text-fg-subtle">
              Off by default. When on, the encrypted password rides vault sync —
              the sync server still cannot read it. SSH private keys never sync.
            </span>
          </span>
        </label>

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
            {busy ? "Saving…" : initial ? "Save host" : "Create host"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
