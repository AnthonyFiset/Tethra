import { ArrowDown, ArrowUp, Pause, Play, RotateCcw, X } from "lucide-react";
import { IconButton } from "../components/ui/Button";
import { cn } from "../lib/cn";
import { formatBytes } from "./path";
import type { TransferItem } from "./transferQueue";

interface TransferQueueProps {
  items: TransferItem[];
  onPause: () => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onClearCompleted: () => void;
}

const STATUS_TONE: Record<string, string> = {
  completed: "text-success",
  failed: "text-danger",
  paused: "text-warning",
  running: "text-accent",
  queued: "text-fg-subtle",
  cancelled: "text-fg-subtle",
};

export function TransferQueuePanel({
  items,
  onPause,
  onResume,
  onCancel,
  onRetry,
  onClearCompleted,
}: TransferQueueProps): React.JSX.Element {
  if (items.length === 0) {
    return (
      <section className="flex h-10 shrink-0 items-center justify-center border-t border-line bg-surface px-3 text-micro text-fg-subtle">
        Drop files or folders between panes to start a transfer.
      </section>
    );
  }

  return (
    <section className="flex max-h-56 shrink-0 flex-col border-t border-line bg-surface">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="text-micro font-semibold tracking-[0.1em] text-fg-subtle uppercase">
          Transfers
        </span>
        <span className="text-micro text-fg-subtle">{items.length}</span>
        <button
          onClick={onClearCompleted}
          className="ml-auto cursor-pointer text-micro text-fg-muted transition-colors hover:text-accent"
        >
          Clear finished
        </button>
      </header>

      <ul className="m-0 min-h-0 flex-1 list-none overflow-y-auto p-1">
        {items.map((item) => {
          const total = item.totalBytes ?? item.bytesTransferred;
          const percent =
            total > 0
              ? Math.min(100, Math.round((item.bytesTransferred / total) * 100))
              : item.status === "completed"
                ? 100
                : 0;

          return (
            <li key={item.id} className="rounded-md px-2 py-1.5 hover:bg-hover">
              <div className="flex items-center gap-2">
                {item.direction === "upload" ? (
                  <ArrowUp size={12} className="shrink-0 text-fg-subtle" />
                ) : (
                  <ArrowDown size={12} className="shrink-0 text-fg-subtle" />
                )}
                <span className="min-w-0 flex-1 truncate text-ui text-fg">
                  {item.label}
                </span>
                <span
                  className={cn(
                    "shrink-0 text-micro capitalize",
                    STATUS_TONE[item.status] ?? "text-fg-subtle",
                  )}
                >
                  {item.status}
                </span>
                <div className="flex shrink-0 items-center gap-0.5">
                  {item.status === "running" && (
                    <IconButton label="Pause" size="sm" onClick={onPause}>
                      <Pause size={12} />
                    </IconButton>
                  )}
                  {item.status === "paused" && (
                    <IconButton
                      label="Resume"
                      size="sm"
                      onClick={() => onResume(item.id)}
                    >
                      <Play size={12} />
                    </IconButton>
                  )}
                  {item.status === "failed" && (
                    <IconButton
                      label="Retry"
                      size="sm"
                      onClick={() => onRetry(item.id)}
                    >
                      <RotateCcw size={12} />
                    </IconButton>
                  )}
                  {(item.status === "queued" ||
                    item.status === "running" ||
                    item.status === "paused") && (
                    <IconButton
                      label="Cancel"
                      size="sm"
                      className="hover:text-danger"
                      onClick={() => onCancel(item.id)}
                    >
                      <X size={12} />
                    </IconButton>
                  )}
                </div>
              </div>

              <div className="mt-1 flex items-center gap-2">
                <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-active">
                  <div
                    className={cn(
                      "h-full rounded-full transition-[width] duration-200",
                      item.status === "failed"
                        ? "bg-danger"
                        : item.status === "completed"
                          ? "bg-success"
                          : "bg-accent",
                    )}
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <span className="shrink-0 font-mono text-micro text-fg-subtle">
                  {item.filesTotal
                    ? `${item.filesDone ?? 0}/${item.filesTotal} · `
                    : ""}
                  {formatBytes(item.bytesTransferred)}
                  {item.totalBytes ? ` / ${formatBytes(item.totalBytes)}` : ""}
                </span>
              </div>

              {item.currentFile && item.status === "running" && (
                <p className="mt-1 mb-0 truncate text-micro text-fg-subtle">
                  {item.currentFile}
                </p>
              )}

              {item.error && (
                <p
                  className={cn(
                    "mt-1 mb-0 whitespace-pre-wrap text-micro",
                    item.status === "completed" ? "text-warning" : "text-danger",
                  )}
                  data-selectable
                >
                  {item.error}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
