import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import {
  createHost,
  identityImport,
  identityPickKeyFile,
  identityProbe,
  listIdentities,
  updateHost,
  type HostMutation,
  type HostSummaryDto,
  type IdentitySummaryDto,
  type TunnelDefinitionDto,
} from "../lib/ipc";
import { HostAvatar } from "../components/HostAvatar";
import { Button } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { ErrorBanner, Field, inputClass } from "../components/ui/Field";
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

type AuthMode = "password" | "sshKey" | "none";

interface HostFormModalProps {
  initial?: HostSummaryDto;
  /** Prefill when adding a host from Quick connect (not yet saved). */
  draft?: {
    label: string;
    hostname: string;
    port: number;
    username: string;
  };
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
  draft,
  onClose,
  onSaved,
}: HostFormModalProps): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [label, setLabel] = useState(initial?.label ?? draft?.label ?? "");
  const [hostname, setHostname] = useState(
    initial?.hostname ?? draft?.hostname ?? "127.0.0.1",
  );
  const [port, setPort] = useState(
    String(initial?.port ?? draft?.port ?? 22),
  );
  const [username, setUsername] = useState(
    initial?.username ?? draft?.username ?? "",
  );
  const [color, setColor] = useState(initial?.color ?? SWATCHES[0]);
  const [syncSecret, setSyncSecret] = useState(initial?.syncSecret ?? false);
  const [shellIntegration, setShellIntegration] = useState(
    initial?.shellIntegration ?? true,
  );
  const [forwardAgent, setForwardAgent] = useState(
    initial?.forwardAgent ?? false,
  );
  const [tunnels, setTunnels] = useState<TunnelDefinitionDto[]>(
    () => initial?.tunnels ?? [],
  );
  const [authMode, setAuthMode] = useState<AuthMode>(
    initial?.authKind === "sshKey"
      ? "sshKey"
      : initial?.useDefaultKeys && !initial?.identityId
        ? "none"
        : "password",
  );
  const [identities, setIdentities] = useState<IdentitySummaryDto[]>([]);
  const [identityId, setIdentityId] = useState(initial?.identityId ?? "");
  const [importPath, setImportPath] = useState<string>();
  const [importEncrypted, setImportEncrypted] = useState(false);
  const [importFingerprint, setImportFingerprint] = useState<string>();
  const [rememberPassphrase, setRememberPassphrase] = useState(false);
  const [importSyncSecret, setImportSyncSecret] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const keyPassphraseRef = useRef<HTMLInputElement>(null);

  const sshKeys = identities.filter((identity) => identity.kind === "sshKey");

  useEffect(() => {
    void listIdentities()
      .then(setIdentities)
      .catch((reason: unknown) => setError(String(reason)));
  }, []);

  async function importKey(): Promise<void> {
    setError(undefined);
    setBusy(true);
    try {
      const path = await identityPickKeyFile();
      if (!path) return;
      const probe = await identityProbe(path);
      setImportPath(path);
      setImportEncrypted(probe.encrypted);
      setImportFingerprint(probe.fingerprint ?? undefined);
      if (keyPassphraseRef.current) keyPassphraseRef.current.value = "";
      setRememberPassphrase(false);
      setImportSyncSecret(false);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport(): Promise<void> {
    if (!importPath) return;
    setError(undefined);
    setBusy(true);
    try {
      const passphrase = importEncrypted ? takeValue(keyPassphraseRef) : undefined;
      const imported = await identityImport({
        path: importPath,
        passphrase: passphrase || undefined,
        rememberPassphrase: importEncrypted ? rememberPassphrase : false,
        syncSecret: importSyncSecret,
      });
      setIdentities(await listIdentities());
      setIdentityId(imported.id);
      setImportPath(undefined);
      setImportEncrypted(false);
      setImportFingerprint(undefined);
      setRememberPassphrase(false);
      setImportSyncSecret(false);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

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
        syncSecret: authMode === "password" ? syncSecret : false,
        shellIntegration,
        forwardAgent,
        tunnels,
        useDefaultKeys: authMode === "none",
      };

      if (authMode === "sshKey") {
        if (!identityId) {
          throw new Error("Select or import an SSH key.");
        }
        mutation.identityId = identityId;
      } else if (authMode === "none") {
        // Server already trusts this machine — nothing stored, nothing sent.
      } else if (password) {
        mutation.password = password;
      } else if (!initial) {
        throw new Error("Password is required for a new host.");
      } else if (initial.authKind === "sshKey") {
        throw new Error("Enter a password to switch this host to password auth.");
      } else if (!initial.hasPassword) {
        throw new Error(
          "This device has no password for the host. Enter one to connect (and enable Sync password if you want other devices to receive it).",
        );
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

  const needsPassword =
    authMode === "password" && (!initial || !initial.hasPassword);

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      kicker="Host"
      title={initial ? "Edit host" : "Add host"}
      description="Metadata and auth identities are encrypted in the vault. Secrets never linger in React state."
      header={
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
      }
      footer={
        <>
          <Button
            type="button"
            variant="subtle"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button type="submit" form="host-form" variant="primary" disabled={busy}>
            {busy ? "Saving…" : initial ? "Save host" : "Create host"}
          </Button>
        </>
      }
    >
      <form
        id="host-form"
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-3"
      >
        {error && <ErrorBanner>{error}</ErrorBanner>}
        {authMode === "password" && initial && !initial.hasPassword && (
          <ErrorBanner>
            Password isn’t stored on this device yet (vault syncs hosts, not
            passwords, unless Sync password is on). Enter it below to connect
            from here.
          </ErrorBanner>
        )}
        {authMode === "sshKey" &&
          initial &&
          initial.identityId &&
          !sshKeys.some((key) => key.id === initial.identityId) && (
            <ErrorBanner>
              This device has no SSH key for this host. Import the key below to
              connect (or turn on “Sync this key” on another device so it
              arrives automatically).
            </ErrorBanner>
          )}

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

        <div className="flex flex-col gap-1.5">
          <span className="text-micro font-medium text-fg-muted">
            Authentication
          </span>
          <div className="flex gap-1 rounded-md border border-line bg-base p-1">
            {(
              [
                ["password", "Password"],
                ["sshKey", "SSH key"],
                ["none", "None"],
              ] as const
            ).map(([mode, title]) => (
              <button
                key={mode}
                type="button"
                disabled={busy}
                aria-pressed={authMode === mode}
                onClick={() => setAuthMode(mode)}
                className={cn(
                  "flex-1 cursor-pointer rounded px-2 py-1.5 text-ui transition-colors",
                  authMode === mode
                    ? "bg-hover font-medium text-fg"
                    : "text-fg-muted hover:text-fg",
                )}
              >
                {title}
              </button>
            ))}
          </div>
        </div>

        {authMode === "none" && (
          <p className="m-0 rounded-md border border-line bg-surface px-3 py-2.5 text-micro text-fg-muted">
            Connects with your local SSH keys (
            <code className="font-mono">~/.ssh/id_ed25519</code>,{" "}
            <code className="font-mono">id_ecdsa</code>,{" "}
            <code className="font-mono">id_rsa</code>) — for servers that
            already trust this machine. Nothing is stored in the vault.
            Passphrase-protected keys aren't tried; import those as an SSH key
            identity instead.
          </p>
        )}

        {authMode === "password" ? (
          <>
            <Field
              label={
                initial?.hasPassword
                  ? "Password (leave blank to keep)"
                  : "Password"
              }
              inputRef={passwordRef}
              type="password"
              autoComplete="new-password"
              disabled={busy}
              required={needsPassword}
            />

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
                  Off by default. When on, the encrypted password rides vault
                  sync — the sync server still cannot read it. SSH keys sync
                  only if you turn it on per key.
                </span>
              </span>
            </label>
          </>
        ) : authMode === "sshKey" ? (
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-micro font-medium text-fg-muted">
                SSH key identity
              </span>
              <div className="flex gap-2">
                <select
                  className={cn(inputClass, "flex-1")}
                  value={identityId}
                  disabled={busy}
                  required
                  onChange={(event) => setIdentityId(event.target.value)}
                >
                  <option value="">Select a key…</option>
                  {sshKeys.map((identity) => (
                    <option key={identity.id} value={identity.id}>
                      {identity.label}
                      {identity.fingerprint
                        ? ` · ${identity.fingerprint.slice(0, 18)}…`
                        : ""}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="subtle"
                  disabled={busy}
                  onClick={() => void importKey()}
                >
                  Import key…
                </Button>
              </div>
            </label>

            {importPath && (
              <div className="flex flex-col gap-2 rounded-md border border-line bg-base px-3 py-2.5">
                <p className="m-0 text-micro text-fg-muted">
                  Importing{" "}
                  <span className="font-mono text-fg">{importPath}</span>
                  {importFingerprint ? ` · ${importFingerprint}` : ""}
                </p>
                {importEncrypted && (
                  <>
                    <Field
                      label="Passphrase"
                      inputRef={keyPassphraseRef}
                      type="password"
                      autoComplete="off"
                      disabled={busy}
                      required
                    />
                    <label className="flex cursor-pointer items-center gap-2 text-micro text-fg-muted">
                      <input
                        type="checkbox"
                        checked={rememberPassphrase}
                        disabled={busy}
                        onChange={(event) =>
                          setRememberPassphrase(event.target.checked)
                        }
                      />
                      Remember passphrase in vault
                    </label>
                  </>
                )}
                <label className="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={importSyncSecret}
                    disabled={busy}
                    onChange={(event) =>
                      setImportSyncSecret(event.target.checked)
                    }
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-ui font-medium text-fg">
                      Sync this key to other devices
                    </span>
                    <span className="text-micro text-fg-subtle">
                      Off by default. When on, the encrypted key rides vault
                      sync — the sync server still cannot read it.
                    </span>
                  </span>
                </label>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="subtle"
                    disabled={busy}
                    onClick={() => {
                      setImportPath(undefined);
                      setImportEncrypted(false);
                      setImportFingerprint(undefined);
                      setImportSyncSecret(false);
                      if (keyPassphraseRef.current) {
                        keyPassphraseRef.current.value = "";
                      }
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    disabled={busy}
                    onClick={() => void confirmImport()}
                  >
                    Import
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : null}

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
            checked={forwardAgent}
            disabled={busy}
            onChange={(event) => setForwardAgent(event.target.checked)}
          />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-ui font-medium text-fg">
              Forward SSH agent
            </span>
            <span className="text-micro text-fg-subtle">
              Lets remote tools use keys loaded in your local agent (ssh -A).
              Off by default.
            </span>
            {forwardAgent && (
              <span className="text-micro text-warning">
                A root user on the remote host can use your forwarded agent
                while you&apos;re connected.
              </span>
            )}
          </span>
        </label>

        <div className="flex flex-col gap-2 rounded-md border border-line bg-base px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-ui font-medium text-fg">Tunnels</div>
              <p className="text-micro text-fg-subtle">
                Local (-L) and remote (-R) port forwards. Start them from a
                connected session; mark Auto-start to open on connect.
              </p>
            </div>
            <Button
              type="button"
              variant="subtle"
              disabled={busy}
              onClick={() => {
                const id = crypto.randomUUID();
                setTunnels((current) => [
                  ...current,
                  {
                    id,
                    label: "",
                    direction: "local",
                    bindPort: 8000,
                    targetHost: "localhost",
                    targetPort: 8000,
                    autoStart: false,
                    allowLan: false,
                  },
                ]);
              }}
            >
              Add
            </Button>
          </div>
          {tunnels.length === 0 ? (
            <p className="text-micro text-fg-subtle">No tunnels yet.</p>
          ) : (
            tunnels.map((tunnel, index) => (
              <div
                key={tunnel.id}
                className="flex flex-col gap-2 rounded border border-line bg-elevated/40 px-2.5 py-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className={cn(inputClass, "w-auto")}
                    value={tunnel.direction}
                    disabled={busy}
                    onChange={(event) => {
                      const direction = event.target.value;
                      setTunnels((current) =>
                        current.map((entry, i) =>
                          i === index ? { ...entry, direction } : entry,
                        ),
                      );
                    }}
                  >
                    <option value="local">Local (-L)</option>
                    <option value="remote">Remote (-R)</option>
                  </select>
                  <input
                    className={cn(inputClass, "min-w-[8rem] flex-1")}
                    placeholder="Label"
                    value={tunnel.label}
                    disabled={busy}
                    onChange={(event) => {
                      const labelValue = event.target.value;
                      setTunnels((current) =>
                        current.map((entry, i) =>
                          i === index ? { ...entry, label: labelValue } : entry,
                        ),
                      );
                    }}
                  />
                  <Button
                    type="button"
                    variant="subtle"
                    disabled={busy}
                    onClick={() =>
                      setTunnels((current) =>
                        current.filter((_, i) => i !== index),
                      )
                    }
                  >
                    Remove
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-micro text-fg-muted">
                  <span>Bind</span>
                  <input
                    className={cn(inputClass, "w-20")}
                    inputMode="numeric"
                    value={String(tunnel.bindPort)}
                    disabled={busy}
                    onChange={(event) => {
                      const bindPort = Number.parseInt(event.target.value, 10) || 0;
                      setTunnels((current) =>
                        current.map((entry, i) => {
                          if (i !== index) return entry;
                          const next = { ...entry, bindPort };
                          if (
                            !entry.label.trim() &&
                            entry.targetPort === entry.bindPort
                          ) {
                            next.targetPort = bindPort || entry.targetPort;
                          }
                          return next;
                        }),
                      );
                    }}
                  />
                  <span>→</span>
                  <input
                    className={cn(inputClass, "min-w-[7rem] flex-1")}
                    placeholder="localhost"
                    value={tunnel.targetHost}
                    disabled={busy}
                    onChange={(event) => {
                      const targetHost = event.target.value;
                      setTunnels((current) =>
                        current.map((entry, i) =>
                          i === index ? { ...entry, targetHost } : entry,
                        ),
                      );
                    }}
                  />
                  <input
                    className={cn(inputClass, "w-20")}
                    inputMode="numeric"
                    value={String(tunnel.targetPort)}
                    disabled={busy}
                    onChange={(event) => {
                      const targetPort =
                        Number.parseInt(event.target.value, 10) || 0;
                      setTunnels((current) =>
                        current.map((entry, i) =>
                          i === index ? { ...entry, targetPort } : entry,
                        ),
                      );
                    }}
                  />
                </div>
                <div className="flex flex-wrap gap-4">
                  <label className="flex cursor-pointer items-center gap-2 text-micro text-fg-muted">
                    <input
                      type="checkbox"
                      checked={tunnel.autoStart}
                      disabled={busy}
                      onChange={(event) => {
                        const autoStart = event.target.checked;
                        setTunnels((current) =>
                          current.map((entry, i) =>
                            i === index ? { ...entry, autoStart } : entry,
                          ),
                        );
                      }}
                    />
                    Auto-start on connect
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-micro text-fg-muted">
                    <input
                      type="checkbox"
                      checked={tunnel.allowLan}
                      disabled={busy}
                      onChange={(event) => {
                        const allowLan = event.target.checked;
                        setTunnels((current) =>
                          current.map((entry, i) =>
                            i === index ? { ...entry, allowLan } : entry,
                          ),
                        );
                      }}
                    />
                    Allow other devices (0.0.0.0)
                  </label>
                </div>
                {tunnel.allowLan && (
                  <p className="text-micro text-warning">
                    Binding on all interfaces exposes this port on your LAN.
                    Prefer 127.0.0.1 unless you need it.
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </form>
    </Dialog>
  );
}
