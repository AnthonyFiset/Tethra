import { useEffect, useState, type FormEvent } from "react";
import {
  createApiKey,
  deleteApiKey,
  listApiKeys,
  updateApiKey,
  type ApiKeyMutation,
  type ApiKeySummaryDto,
  type AssistProviderId,
} from "../lib/ipc";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";
import { ErrorBanner, Field, inputClass } from "./ui/Field";

interface AssistSettingsModalProps {
  onClose: () => void;
}

export function AssistSettingsModal({
  onClose,
}: AssistSettingsModalProps): React.JSX.Element {
  const [keys, setKeys] = useState<ApiKeySummaryDto[]>([]);
  const [editing, setEditing] = useState<ApiKeySummaryDto | "new">();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function refresh(): Promise<void> {
    setKeys(await listApiKeys());
  }

  useEffect(() => {
    void refresh().catch((reason) => setError(String(reason)));
  }, []);

  async function remove(id: string): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      await deleteApiKey(id);
      await refresh();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      kicker="Assist"
      title="API keys"
      description="Keys stay encrypted in the vault. Opt in to sync_secret to share them across devices."
      width="md"
      footer={
        <Button variant="subtle" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        {error && <ErrorBanner>{error}</ErrorBanner>}

        <div className="flex items-center justify-between">
          <span className="text-micro text-fg-muted">
            {keys.length} key{keys.length === 1 ? "" : "s"}
          </span>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => setEditing("new")}
          >
            Add key
          </Button>
        </div>

        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {keys.map((key) => (
            <li
              key={key.id}
              className="flex items-center gap-2 rounded-md border border-line bg-base px-3 py-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ui font-medium text-fg">
                  {key.label}
                </span>
                <span className="block truncate text-micro text-fg-subtle">
                  {key.provider}
                  {key.model ? ` · ${key.model}` : ""}
                  {key.syncSecret ? " · syncs" : " · local only"}
                </span>
              </span>
              <Button
                variant="subtle"
                disabled={busy}
                onClick={() => setEditing(key)}
              >
                Edit
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => void remove(key.id)}
              >
                Delete
              </Button>
            </li>
          ))}
          {keys.length === 0 && (
            <p className="m-0 text-micro text-fg-subtle">
              No keys yet. Add Anthropic, OpenAI, or an OpenAI-compatible
              endpoint (Ollama / vLLM).
            </p>
          )}
        </ul>
      </div>

      {editing && (
        <ApiKeyEditor
          initial={editing === "new" ? undefined : editing}
          onClose={() => setEditing(undefined)}
          onSaved={async () => {
            setEditing(undefined);
            await refresh();
          }}
        />
      )}
    </Dialog>
  );
}

function ApiKeyEditor({
  initial,
  onClose,
  onSaved,
}: {
  initial?: ApiKeySummaryDto;
  onClose: () => void;
  onSaved: () => Promise<void>;
}): React.JSX.Element {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [provider, setProvider] = useState<AssistProviderId>(
    (initial?.provider as AssistProviderId) ?? "anthropic",
  );
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "");
  const [model, setModel] = useState(initial?.model ?? "");
  const [apiKey, setApiKey] = useState("");
  const [syncSecret, setSyncSecret] = useState(initial?.syncSecret ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const mutation: ApiKeyMutation = {
        label: label.trim(),
        provider,
        baseUrl: baseUrl.trim() || undefined,
        model: model.trim() || undefined,
        syncSecret,
      };
      if (apiKey.trim()) mutation.apiKey = apiKey.trim();
      if (!initial && !mutation.apiKey) {
        throw new Error("API key is required.");
      }
      if (initial) {
        await updateApiKey(initial.id, mutation);
      } else {
        await createApiKey(mutation);
      }
      await onSaved();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      kicker="Assist"
      title={initial ? "Edit API key" : "Add API key"}
      footer={
        <>
          <Button variant="subtle" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="api-key-form"
            disabled={busy}
          >
            {busy ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <form
        id="api-key-form"
        className="flex flex-col gap-3"
        onSubmit={(event) => void submit(event)}
      >
        {error && <ErrorBanner>{error}</ErrorBanner>}
        <Field
          label="Label"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          required
          autoFocus
        />
        <label className="flex flex-col gap-1.5">
          <span className="text-micro font-medium text-fg-muted">Provider</span>
          <select
            value={provider}
            onChange={(event) =>
              setProvider(event.target.value as AssistProviderId)
            }
            className={inputClass}
          >
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
            <option value="openaiCompat">OpenAI-compatible</option>
          </select>
        </label>
        {provider === "openaiCompat" && (
          <Field
            label="Base URL"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="http://thinkpad:11434/v1"
            required
          />
        )}
        <Field
          label="Model (optional)"
          value={model}
          onChange={(event) => setModel(event.target.value)}
          placeholder={
            provider === "anthropic" ? "claude-sonnet-4-5" : "gpt-4.1-mini"
          }
        />
        <Field
          label={initial ? "API key (leave blank to keep)" : "API key"}
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          type="password"
          autoComplete="off"
          required={!initial}
        />
        <label className="flex items-center gap-2 text-ui text-fg">
          <input
            type="checkbox"
            checked={syncSecret}
            onChange={(event) => setSyncSecret(event.target.checked)}
          />
          Sync this key to other devices
        </label>
      </form>
    </Dialog>
  );
}
