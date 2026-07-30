import {
  ChevronUp,
  File,
  Folder,
  FolderPlus,
  Link2,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { IconButton } from "../components/ui/Button";
import { Tooltip } from "../components/ui/Tooltip";
import type { FileEntryDto } from "../lib/generated/FileEntryDto";
import { cn } from "../lib/cn";
import { formatBytes, formatUnixTime } from "./path";

const DRAG_MIME = "application/x-tethra-file";

export interface DragPayload {
  side: "local" | "remote";
  path: string;
  fileType: string;
  name: string;
}

interface FilePaneProps {
  title: string;
  side: "local" | "remote";
  path: string;
  parentPath: string;
  entries: FileEntryDto[];
  loading: boolean;
  error?: string;
  selectedPath?: string;
  onNavigate: (path: string) => void;
  onRefresh: () => void;
  onSelect: (entry: FileEntryDto) => void;
  onCreateFolder: () => void;
  onRename: (entry: FileEntryDto) => void;
  onDelete: (entry: FileEntryDto) => void;
  onDropPayload: (payload: DragPayload) => void;
}

export function FilePane({
  title,
  side,
  path,
  parentPath,
  entries,
  loading,
  error,
  selectedPath,
  onNavigate,
  onRefresh,
  onSelect,
  onCreateFolder,
  onRename,
  onDelete,
  onDropPayload,
}: FilePaneProps): React.JSX.Element {
  const [dragOver, setDragOver] = useState(false);

  const sorted = useMemo(
    () =>
      [...entries].sort((a, b) => {
        const rank = (type: string) =>
          type === "dir" ? 0 : type === "symlink" ? 1 : 2;
        return (
          rank(a.fileType) - rank(b.fileType) ||
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
        );
      }),
    [entries],
  );

  return (
    <section
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        const raw = event.dataTransfer.getData(DRAG_MIME);
        if (!raw) return;
        try {
          onDropPayload(JSON.parse(raw) as DragPayload);
        } catch {
          // ignore malformed drag payloads
        }
      }}
      className={cn(
        "flex min-h-0 min-w-0 flex-col border-line transition-colors",
        dragOver && "bg-accent/5 inset-ring-1 inset-ring-accent",
      )}
    >
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-2.5">
        <span className="text-micro font-semibold tracking-[0.1em] text-fg-subtle uppercase">
          {title}
        </span>
        <span
          title={path}
          className="min-w-0 flex-1 truncate font-mono text-micro text-fg-muted"
          data-selectable
        >
          {path}
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
          {parentPath !== path && (
            <Tooltip content="Parent folder" side="bottom">
              <IconButton
                label="Parent folder"
                size="sm"
                onClick={() => onNavigate(parentPath)}
              >
                <ChevronUp size={14} />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip content="Refresh" side="bottom">
            <IconButton label="Refresh" size="sm" onClick={onRefresh}>
              <RefreshCw size={13} />
            </IconButton>
          </Tooltip>
          <Tooltip content="New folder" side="bottom">
            <IconButton label="New folder" size="sm" onClick={onCreateFolder}>
              <FolderPlus size={14} />
            </IconButton>
          </Tooltip>
        </div>
      </header>

      {error && (
        <div className="border-b border-danger/30 bg-danger/10 px-3 py-2 text-micro text-danger">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <p className="p-6 text-center text-micro text-fg-subtle">Loading…</p>
        ) : sorted.length === 0 ? (
          <p className="p-6 text-center text-micro text-fg-subtle">
            Empty folder
          </p>
        ) : (
          <table className="w-full border-collapse text-ui">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr className="text-micro text-fg-subtle">
                <th className="px-2.5 py-1.5 text-left font-medium">Name</th>
                <th className="w-20 px-2.5 py-1.5 text-right font-medium">
                  Size
                </th>
                <th className="w-32 px-2.5 py-1.5 text-left font-medium">
                  Modified
                </th>
                <th className="w-14" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((entry) => (
                <tr
                  key={entry.path}
                  draggable={entry.fileType !== "dir"}
                  onDragStart={(event) => {
                    const payload: DragPayload = {
                      side,
                      path: entry.path,
                      fileType: entry.fileType,
                      name: entry.name,
                    };
                    event.dataTransfer.setData(
                      DRAG_MIME,
                      JSON.stringify(payload),
                    );
                    event.dataTransfer.effectAllowed = "copy";
                  }}
                  onClick={() => onSelect(entry)}
                  onDoubleClick={() => {
                    if (entry.fileType === "dir") onNavigate(entry.path);
                  }}
                  className={cn(
                    "group cursor-default border-b border-line/60",
                    selectedPath === entry.path
                      ? "bg-accent/15 text-fg"
                      : "text-fg-muted hover:bg-hover",
                  )}
                >
                  <td className="max-w-0 px-2.5 py-1">
                    <span className="flex items-center gap-2">
                      <FileIcon type={entry.fileType} />
                      <span className="truncate">{entry.name}</span>
                    </span>
                  </td>
                  <td className="px-2.5 py-1 text-right font-mono text-micro whitespace-nowrap">
                    {entry.fileType === "dir" ? "—" : formatBytes(entry.size)}
                  </td>
                  <td className="px-2.5 py-1 text-micro whitespace-nowrap">
                    {formatUnixTime(entry.modifiedUnix)}
                  </td>
                  <td className="px-1 py-1">
                    <span className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                      <IconButton
                        label={`Rename ${entry.name}`}
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          onRename(entry);
                        }}
                      >
                        <Pencil size={12} />
                      </IconButton>
                      <IconButton
                        label={`Delete ${entry.name}`}
                        size="sm"
                        className="hover:text-danger"
                        onClick={(event) => {
                          event.stopPropagation();
                          onDelete(entry);
                        }}
                      >
                        <Trash2 size={12} />
                      </IconButton>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function FileIcon({ type }: { type: string }): React.JSX.Element {
  if (type === "dir") {
    return <Folder size={14} className="shrink-0 text-accent" />;
  }
  if (type === "symlink") {
    return <Link2 size={14} className="shrink-0 text-warning" />;
  }
  return <File size={14} className="shrink-0 text-fg-subtle" />;
}
