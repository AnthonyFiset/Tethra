import * as RadixDialog from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import {
  DownloadCloud,
  FolderOpen,
  Lock,
  Plus,
  TerminalSquare,
} from "lucide-react";
import type { ReactNode } from "react";
import type { HostSummaryDto } from "../lib/ipc";
import { HostAvatar } from "./HostAvatar";

interface CommandPaletteProps {
  open: boolean;
  hosts: HostSummaryDto[];
  onOpenChange: (open: boolean) => void;
  onConnect: (host: HostSummaryDto) => void;
  onFiles: (host: HostSummaryDto) => void;
  onLocal: () => void;
  onAddHost: () => void;
  onImport: () => void;
  onLock: () => void;
}

export function CommandPalette({
  open,
  hosts,
  onOpenChange,
  onConnect,
  onFiles,
  onLocal,
  onAddHost,
  onImport,
  onLock,
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
          className="fixed top-[14vh] left-1/2 z-50 w-[calc(100vw-32px)] max-w-[600px] -translate-x-1/2 overflow-hidden rounded-panel border border-line-strong bg-elevated shadow-2xl shadow-black/70"
        >
          <RadixDialog.Title className="sr-only">
            Command palette
          </RadixDialog.Title>
          <Command
            loop
            filter={(value, search) => {
              if (!search) return 1;
              return value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
            }}
          >
            <Command.Input
              autoFocus
              placeholder="Search hosts and commands…"
              className="h-12 w-full border-b border-line bg-transparent px-4 text-[15px] text-fg outline-none placeholder:text-fg-subtle"
            />
            <Command.List className="max-h-[50vh] overflow-y-auto p-1.5">
              <Command.Empty className="px-3 py-8 text-center text-ui text-fg-subtle">
                No matching command
              </Command.Empty>

              <Group heading="Session">
                <Item
                  value="new local terminal shell"
                  icon={<TerminalSquare size={15} />}
                  detail="Open your default shell"
                  onSelect={() => run(onLocal)}
                >
                  New local terminal
                </Item>
              </Group>

              {hosts.length > 0 && (
                <Group heading="Hosts">
                  {hosts.map((host) => (
                    <Item
                      key={`connect-${host.id}`}
                      value={`connect ssh terminal ${host.label} ${host.hostname} ${host.username}`}
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
                  value="import ssh config"
                  icon={<DownloadCloud size={15} />}
                  detail="Read ~/.ssh/config"
                  onSelect={() => run(onImport)}
                >
                  Import SSH config
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
