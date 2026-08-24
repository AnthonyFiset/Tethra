import * as RadixDialog from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import {
  AppWindow,
  Columns2,
  DownloadCloud,
  FolderKanban,
  FolderOpen,
  LayoutGrid,
  Lock,
  Maximize2,
  PanelsTopLeft,
  Plus,
  Radio,
  RefreshCw,
  Rows2,
  Settings,
  Sparkles,
  TerminalSquare,
} from "lucide-react";
import type { ReactNode } from "react";
import type {
  HostSummaryDto,
  ProjectSummaryDto,
  RunningSessionSummaryDto,
} from "../lib/ipc";
import {
  SETTINGS_PALETTE_ENTRIES,
  type SettingsSectionId,
} from "./SettingsModal";
import { SURFACE_LABELS, type SurfaceId } from "../surfaces/SurfaceShell";
import { HostAvatar } from "./HostAvatar";

interface CommandPaletteProps {
  open: boolean;
  hosts: HostSummaryDto[];
  projects: ProjectSummaryDto[];
  runningSessions: RunningSessionSummaryDto[];
  canSplit: boolean;
  zoomed: boolean;
  inWorkspace: boolean;
  hasWorkspaceTabs: boolean;
  onOpenChange: (open: boolean) => void;
  onConnect: (host: HostSummaryDto) => void;
  onFiles: (host: HostSummaryDto) => void;
  onOpenProject: (project: ProjectSummaryDto) => void;
  onReattach: (session: RunningSessionSummaryDto) => void;
  onLocal: () => void;
  onGoLauncher: () => void;
  onGoWorkspace: () => void;
  onSplitRight: () => void;
  onSplitDown: () => void;
  onToggleZoom: () => void;
  onNewWindow: () => void;
  onMoveToNewWindow: () => void;
  onAddHost: () => void;
  onAddProject: () => void;
  onImport: () => void;
  onSync: () => void;
  onSettings: (section?: SettingsSectionId) => void;
  onAssistSettings: () => void;
  onOpenSurface: (surface: SurfaceId) => void;
  onLock: () => void;
  agentLabel?: (agentId: string | null | undefined) => string;
}

export function CommandPalette({
  open,
  hosts,
  projects,
  runningSessions,
  canSplit,
  zoomed,
  inWorkspace,
  hasWorkspaceTabs,
  onOpenChange,
  onConnect,
  onFiles,
  onOpenProject,
  onReattach,
  onLocal,
  onGoLauncher,
  onGoWorkspace,
  onSplitRight,
  onSplitDown,
  onToggleZoom,
  onNewWindow,
  onMoveToNewWindow,
  onAddHost,
  onAddProject,
  onImport,
  onSync,
  onSettings,
  onAssistSettings,
  onOpenSurface,
  onLock,
  agentLabel = (id) => id ?? "agent",
}: CommandPaletteProps): React.JSX.Element {
  function run(action: () => void) {
    onOpenChange(false);
    action();
  }

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <RadixDialog.Content
          aria-label="Command palette"
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[calc(100vw-32px)] max-w-[600px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-panel border border-line-strong bg-elevated shadow-2xl shadow-black/70"
        >
          <RadixDialog.Title className="sr-only">
            Command palette
          </RadixDialog.Title>
          <Command
            loop
            className="flex min-h-0 flex-1 flex-col"
            filter={(value, search) => {
              if (!search) return 1;
              return value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
            }}
          >
            <Command.Input
              autoFocus
              placeholder="Search hosts, projects, and commands…"
              className="h-12 w-full border-b border-line bg-transparent px-4 text-[15px] text-fg outline-none placeholder:text-fg-subtle"
            />
            <Command.List className="min-h-0 flex-1 overflow-y-auto p-1.5">
              <Command.Empty className="px-3 py-8 text-center text-ui text-fg-subtle">
                No matching command
              </Command.Empty>

              <Group heading="Navigate">
                {inWorkspace && (
                  <Item
                    value="launcher dashboard home escape"
                    icon={<LayoutGrid size={15} />}
                    detail="⌘Esc"
                    onSelect={() => run(onGoLauncher)}
                  >
                    Back to Launcher
                  </Item>
                )}
                {!inWorkspace && hasWorkspaceTabs && (
                  <Item
                    value="workspace tabs panels escape"
                    icon={<PanelsTopLeft size={15} />}
                    detail="⌘Esc"
                    onSelect={() => run(onGoWorkspace)}
                  >
                    Back to Workspace
                  </Item>
                )}
                <Item
                  value="new local terminal shell"
                  icon={<TerminalSquare size={15} />}
                  detail="Open your default shell"
                  onSelect={() => run(onLocal)}
                >
                  New local terminal
                </Item>
                {inWorkspace && (
                  <>
                    <Item
                      value="split right pane vertical"
                      icon={<Columns2 size={15} />}
                      detail="⌘\\"
                      onSelect={() => run(onSplitRight)}
                    >
                      Split right
                    </Item>
                    <Item
                      value="split down pane horizontal"
                      icon={<Rows2 size={15} />}
                      detail="⌘⇧\\"
                      onSelect={() => run(onSplitDown)}
                    >
                      Split down
                    </Item>
                    <Item
                      value="zoom pane maximize"
                      icon={<Maximize2 size={15} />}
                      detail={zoomed ? "Exit zoom" : "Zoom focused pane"}
                      onSelect={() => run(onToggleZoom)}
                    >
                      {zoomed ? "Exit zoom" : "Zoom pane"}
                    </Item>
                    <Item
                      value="move tab to new window"
                      icon={<AppWindow size={15} />}
                      detail={canSplit ? "Detach focused tab" : "No tab selected"}
                      onSelect={() => run(onMoveToNewWindow)}
                    >
                      Move tab to new window
                    </Item>
                  </>
                )}
                <Item
                  value="new window workspace"
                  icon={<AppWindow size={15} />}
                  detail="Empty workspace window"
                  onSelect={() => run(onNewWindow)}
                >
                  New window
                </Item>
              </Group>

              {runningSessions.length > 0 && (
                <Group heading="Resume">
                  {runningSessions.map((session) => (
                    <Item
                      key={session.id}
                      value={`resume reattach running ${session.projectName} ${session.hostLabel} ${session.agentId ?? ""}`}
                      icon={<Radio size={15} />}
                      detail={`${agentLabel(session.agentId)} · ${session.hostLabel}`}
                      onSelect={() => run(() => onReattach(session))}
                    >
                      Resume {session.projectName}
                    </Item>
                  ))}
                </Group>
              )}

              {projects.length > 0 && (
                <Group heading="Projects">
                  {projects.map((project) => (
                    <Item
                      key={project.id}
                      value={`open project ${project.name} ${project.defaultAgent ?? ""}`}
                      icon={<FolderKanban size={15} />}
                      detail={agentLabel(project.defaultAgent ?? "shell")}
                      onSelect={() => run(() => onOpenProject(project))}
                    >
                      Open {project.name}
                    </Item>
                  ))}
                </Group>
              )}

              {hosts.length > 0 && (
                <Group heading="Hosts">
                  {hosts.map((host) => (
                    <Item
                      key={`connect-${host.id}`}
                      value={`connect ssh terminal ${host.label} ${host.hostname} ${host.username} ${host.tags.join(" ")}`}
                      icon={
                        <HostAvatar
                          label={host.label}
                          color={host.color}
                          size="sm"
                        />
                      }
                      detail={`${host.username}@${host.hostname}:${host.port}`}
                      onSelect={() => run(() => onConnect(host))}
                    >
                      Connect to {host.label}
                    </Item>
                  ))}
                  {hosts.map((host) => (
                    <Item
                      key={`files-${host.id}`}
                      value={`browse sftp files ${host.label} ${host.hostname}`}
                      icon={<FolderOpen size={15} />}
                      detail="Open SFTP browser"
                      onSelect={() => run(() => onFiles(host))}
                    >
                      Browse {host.label}
                    </Item>
                  ))}
                </Group>
              )}

              <Group heading="Manage">
                <Item
                  value="add host new server"
                  icon={<Plus size={15} />}
                  detail="Create an encrypted host record"
                  onSelect={() => run(onAddHost)}
                >
                  Add host
                </Item>
                <Item
                  value="add new project workspace"
                  icon={<FolderKanban size={15} />}
                  detail="Host · path · default agent"
                  onSelect={() => run(onAddProject)}
                >
                  New project
                </Item>
                <Item
                  value="import ssh config"
                  icon={<DownloadCloud size={15} />}
                  detail="Read ~/.ssh/config"
                  onSelect={() => run(onImport)}
                >
                  Import SSH config
                </Item>
                {(Object.keys(SURFACE_LABELS) as SurfaceId[]).map((id) => (
                  <Item
                    key={`goto-${id}`}
                    value={`go to ${SURFACE_LABELS[id]} surface ${id}`}
                    icon={
                      id === "assist" ? (
                        <Sparkles size={15} />
                      ) : id === "vault" ? (
                        <RefreshCw size={15} />
                      ) : (
                        <Settings size={15} />
                      )
                    }
                    detail="Open surface"
                    onSelect={() => run(() => onOpenSurface(id))}
                  >
                    Go to: {SURFACE_LABELS[id]}
                  </Item>
                ))}
                <Item
                  value="vault sync folder http sync server"
                  icon={<RefreshCw size={15} />}
                  detail="Share hosts across devices"
                  onSelect={() => run(onSync)}
                >
                  Vault sync
                </Item>
                <Item
                  value="assist providers api keys openrouter ollama anthropic openai models"
                  icon={<Sparkles size={15} />}
                  detail="Paste key · Test · pick model"
                  onSelect={() => run(onAssistSettings)}
                >
                  Assist providers
                </Item>
                <Item
                  value="settings preferences options"
                  icon={<Settings size={15} />}
                  detail="⌘,"
                  onSelect={() => run(() => onSettings("general"))}
                >
                  Settings
                </Item>
                <Item
                  value="lock vault security"
                  icon={<Lock size={15} />}
                  detail="Close remote sessions"
                  onSelect={() => run(onLock)}
                >
                  Lock vault
                </Item>
              </Group>

              <Group heading="Settings">
                {SETTINGS_PALETTE_ENTRIES.map((entry) => (
                  <Item
                    key={entry.id}
                    value={entry.value}
                    icon={<Settings size={15} />}
                    detail="Open section"
                    onSelect={() =>
                      run(() => onSettings(entry.id as SettingsSectionId))
                    }
                  >
                    {entry.label}
                  </Item>
                ))}
              </Group>
            </Command.List>
          </Command>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

function Group({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <Command.Group
      heading={heading}
      className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-[0.1em] [&_[cmdk-group-heading]]:text-fg-subtle [&_[cmdk-group-heading]]:uppercase"
    >
      {children}
    </Command.Group>
  );
}

function Item({
  value,
  icon,
  detail,
  onSelect,
  children,
}: {
  value: string;
  icon: ReactNode;
  detail: string;
  onSelect: () => void;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-ui text-fg-muted select-none data-[selected=true]:bg-hover data-[selected=true]:text-fg"
    >
      <span className="grid w-5 shrink-0 place-items-center">{icon}</span>
      <span className="truncate">{children}</span>
      <span className="ml-auto truncate pl-3 text-micro text-fg-subtle">
        {detail}
      </span>
    </Command.Item>
  );
}
