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
      <section className="transfer-queue transfer-queue--empty">
        <span>Drop files between panes to start a transfer.</span>
      </section>
    );
  }

  return (
    <section className="transfer-queue">
      <header className="transfer-queue__header">
        <strong>Transfers</strong>
        <button className="ghost-button" onClick={onClearCompleted}>
          Clear finished
        </button>
      </header>
      <ul className="transfer-queue__list">
        {items.map((item) => {
          const total = item.totalBytes ?? item.bytesTransferred;
          const percent =
            total > 0
              ? Math.min(100, Math.round((item.bytesTransferred / total) * 100))
              : item.status === "completed"
                ? 100
                : 0;
          return (
            <li key={item.id} className={`transfer-item transfer-item--${item.status}`}>
              <div className="transfer-item__meta">
                <span className="transfer-item__label">
                  {item.direction === "upload" ? "↑" : "↓"} {item.label}
                </span>
                <span className="transfer-item__status">{item.status}</span>
              </div>
              <div className="transfer-item__bar">
                <span style={{ width: `${percent}%` }} />
              </div>
              <div className="transfer-item__footer">
                <span>
                  {formatBytes(item.bytesTransferred)}
                  {item.totalBytes ? ` / ${formatBytes(item.totalBytes)}` : ""}
                </span>
                <div className="transfer-item__actions">
                  {item.status === "running" && (
                    <button className="link-button" onClick={onPause}>
                      Pause
                    </button>
                  )}
                  {item.status === "paused" && (
                    <button className="link-button" onClick={() => onResume(item.id)}>
                      Resume
                    </button>
                  )}
                  {item.status === "failed" && (
                    <button className="link-button" onClick={() => onRetry(item.id)}>
                      Retry
                    </button>
                  )}
                  {(item.status === "queued" ||
                    item.status === "running" ||
                    item.status === "paused") && (
                    <button
                      className="link-button link-button--danger"
                      onClick={() => onCancel(item.id)}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
              {item.error && item.status !== "completed" && (
                <div className="transfer-item__error">{item.error}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
