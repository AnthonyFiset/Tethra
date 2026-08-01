import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronUp, Folder, FolderPlus, LoaderCircle, Search } from "lucide-react";
import {
  closeSftp,
  localHome,
  localList,
  localMkdir,
  openSftp,
  sftpRemoteCanonicalize,
  sftpRemoteCreateDirEntry,
  sftpRemoteList,
  type FileEntryDto,
} from "../lib/ipc";
import { Button, IconButton } from "../components/ui/Button";
import { ErrorBanner, inputClass } from "../components/ui/Field";
import { cn } from "../lib/cn";
import { joinPath } from "../sftp/path";

type BrowseMode =
  | { kind: "local" }
  | { kind: "remote"; hostId: string };

interface PathBrowserProps {
  mode: BrowseMode;
  initialPath?: string;
  onSelect: (path: string) => void;
  onCancel: () => void;
}

function parentPath(path: string): string | null {
  if (!path || path === "/" || path === ".") return null;
  const normalized = path.replace(/\/+$/, "");
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) return normalized.startsWith("/") ? "/" : null;
  return normalized.slice(0, idx) || "/";
}

function isDirectory(entry: FileEntryDto): boolean {
  return entry.fileType === "dir" || entry.fileType === "symlink";
}

export function PathBrowser({
  mode,
  initialPath,
  onSelect,
  onCancel,
}: PathBrowserProps): React.JSX.Element {
  const [cwd, setCwd] = useState(initialPath?.trim() || "");
  const [entries, setEntries] = useState<FileEntryDto[]>([]);
  const [sessionId, setSessionId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [creatingBusy, setCreatingBusy] = useState(false);
  const [query, setQuery] = useState("");
  const newNameRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) => entry.name.toLowerCase().includes(needle));
  }, [entries, query]);

  useEffect(() => {
    let cancelled = false;
    let openedSession: string | undefined;

    async function boot(): Promise<void> {
      setLoading(true);
      setError(undefined);
      try {
        if (mode.kind === "local") {
          const home = await localHome();
          const start = initialPath?.trim() || home;
          if (cancelled) return;
          setCwd(start);
          const listed = await localList(start);
          if (cancelled) return;
          setEntries(listed.filter(isDirectory));
        } else {
          const opened = await openSftp(mode.hostId);
          openedSession = opened.sessionId;
          if (cancelled) {
            await closeSftp(opened.sessionId).catch(() => undefined);
            return;
          }
          setSessionId(opened.sessionId);
          let start = initialPath?.trim() || opened.remotePath || ".";
          try {
            start = await sftpRemoteCanonicalize(opened.sessionId, start);
          } catch {
            start = opened.remotePath || ".";
          }
          if (cancelled) return;
          setCwd(start);
          const listed = await sftpRemoteList(opened.sessionId, start);
          if (cancelled) return;
          setEntries(listed.filter(isDirectory));
        }
      } catch (reason) {
        if (!cancelled) setError(String(reason));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void boot();
    return () => {
      cancelled = true;
      if (openedSession) {
        void closeSftp(openedSession).catch(() => undefined);
      }
    };
    // Only boot when mode/host changes — not on every path keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode.kind, mode.kind === "remote" ? mode.hostId : "local"]);

  useEffect(() => {
    return () => {
      if (sessionId) {
        void closeSftp(sessionId).catch(() => undefined);
      }
    };
  }, [sessionId]);

  useEffect(() => {
    if (creating) newNameRef.current?.focus();
  }, [creating]);

  async function refresh(at: string): Promise<void> {
    if (mode.kind === "local") {
      const listed = await localList(at);
      setEntries(listed.filter(isDirectory));
    } else {
      if (!sessionId) throw new Error("SFTP session is not open.");
      const listed = await sftpRemoteList(sessionId, at);
      setEntries(listed.filter(isDirectory));
    }
  }

  async function navigate(next: string): Promise<void> {
    setLoading(true);
    setError(undefined);
    setCreating(false);
    setNewName("");
    setQuery("");
    try {
      if (mode.kind === "local") {
        setCwd(next);
        await refresh(next);
      } else {
        if (!sessionId) throw new Error("SFTP session is not open.");
        let resolved = next;
        try {
          resolved = await sftpRemoteCanonicalize(sessionId, next);
        } catch {
          resolved = next;
        }
        setCwd(resolved);
        await refresh(resolved);
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      setLoading(false);
    }
  }

  async function goUp(): Promise<void> {
    const parent = parentPath(cwd);
    if (parent) await navigate(parent);
  }

  async function createFolder(): Promise<void> {
    const name = newName.trim();
    if (!name || name === "." || name === ".." || name.includes("/")) {
      setError("Enter a folder name without slashes.");
      return;
    }
    setCreatingBusy(true);
    setError(undefined);
    try {
      if (mode.kind === "local") {
        await localMkdir(joinPath(cwd, name));
      } else {
        if (!sessionId) throw new Error("SFTP session is not open.");
        await sftpRemoteCreateDirEntry(sessionId, cwd, name);
      }
      setCreating(false);
      setNewName("");
      await refresh(cwd);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setCreatingBusy(false);
    }
  }

  function choose(): void {
    if (sessionId) {
      void closeSftp(sessionId).catch(() => undefined);
      setSessionId(undefined);
    }
    onSelect(cwd);
  }

  function cancel(): void {
    if (sessionId) {
      void closeSftp(sessionId).catch(() => undefined);
      setSessionId(undefined);
    }
    onCancel();
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-line bg-base p-3">
      <div className="flex items-center gap-2">
        <IconButton
          label="Parent folder"
          size="sm"
          onClick={() => void goUp()}
          disabled={loading || !parentPath(cwd)}
        >
          <ChevronUp size={14} />
        </IconButton>
        <code
          className="min-w-0 flex-1 truncate rounded border border-line bg-elevated px-2 py-1 font-mono text-micro text-fg"
          title={cwd}
          data-selectable
        >
          {cwd || "…"}
        </code>
        <IconButton
          label="New folder"
          size="sm"
          onClick={() => {
            setError(undefined);
            setCreating(true);
            setNewName("");
          }}
          disabled={loading || !cwd || creating}
        >
          <FolderPlus size={14} />
        </IconButton>
      </div>

      {creating && (
        <div className="flex items-center gap-2">
          <input
            ref={newNameRef}
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void createFolder();
              }
              if (event.key === "Escape") {
                setCreating(false);
                setNewName("");
              }
            }}
            placeholder="New folder name"
            disabled={creatingBusy}
            className={inputClass}
          />
          <Button
            variant="subtle"
            type="button"
            onClick={() => {
              setCreating(false);
              setNewName("");
            }}
            disabled={creatingBusy}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            type="button"
            onClick={() => void createFolder()}
            disabled={creatingBusy || !newName.trim()}
          >
            {creatingBusy ? "Creating…" : "Create"}
          </Button>
        </div>
      )}

      <label className="relative flex items-center">
        <Search
          size={14}
          className="pointer-events-none absolute left-2.5 text-fg-subtle"
        />
        <input
          ref={searchRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && filtered.length === 1) {
              event.preventDefault();
              void navigate(filtered[0].path);
            }
            if (event.key === "Escape" && query) {
              event.preventDefault();
              setQuery("");
            }
          }}
          placeholder="Filter folders…"
          disabled={loading}
          className={cn(inputClass, "pl-8")}
        />
      </label>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <div className="max-h-56 min-h-40 overflow-y-auto rounded-md border border-line bg-elevated">
        {loading ? (
          <div className="grid h-40 place-items-center text-fg-subtle">
            <LoaderCircle size={18} className="animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="px-3 py-6 text-center text-micro text-fg-subtle">
            {query.trim()
              ? `No folders matching “${query.trim()}”.`
              : "No subfolders here. You can still select this path."}
          </p>
        ) : (
          <ul className="m-0 list-none p-1">
            {filtered.map((entry) => (
              <li key={entry.path}>
                <button
                  type="button"
                  onClick={() => void navigate(entry.path)}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-ui text-fg",
                    "hover:bg-hover",
                  )}
                >
                  <Folder size={14} className="shrink-0 text-fg-muted" />
                  <span className="truncate">{entry.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="subtle" type="button" onClick={cancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          type="button"
          onClick={choose}
          disabled={loading || !cwd}
        >
          Use this folder
        </Button>
      </div>
    </div>
  );
}
