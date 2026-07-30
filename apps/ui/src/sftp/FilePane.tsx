import { useMemo, useState } from "react";
import type { FileEntryDto } from "../lib/generated/FileEntryDto";
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
      className={`file-pane ${dragOver ? "file-pane--drag-over" : ""}`}
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
    >
      <header className="file-pane__header">
        <div>
          <span className="file-pane__title">{title}</span>
          <div className="file-pane__path" title={path}>
            {path}
          </div>
        </div>
        <div className="file-pane__actions">
          {parentPath !== path && (
            <button className="ghost-button" onClick={() => onNavigate(parentPath)}>
              Up
            </button>
          )}
          <button className="ghost-button" onClick={onRefresh}>
            Refresh
          </button>
          <button className="ghost-button" onClick={onCreateFolder}>
            New folder
          </button>
        </div>
      </header>

      {error && <div className="file-pane__error">{error}</div>}

      <div className="file-pane__table-wrap">
        <table className="file-pane__table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Size</th>
              <th>Modified</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="file-pane__empty">
                  Loading…
                </td>
              </tr>
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={4} className="file-pane__empty">
                  Empty folder
                </td>
              </tr>
            ) : (
              sorted.map((entry) => (
                <tr
                  key={entry.path}
                  className={
                    selectedPath === entry.path ? "file-pane__row--selected" : ""
                  }
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
                    if (entry.fileType === "dir") {
                      onNavigate(entry.path);
                    }
                  }}
                >
                  <td>
                    <span className={`file-icon file-icon--${entry.fileType}`}>
                      {entry.fileType === "dir" ? "▸" : "•"}
                    </span>
                    {entry.name}
                  </td>
                  <td>{formatBytes(entry.size)}</td>
                  <td>{formatUnixTime(entry.modifiedUnix)}</td>
                  <td className="file-pane__row-actions">
                    <button
                      className="link-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onRename(entry);
                      }}
                    >
                      Rename
                    </button>
                    <button
                      className="link-button link-button--danger"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDelete(entry);
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
