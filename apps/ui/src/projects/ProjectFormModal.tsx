import { useEffect, useState, type FormEvent } from "react";
import { FolderOpen } from "lucide-react";
import {
  createProject,
  listAgents,
  syncPickFolder,
  updateProject,
  type AgentSpecDto,
  type HostSummaryDto,
  type ProjectMutation,
  type ProjectSummaryDto,
} from "../lib/ipc";
import { Button, IconButton } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { ErrorBanner, Field, inputClass } from "../components/ui/Field";
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
  const [browsing, setBrowsing] = useState(false);

  useEffect(() => {
    void listAgents()
      .then(setAgents)
      .catch((reason) => setError(String(reason)));
  }, []);

  useEffect(() => {
    setBrowsing(false);
  }, [kind, hostId]);

  async function pickLocalNative(): Promise<void> {
    setError(undefined);
    try {
      const picked = await syncPickFolder();
      if (picked) setPath(picked);
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

      const mutation: ProjectMutation = {
        name: name.trim(),
        location:
          kind === "local"
            ? { kind: "local", path: path.trim() }
            : { kind: "remote", hostId, path: path.trim() },
        defaultAgent: defaultAgent || undefined,
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
            onSelect={(selected) => {
              setPath(selected);
              setBrowsing(false);
            }}
            onCancel={() => setBrowsing(false)}
          />
        )}

        {!browsing && (
          <label className="flex flex-col gap-1.5">
            <span className="text-micro font-medium text-fg-muted">
              Default agent
            </span>
            <select
              value={defaultAgent}
              onChange={(event) => setDefaultAgent(event.target.value)}
              disabled={busy}
              className={inputClass}
            >
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                  {agent.persistent ? " · persists (tmux)" : " (no persistence)"}
                </option>
              ))}
            </select>
          </label>
        )}
      </form>
    </Dialog>
  );
}
