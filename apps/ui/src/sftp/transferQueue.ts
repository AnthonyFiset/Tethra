import {
  cancelSftpTransfer,
  sftpTransfer,
  type TransferEvent,
} from "../lib/ipc";

export type TransferDirection = "upload" | "download";
export type TransferStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export interface TransferItem {
  id: string;
  direction: TransferDirection;
  localPath: string;
  remotePath: string;
  label: string;
  status: TransferStatus;
  bytesTransferred: number;
  totalBytes: number | null;
  offset: number;
  error?: string;
}

export class TransferQueueRunner {
  private items: TransferItem[] = [];
  private running = false;
  private activeId: string | null = null;
  private sessionId: string;
  private onChange: () => void;

  constructor(sessionId: string, onChange: () => void) {
    this.sessionId = sessionId;
    this.onChange = onChange;
  }

  snapshot(): TransferItem[] {
    return this.items.map((item) => ({ ...item }));
  }

  enqueue(item: Omit<TransferItem, "status" | "bytesTransferred" | "totalBytes" | "offset"> & { offset?: number }) {
    this.items.push({
      ...item,
      status: "queued",
      bytesTransferred: item.offset ?? 0,
      totalBytes: null,
      offset: item.offset ?? 0,
    });
    this.onChange();
    void this.pump();
  }

  pauseActive() {
    if (!this.activeId) return;
    void cancelSftpTransfer(this.activeId);
  }

  resume(itemId: string) {
    const item = this.items.find((entry) => entry.id === itemId);
    if (!item || item.status !== "paused") return;
    item.status = "queued";
    item.error = undefined;
    this.onChange();
    void this.pump();
  }

  cancel(itemId: string) {
    const item = this.items.find((entry) => entry.id === itemId);
    if (!item) return;
    if (item.status === "running" && this.activeId === itemId) {
      void cancelSftpTransfer(itemId);
      return;
    }
    item.status = "cancelled";
    this.onChange();
  }

  retry(itemId: string) {
    const item = this.items.find((entry) => entry.id === itemId);
    if (!item) return;
    item.status = "queued";
    item.error = undefined;
    this.onChange();
    void this.pump();
  }

  clearCompleted() {
    this.items = this.items.filter(
      (item) => item.status !== "completed" && item.status !== "cancelled",
    );
    this.onChange();
  }

  private async pump() {
    if (this.running) return;
    const next = this.items.find((item) => item.status === "queued");
    if (!next) return;

    this.running = true;
    this.activeId = next.id;
    next.status = "running";
    this.onChange();

    try {
      await sftpTransfer(
        this.sessionId,
        next.id,
        next.direction,
        next.localPath,
        next.remotePath,
        next.offset,
        (event: TransferEvent) => this.applyEvent(next.id, event),
      );
      const item = this.items.find((entry) => entry.id === next.id);
      if (item && item.status === "running") {
        item.status = "completed";
      }
    } catch (reason) {
      const item = this.items.find((entry) => entry.id === next.id);
      if (!item) return;
      const message = String(reason);
      if (message.includes("cancelled")) {
        item.status = "paused";
        item.error = "Paused";
      } else {
        item.status = "failed";
        item.error = message;
      }
    } finally {
      this.running = false;
      this.activeId = null;
      this.onChange();
      void this.pump();
    }
  }

  private applyEvent(itemId: string, event: TransferEvent) {
    const item = this.items.find((entry) => entry.id === itemId);
    if (!item) return;
    item.bytesTransferred = Number(event.bytesTransferred);
    if (event.totalBytes !== null) {
      item.totalBytes = Number(event.totalBytes);
    }
    if (event.kind === "paused") {
      item.status = "paused";
      item.offset = item.bytesTransferred;
      item.error = event.message ?? "Paused";
    } else if (event.kind === "failed") {
      item.status = "failed";
      item.error = event.message ?? "Transfer failed";
    } else if (event.kind === "completed") {
      item.status = "completed";
      item.offset = item.bytesTransferred;
    }
    this.onChange();
  }
}
