import { useState } from "react";
import type { AgentSpecDto } from "../lib/ipc";
import {
  getNotifyDone,
  getNotifyFailed,
  getNotifyWaiting,
  setNotifyDone,
  setNotifyFailed,
  setNotifyWaiting,
} from "../lib/prefs";
import { SurfaceShell } from "./SurfaceShell";

function AgentsCatalog({
  agents,
}: {
  agents: AgentSpecDto[];
}): React.JSX.Element {
  const active = agents.filter((agent) => agent.status !== "deprecated");
  const deprecated = agents.filter((agent) => agent.status === "deprecated");
  const [notifyWaiting, setWaiting] = useState(() => getNotifyWaiting());
  const [notifyDone, setDone] = useState(() => getNotifyDone());
  const [notifyFailed, setFailed] = useState(() => getNotifyFailed());
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-micro text-fg-muted">
        Bundled catalog. Bind an Assist key on a project to inject{" "}
        <code className="font-mono">byokEnv</code> at launch.
      </p>
      <div className="flex flex-col gap-2 rounded-md border border-line bg-base px-3 py-3">
        <span className="text-ui font-medium text-fg">Notifications</span>
        <p className="m-0 text-micro text-fg-muted">
          Desktop alerts when a running agent needs you. Defaults: waiting and
          failed on, done off.
        </p>
        <label className="flex items-center gap-2 text-ui text-fg">
          <input
            type="checkbox"
            checked={notifyWaiting}
            onChange={(event) => {
              setWaiting(event.target.checked);
              setNotifyWaiting(event.target.checked);
            }}
          />
          Notify on waiting
        </label>
        <label className="flex items-center gap-2 text-ui text-fg">
          <input
            type="checkbox"
            checked={notifyFailed}
            onChange={(event) => {
              setFailed(event.target.checked);
              setNotifyFailed(event.target.checked);
            }}
          />
          Notify on failed
        </label>
        <label className="flex items-center gap-2 text-ui text-fg">
          <input
            type="checkbox"
            checked={notifyDone}
            onChange={(event) => {
              setDone(event.target.checked);
              setNotifyDone(event.target.checked);
            }}
          />
          Notify on done
        </label>
      </div>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {active.map((agent) => (
          <li
            key={agent.id}
            className="flex items-center gap-2 rounded-md border border-line bg-base px-3 py-2"
          >
            <span className="min-w-0 flex-1 truncate text-ui text-fg">
              {agent.name}
            </span>
            <span className="shrink-0 font-mono text-micro text-fg-subtle">
              {agent.command || "—"}
            </span>
            {(agent.byokEnv?.length ?? 0) > 0 && (
              <span className="shrink-0 text-micro text-fg-subtle">
                BYOK
              </span>
            )}
          </li>
        ))}
      </ul>
      {deprecated.length > 0 && (
        <div>
          <span className="text-micro font-medium text-fg-subtle">
            Deprecated
          </span>
          <ul className="mt-1 flex list-none flex-col gap-1 p-0">
            {deprecated.map((agent) => (
              <li
                key={agent.id}
                className="rounded-md border border-line px-3 py-2 text-micro text-fg-subtle"
              >
                {agent.name}
                {agent.successor ? ` → ${agent.successor}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="m-0 text-micro text-fg-subtle">
        This list ships with Tethra. Custom agent presets will arrive in a later
        release.
      </p>
    </div>
  );
}

export function AgentsSurface({
  agents,
  onClose,
}: {
  agents: AgentSpecDto[];
  onClose: () => void;
}): React.JSX.Element {
  return (
    <SurfaceShell
      title="Agents"
      description="Bundled agent catalog and notification defaults for running sessions."
      onClose={onClose}
    >
      <AgentsCatalog agents={agents} />
    </SurfaceShell>
  );
}
