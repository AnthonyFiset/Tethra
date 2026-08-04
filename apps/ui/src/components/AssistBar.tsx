import { useEffect, useState } from "react";
import {
  assistExplain,
  assistPropose,
  listApiKeys,
  type ApiKeySummaryDto,
  type AssistContextPayload,
} from "../lib/ipc";
import { armShellInjectGate } from "../terminal/inject";
import { Button } from "./ui/Button";
import { ErrorBanner, inputClass } from "./ui/Field";

interface AssistBarProps {
  context: AssistContextPayload;
  reloadToken?: number;
  onInsert: (command: string) => void;
  onOpenSettings: () => void;
  onClose: () => void;
}

export function AssistBar({
  context,
  reloadToken = 0,
  onInsert,
  onOpenSettings,
  onClose,
}: AssistBarProps): React.JSX.Element {
  const [keys, setKeys] = useState<ApiKeySummaryDto[]>([]);
  const [apiKeyId, setApiKeyId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<string>();
  const [mode, setMode] = useState<"command" | "explain">("command");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void listApiKeys()
      .then((next) => {
        setKeys(next);
        setApiKeyId((current) =>
          next.some((key) => key.id === current) ? current : next[0]?.id || "",
        );
      })
      .catch((reason) => setError(String(reason)));
  }, [reloadToken]);

  async function run(kind: "command" | "explain"): Promise<void> {
    setError(undefined);
    setResult(undefined);
    if (!apiKeyId) {
      setError("Add an Assist API key first.");
      return;
    }
    if (!prompt.trim()) {
      setError("Enter a prompt.");
      return;
    }
    setBusy(true);
    setMode(kind);
    try {
      if (kind === "command") {
        const proposed = await assistPropose(apiKeyId, prompt.trim(), context);
        setResult(proposed.command);
      } else {
        const explained = await assistExplain(apiKeyId, prompt.trim(), context);
        setResult(explained.text);
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-b border-line bg-elevated px-3 py-2">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-micro font-semibold tracking-[0.1em] text-fg-subtle uppercase">
          Assist
        </span>
        <span className="truncate text-micro text-fg-muted">
          {context.hostLabel}
          {context.cwd ? ` · ${context.cwd}` : ""}
        </span>
        <button
          type="button"
          className="ml-auto text-micro text-accent hover:underline"
          onClick={onOpenSettings}
        >
          Providers
        </button>
        <button
          type="button"
          className="text-micro text-fg-subtle hover:text-fg"
          onClick={onClose}
        >
          Esc
        </button>
      </div>

      {error && (
        <div className="mb-2">
          <ErrorBanner>{error}</ErrorBanner>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={apiKeyId}
          onChange={(event) => setApiKeyId(event.target.value)}
          disabled={busy || keys.length === 0}
          className={`${inputClass} w-40`}
        >
          {keys.length === 0 && <option value="">No API keys</option>}
          {keys.map((key) => (
            <option key={key.id} value={key.id}>
              {key.label}
            </option>
          ))}
        </select>
        <input
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void run("command");
            }
            if (event.key === "Escape") onClose();
          }}
          placeholder="Ask for a command… (never auto-runs)"
          disabled={busy}
          autoFocus
          className={`${inputClass} min-w-[16rem] flex-1`}
        />
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => void run("command")}
        >
          {busy && mode === "command" ? "…" : "Propose"}
        </Button>
        <Button
          variant="subtle"
          disabled={busy}
          onClick={() => void run("explain")}
        >
          {busy && mode === "explain" ? "…" : "Explain"}
        </Button>
      </div>

      {result && (
        <div className="mt-2 flex flex-col gap-2 rounded-md border border-line bg-base px-3 py-2">
          <pre
            className="m-0 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-micro text-fg"
            data-selectable
          >
            {result}
          </pre>
          <div className="flex justify-end gap-2">
            <Button
              variant="subtle"
              onClick={() => {
                setResult(undefined);
              }}
            >
              Discard
            </Button>
            {mode === "command" && result && (
              <Button
                variant="primary"
                onPointerDown={(event) => {
                  event.preventDefault();
                  armShellInjectGate();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onInsert(result);
                  onClose();
                }}
              >
                Insert
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
