/**
 * Persist xterm serialize snapshots per project (M12.4).
 * Same-device detach → reattach restores history above the live mux screen.
 * Cross-device sync of these blobs is deferred (would ride vault/sync later).
 */

const DB_NAME = "tethra-scrollback";
const STORE = "snapshots";
const DB_VERSION = 1;
/** Cap stored ANSI — enough for a long agent session, not unbounded. */
export const SCROLLBACK_LINE_CAP = 2_500;
const MAX_CHARS = 400_000;

interface SnapshotRow {
  projectId: string;
  data: string;
  savedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error("idb open failed"));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "projectId" });
      }
    };
  });
}

export async function saveScrollbackSnapshot(
  projectId: string,
  data: string,
): Promise<void> {
  if (!projectId || !data) return;
  const trimmed =
    data.length > MAX_CHARS ? data.slice(data.length - MAX_CHARS) : data;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("idb write failed"));
      tx.objectStore(STORE).put({
        projectId,
        data: trimmed,
        savedAt: Date.now(),
      } satisfies SnapshotRow);
    });
    db.close();
  } catch {
    // Private mode / quota — non-fatal.
  }
}

export async function loadScrollbackSnapshot(
  projectId: string,
): Promise<string | undefined> {
  if (!projectId) return undefined;
  try {
    const db = await openDb();
    const row = await new Promise<SnapshotRow | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(projectId);
      request.onsuccess = () => resolve(request.result as SnapshotRow | undefined);
      request.onerror = () => reject(request.error ?? new Error("idb read failed"));
    });
    db.close();
    return row?.data;
  } catch {
    return undefined;
  }
}

export async function clearScrollbackSnapshot(projectId: string): Promise<void> {
  if (!projectId) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("idb delete failed"));
      tx.objectStore(STORE).delete(projectId);
    });
    db.close();
  } catch {
    // ignore
  }
}
