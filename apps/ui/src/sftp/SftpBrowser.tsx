import { ArrowLeft, ArrowRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../components/ui/Button";
import { cn } from "../lib/cn";
import type { FileEntryDto } from "../lib/generated/FileEntryDto";
import {
  localList,
  localMkdir,
  localRemove,
  localRename,
  sftpRemoteCanonicalize,
  sftpRemoteCreateDirEntry,
  sftpRemoteList,
  sftpRemoteRemove,
  sftpRemoteRename,
} from "../lib/ipc";
import { FilePane, type DragPayload } from "./FilePane";
import { joinPath, parentPath } from "./path";
import { TransferQueuePanel } from "./TransferQueuePanel";
import { TransferQueueRunner } from "./transferQueue";

interface SftpBrowserProps {
  sessionId: string;
  initialRemotePath: string;
  initialLocalPath: string;
  active: boolean;
}

export function SftpBrowser({
  sessionId,
  initialRemotePath,
  initialLocalPath,
  active,
}: SftpBrowserProps): React.JSX.Element {
  const [localPath, setLocalPath] = useState(initialLocalPath);
  const [remotePath, setRemotePath] = useState(initialRemotePath);
  const [localEntries, setLocalEntries] = useState<FileEntryDto[]>([]);
  const [remoteEntries, setRemoteEntries] = useState<FileEntryDto[]>([]);
  const [localLoading, setLocalLoading] = useState(true);
  const [remoteLoading, setRemoteLoading] = useState(true);
  const [localError, setLocalError] = useState<string>();
  const [remoteError, setRemoteError] = useState<string>();
  const [selectedLocal, setSelectedLocal] = useState<FileEntryDto>();
  const [selectedRemote, setSelectedRemote] = useState<FileEntryDto>();
  const [queueTick, setQueueTick] = useState(0);

  const queue = useMemo(
    () =>
      new TransferQueueRunner(sessionId, () => {
        setQueueTick((value) => value + 1);
      }),
    [sessionId],
  );

  const refreshLocal = useCallback(async () => {
    setLocalLoading(true);
    setLocalError(undefined);
    try {
      setLocalEntries(await localList(localPath));
    } catch (reason) {
      setLocalError(String(reason));
    } finally {
      setLocalLoading(false);
    }
  }, [localPath]);

  const refreshRemote = useCallback(async () => {
    setRemoteLoading(true);
    setRemoteError(undefined);
    try {
      setRemoteEntries(await sftpRemoteList(sessionId, remotePath));
    } catch (reason) {
      setRemoteError(String(reason));
    } finally {
      setRemoteLoading(false);
    }
  }, [remotePath, sessionId]);

  useEffect(() => {
    if (!active) return;
    void refreshLocal();
  }, [active, refreshLocal]);

  useEffect(() => {
    if (!active) return;
    void refreshRemote();
  }, [active, refreshRemote]);

  const transfers = queue.snapshot();
  void queueTick;

  async function createFolder(side: "local" | "remote") {
    const name = window.prompt("Folder name");
    if (!name || name === "." || name === ".." || name.includes("/")) {
      return;
    }
    try {
      if (side === "local") {
        await localMkdir(joinPath(localPath, name));
        await refreshLocal();
      } else {
        await sftpRemoteCreateDirEntry(sessionId, remotePath, name);
        await refreshRemote();
      }
    } catch (reason) {
      window.alert(String(reason));
    }
  }

  async function renameEntry(side: "local" | "remote", entry: FileEntryDto) {
    const nextName = window.prompt("Rename to", entry.name);
    if (!nextName || nextName === entry.name) return;
    if (nextName === "." || nextName === ".." || nextName.includes("/")) {
      window.alert("Invalid name");
      return;
    }
    const parent = parentPath(entry.path);
    const target = joinPath(parent, nextName);
    try {
      if (side === "local") {
        await localRename(entry.path, target);
        await refreshLocal();
      } else {
        await sftpRemoteRename(sessionId, entry.path, target);
        await refreshRemote();
      }
    } catch (reason) {
      window.alert(String(reason));
    }
  }

  async function deleteEntry(side: "local" | "remote", entry: FileEntryDto) {
    if (entry.name === "." || entry.name === "..") {
      return;
    }
    const recursive =
      entry.fileType === "dir"
        ? window.confirm(
            `Delete folder "${entry.name}" and everything inside it?`,
          )
        : window.confirm(`Delete "${entry.name}"?`);
    if (!recursive) return;
    try {
      if (side === "local") {
        await localRemove(entry.path, entry.fileType === "dir");
        await refreshLocal();
      } else {
        await sftpRemoteRemove(sessionId, entry.path, entry.fileType);
        await refreshRemote();
      }
    } catch (reason) {
      window.alert(String(reason));
    }
  }

  function enqueueTransfer(direction: "upload" | "download", payload: DragPayload) {
    if (payload.fileType === "dir") {
      window.alert("Folder transfers are not supported yet.");
      return;
    }
    const localPathValue =
      direction === "upload" ? payload.path : joinPath(localPath, payload.name);
    const remotePathValue =
      direction === "upload"
        ? joinPath(remotePath, payload.name)
        : payload.path;

    queue.enqueue({
      id: crypto.randomUUID(),
      direction,
      localPath: localPathValue,
      remotePath: remotePathValue,
      label: payload.name,
    });
  }

  async function uploadSelected() {
    if (!selectedLocal || selectedLocal.fileType === "dir") return;
    enqueueTransfer("upload", {
      side: "local",
      path: selectedLocal.path,
      fileType: selectedLocal.fileType,
      name: selectedLocal.name,
    });
  }

  async function downloadSelected() {
    if (!selectedRemote || selectedRemote.fileType === "dir") return;
    enqueueTransfer("download", {
      side: "remote",
      path: selectedRemote.path,
      fileType: selectedRemote.fileType,
      name: selectedRemote.name,
    });
  }

  return (
    <div
      className={cn(
        "absolute inset-0 flex flex-col bg-base",
        active ? "z-10 flex" : "hidden",
      )}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
        <Button
          size="sm"
          variant="ghost"
          icon={<ArrowRight size={13} />}
          onClick={() => void uploadSelected()}
          disabled={!selectedLocal || selectedLocal.fileType === "dir"}
        >
          Upload selected
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<ArrowLeft size={13} />}
          onClick={() => void downloadSelected()}
          disabled={!selectedRemote || selectedRemote.fileType === "dir"}
        >
          Download selected
        </Button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 divide-x divide-line max-md:grid-cols-1 max-md:grid-rows-2 max-md:divide-x-0 max-md:divide-y">
        <FilePane
          title="Local"
          side="local"
          path={localPath}
          parentPath={parentPath(localPath)}
          entries={localEntries}
          loading={localLoading}
          error={localError}
          selectedPath={selectedLocal?.path}
          onNavigate={setLocalPath}
          onRefresh={() => void refreshLocal()}
          onSelect={setSelectedLocal}
          onCreateFolder={() => void createFolder("local")}
          onRename={(entry) => void renameEntry("local", entry)}
          onDelete={(entry) => void deleteEntry("local", entry)}
          onDropPayload={(payload) => {
            if (payload.side === "remote") {
              enqueueTransfer("download", payload);
            }
          }}
        />
        <FilePane
          title="Remote"
          side="remote"
          path={remotePath}
          parentPath={parentPath(remotePath)}
          entries={remoteEntries}
          loading={remoteLoading}
          error={remoteError}
          selectedPath={selectedRemote?.path}
          onNavigate={(path) => {
            void (async () => {
              try {
                const resolved = await sftpRemoteCanonicalize(sessionId, path);
                setRemotePath(resolved);
              } catch (reason) {
                setRemoteError(String(reason));
              }
            })();
          }}
          onRefresh={() => void refreshRemote()}
          onSelect={setSelectedRemote}
          onCreateFolder={() => void createFolder("remote")}
          onRename={(entry) => void renameEntry("remote", entry)}
          onDelete={(entry) => void deleteEntry("remote", entry)}
          onDropPayload={(payload) => {
            if (payload.side === "local") {
              enqueueTransfer("upload", payload);
            }
          }}
        />
      </div>
      <TransferQueuePanel
        items={transfers}
        onPause={() => queue.pauseActive()}
        onResume={(id: string) => queue.resume(id)}
        onCancel={(id: string) => queue.cancel(id)}
        onRetry={(id: string) => queue.retry(id)}
        onClearCompleted={() => queue.clearCompleted()}
      />
    </div>
  );
}
