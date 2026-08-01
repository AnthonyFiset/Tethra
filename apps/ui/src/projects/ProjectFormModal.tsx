import { useEffect, useMemo, useState, type FormEvent } from "react";
import { FolderOpen } from "lucide-react";
import {
  createProject,
  listAgents,
  probeHostTools,
  syncPickFolder,
  updateProject,
  type AgentSpecDto,
  type HostSummaryDto,
  type ProjectMutation,
  type ProjectSummaryDto,
  type ToolsProbeDto,
} from "../lib/ipc";
import { Button, IconButton } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { ErrorBanner, Field, inputClass } from "../components/ui/Field";
import { installCommandFor, resolveAgentForLaunch } from "./agents";
import { PathBrowser } from "./PathBrowser";

interface ProjectFormModalProps {
  initial?: ProjectSummaryDto;
  hosts: HostSummaryDto[];
  onClose: () => void;
  onSaved: (project: ProjectSummaryDto) => void;
}

export function ProjectFormModal({
  initial,
  hosts,
  onClose,
  onSaved,
}: ProjectFormModalProps): React.JSX.Element {
  const initialKind =
    initial?.location.kind === "remote" ? "remote" : "local";
  const initialHostId =
    initial?.location.kind === "remote" ? initial.location.hostId : "";
  const initialPath = initial?.location.path ?? "";

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [name, setName] = useState(initial?.name ?? "");
  const [kind, setKind] = useState<"local" | "remote">(initialKind);
  const [hostId, setHostId] = useState(initialHostId || hosts[0]?.id || "");
  const [path, setPath] = useState(initialPath);
  const [defaultAgent, setDefaultAgent] = useState(
    initial?.defaultAgent ?? "claude-code",
  );
  const [agents, setAgents] = useState<AgentSpecDto[]>([]);
  const [probe, setProbe] = useState<ToolsProbeDto>();
  const [probing, setProbing] = useState(false);
  const [copiedInstall, setCopiedInstall] = useState(false);
  const [browsing, setBrowsing] = useState(false);

  useEffect(() => {
    void listAgents()
      .then((next) => {
        setAgents(next);
        setDefaultAgent((current) => {
          const resolved = resolveAgentForLaunch(next, current).agent;
          if (resolved) return resolved.id;
          return next.find((agent) => agent.id === "claude-code")?.id ?? "shell";
        });
      })
      .catch((reason) => setError(String(reason)));
  }, []);

  useEffect(() => {
    setBrowsing(false);
  }, [kind, hostId]);

  const probeCommands = useMemo(
    () =>
      agents
        .map((agent) => agent.command.trim())
        .filter((command) => command.length > 0),
    [agents],
  );

  useEffect(() => {
    if (probeCommands.length === 0) return;
    if (kind === "remote" && !hostId) {
      setProbe(undefined);
      setProbing(false);
      return;
    }
    let cancelled = false;
    setProbing(true);
    setProbe(undefined);
    void probeHostTools(kind === "remote" ? hostId : undefined, probeCommands)
      .then((result) => {
        if (!cancelled) setProbe(result);
      })
      .catch((reason) => {
        if (!cancelled) {
          setProbe(undefined);
          setError(String(reason));
        }
      })
      .finally(() => {
        if (!cancelled) setProbing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, hostId, probeCommands]);

  const missingCommands = useMemo(() => {
    const set = new Set(probe?.missing.map((tool) => tool.id) ?? []);
    return set;
  }, [probe]);
  const probeReady = Boolean(probe) && !probing;

  const selected = agents.find((agent) => agent.id === defaultAgent);
  const selectedMissing =
    probeReady &&
    Boolean(selected?.command.trim()) &&
    missingCommands.has(selected?.command ?? "");
  const selectedInstall = selected
    ? installCommandFor(selected, probe?.platform)
    : undefined;

  async function pickLocalNative(): Promise<void> {
    setError(undefined);
    try {
      const picked = await syncPickFolder();
      if (picked) setPath(picked);
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function copyInstall(): Promise<void> {
    if (!selectedInstall) return;
    try {
      await navigator.clipboard.writeText(selectedInstall);
      setCopiedInstall(true);
      window.setTimeout(() => setCopiedInstall(false), 1500);
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(undefined);
    setBusy(true);

    try {
      if (!name.trim()) {
        throw new Error("Name is required.");
      }
      if (!path.trim()) {
        throw new Error("Path is required.");
      }
      if (kind === "remote" && !hostId) {
        throw new Error("Choose a host for a remote project.");
      }

      let agentId = defaultAgent || undefined;
      const picked = agents.find((agent) => agent.id === agentId);
      if (picked?.status === "deprecated" && picked.successor) {
        agentId = picked.successor;
      }

      const mutation: ProjectMutation = {
        name: name.trim(),
        location:
          kind === "local"
            ? { kind: "local", path: path.trim() }
            : { kind: "remote", hostId, path: path.trim() },
        defaultAgent: agentId,
      };

      const saved = initial
        ? await updateProject(initial.id, mutation)
        : await createProject(mutation);
      onSaved(saved);
      onClose();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  const canBrowseRemote = kind === "remote" && Boolean(hostId);
  const canBrowseLocal = kind === "local";
  const activeAgents = agents.filter((agent) => agent.status !== "deprecated");
  const deprecatedAgents = agents.filter(
    (agent) => agent.status === "deprecated",
  );

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      kicker="Project"
      title={initial ? "Edit project" : "New project"}
      description="Projects sync through the vault. Open one to connect, cd, and launch an agent."
      width={browsing ? "lg" : "md"}
      footer={
        browsing ? undefined : (
          <>
            <Button variant="subtle" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="project-form"
              disabled={busy}
            >
              {busy ? "Saving…" : initial ? "Save" : "Create"}
            </Button>
          </>
        )
      }
    >
      <form
        id="project-form"
        className="flex flex-col gap-3"
        onSubmit={(event) => void submit(event)}
      >
        {error && <ErrorBanner>{error}</ErrorBanner>}

        {!browsing && (
          <>
            <Field
              label="Name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="tethra"
              disabled={busy}
              required
              autoFocus
            />

            <fieldset className="flex flex-col gap-2">
              <legend className="text-micro font-medium text-fg-muted">
                Location
              </legend>
              <div className="flex gap-3">
                <label className="flex items-center gap-2 text-ui text-fg">
                  <input
                    type="radio"
                    name="kind"
                    checked={kind === "local"}
                    onChange={() => setKind("local")}
                    disabled={busy}
                  />
                  Local
                </label>
                <label className="flex items-center gap-2 text-ui text-fg">
                  <input
                    type="radio"
                    name="kind"
                    checked={kind === "remote"}
                    onChange={() => setKind("remote")}
                    disabled={busy}
                  />
                  Remote
                </label>
              </div>
            </fieldset>

            {kind === "remote" && (
              <label className="flex flex-col gap-1.5">
                <span className="text-micro font-medium text-fg-muted">
                  Host
                </span>
                <select
                  value={hostId}
                  onChange={(event) => setHostId(event.target.value)}
                  disabled={busy || hosts.length === 0}
                  className={inputClass}
                >
                  {hosts.length === 0 && (
                    <option value="">No hosts saved</option>
                  )}
                  {hosts.map((host) => (
                    <option key={host.id} value={host.id}>
                      {host.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="text-micro font-medium text-fg-muted">
            {kind === "local" ? "Local path" : "Remote path"}
          </span>
          {!browsing && (
            <div className="flex gap-2">
              <input
                value={path}
                onChange={(event) => setPath(event.target.value)}
                placeholder={kind === "local" ? "~/src/tethra" : "/srv/tethra"}
                disabled={busy}
                required
                className={inputClass}
              />
              {canBrowseLocal && (
                <IconButton
                  label="Choose folder"
                  onClick={() => void pickLocalNative()}
                  disabled={busy}
                >
                  <FolderOpen size={15} />
                </IconButton>
              )}
              {canBrowseRemote && (
                <IconButton
                  label="Browse remote folders"
                  onClick={() => {
                    setError(undefined);
                    setBrowsing(true);
                  }}
                  disabled={busy}
                >
                  <FolderOpen size={15} />
                </IconButton>
              )}
            </div>
          )}
          {canBrowseLocal && !browsing && (
            <button
              type="button"
              className="self-start text-micro text-accent hover:underline"
              onClick={() => {
                setError(undefined);
                setBrowsing(true);
              }}
              disabled={busy}
            >
              Or browse folders…
            </button>
          )}
        </div>

        {browsing && (
          <PathBrowser
            mode={
              kind === "local"
                ? { kind: "local" }
                : { kind: "remote", hostId }
            }
            initialPath={path}
            onSelect={(selectedPath) => {
              setPath(selectedPath);
              setBrowsing(false);
            }}
            onCancel={() => setBrowsing(false)}
          />
        )}

        {!browsing && (
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-micro font-medium text-fg-muted">
                Default agent
              </span>
              <span className="text-micro text-fg-subtle">
                {probing
                  ? "Checking host…"
                  : probe
                    ? `Detected on ${probe.platform}`
                    : kind === "remote" && !hostId
                      ? "Pick a host to detect agents"
                      : ""}
              </span>
            </div>

            <div className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border border-line bg-base p-1">
              {activeAgents.map((agent) => {
                const missing =
                  probeReady &&
                  Boolean(agent.command.trim()) &&
                  missingCommands.has(agent.command);
                const unknown =
                  Boolean(agent.command.trim()) && !probeReady;
                const selectedRow = defaultAgent === agent.id;
                return (
                  <button
                    key={agent.id}
                    type="button"
                    disabled={busy}
                    onClick={() => setDefaultAgent(agent.id)}
                    className={
                      selectedRow
                        ? "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-ui text-fg bg-hover"
                        : "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-ui text-fg-muted hover:bg-hover/60"
                    }
                  >
                    <span
                      className={
                        unknown
                          ? "size-2 shrink-0 rounded-full bg-fg-subtle/30"
                          : missing
                            ? "size-2 shrink-0 rounded-full bg-fg-subtle/40"
                            : "size-2 shrink-0 rounded-full bg-success"
                      }
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                    <span className="shrink-0 text-micro text-fg-subtle">
                      {agent.command
                        ? unknown
                          ? "…"
                          : missing
                            ? "Available"
                            : "Installed"
                        : "No CLI"}
                      {agent.persistent ? " · tmux" : ""}
                    </span>
                  </button>
                );
              })}
              {deprecatedAgents.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (agent.successor) setDefaultAgent(agent.successor);
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-ui text-fg-subtle"
                >
                  <span className="size-2 shrink-0 rounded-full bg-fg-subtle/30" />
                  <span className="min-w-0 flex-1 truncate line-through">
                    {agent.name}
                  </span>
                  <span className="shrink-0 text-micro text-accent">
                    use{" "}
                    {agents.find((entry) => entry.id === agent.successor)
                      ?.name ?? agent.successor}
                  </span>
                </button>
              ))}
            </div>

            {selected?.docsUrl && (
              <a
                href={selected.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="text-micro text-accent underline-offset-2 hover:underline"
              >
                Docs for {selected.name}
              </a>
            )}

            {selectedMissing && selectedInstall && (
              <div className="flex flex-col gap-1.5 rounded-md border border-line bg-elevated px-2.5 py-2">
                <span className="text-micro text-fg-muted">
                  Not on PATH yet. Copy the install command, run it on the host,
                  then reopen.
                </span>
                <code className="block overflow-x-auto rounded bg-base px-2 py-1 text-micro text-fg">
                  {selectedInstall}
                </code>
                <Button
                  type="button"
                  variant="subtle"
                  disabled={busy}
                  onClick={() => void copyInstall()}
                >
                  {copiedInstall ? "Copied" : "Copy install command"}
                </Button>
              </div>
            )}
          </div>
        )}
      </form>
    </Dialog>
  );
}
