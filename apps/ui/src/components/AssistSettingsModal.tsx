import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  assistTestProvider,
  createApiKey,
  deleteApiKey,
  listApiKeys,
  listAssistPresets,
  updateApiKey,
  type ApiKeyMutation,
  type ApiKeySummaryDto,
  type AssistProviderId,
  type ProviderPresetDto,
} from "../lib/ipc";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";
import { ErrorBanner, Field, inputClass } from "./ui/Field";

interface AssistSettingsPanelProps {
  /** Hide the outer Close footer when embedded in Settings. */
  embedded?: boolean;
  onClose?: () => void;
  onChanged?: () => void;
}

export function AssistSettingsPanel({
  embedded,
  onClose,
  onChanged,
}: AssistSettingsPanelProps): React.JSX.Element {
  const [keys, setKeys] = useState<ApiKeySummaryDto[]>([]);
  const [presets, setPresets] = useState<ProviderPresetDto[]>([]);
  const [editing, setEditing] = useState<ApiKeySummaryDto | "new">();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const autoOpened = useRef(false);

  async function refresh(): Promise<void> {
    const [nextKeys, nextPresets] = await Promise.all([
      listApiKeys(),
      listAssistPresets(),
    ]);
    setKeys(nextKeys);
    setPresets(nextPresets);
    if (!autoOpened.current && nextKeys.length === 0 && nextPresets.length > 0) {
      autoOpened.current = true;
      setEditing("new");
    }
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
      onChanged?.();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        {error && <ErrorBanner>{error}</ErrorBanner>}

        <div className="flex items-center justify-between">
          <span className="text-micro text-fg-muted">
            {keys.length} provider{keys.length === 1 ? "" : "s"}
          </span>
          <Button
            variant="primary"
            disabled={busy || presets.length === 0}
            onClick={() => setEditing("new")}
          >
            Add provider
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
                  {providerLabel(key, presets)}
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
            <div className="rounded-md border border-dashed border-line px-3 py-4 text-center">
              <p className="m-0 text-ui text-fg">
                Add Anthropic, OpenRouter, Ollama, or any OpenAI-compatible
                endpoint.
              </p>
              <p className="mt-1 mb-3 text-micro text-fg-subtle">
                Paste a key → Test → pick a live model.
              </p>
              <Button
                variant="primary"
                disabled={busy || presets.length === 0}
                onClick={() => setEditing("new")}
              >
                Add provider
              </Button>
            </div>
          )}
        </ul>

        {!embedded && onClose && (
          <div className="flex justify-end border-t border-line pt-3">
            <Button variant="subtle" onClick={onClose}>
              Close
            </Button>
          </div>
        )}
      </div>

      {editing && presets.length > 0 && (
        <ApiKeyEditor
          initial={editing === "new" ? undefined : editing}
          presets={presets}
          onClose={() => setEditing(undefined)}
          onSaved={async () => {
            setEditing(undefined);
            await refresh();
            onChanged?.();
          }}
        />
      )}
    </>
  );
}

interface AssistSettingsModalProps {
  onClose: () => void;
}

export function AssistSettingsModal({
  onClose,
}: AssistSettingsModalProps): React.JSX.Element {
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      kicker="Assist"
      title="Providers"
      description="Pick a provider, paste a key, Test to load live models. Keys stay encrypted in the vault."
      width="md"
    >
      <AssistSettingsPanel onClose={onClose} />
    </Dialog>
  );
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function matchPreset(
  key: ApiKeySummaryDto | undefined,
  presets: ProviderPresetDto[],
): ProviderPresetDto {
  if (!key) {
    return presets.find((p) => p.id === "anthropic") ?? presets[0]!;
  }
  const byUrl = key.baseUrl
    ? presets.find(
        (p) =>
          p.baseUrl && normalizeUrl(p.baseUrl) === normalizeUrl(key.baseUrl!),
      )
    : undefined;
  if (byUrl) return byUrl;
  if (key.provider === "anthropic") {
    return presets.find((p) => p.id === "anthropic") ?? presets[0]!;
  }
  if (key.provider === "openai") {
    return presets.find((p) => p.id === "openai") ?? presets[0]!;
  }
  return presets.find((p) => p.id === "custom") ?? presets[0]!;
}

function providerLabel(
  key: ApiKeySummaryDto,
  presets: ProviderPresetDto[],
): string {
  return matchPreset(key, presets).displayName;
}

function ApiKeyEditor({
  initial,
  presets,
  onClose,
  onSaved,
}: {
  initial?: ApiKeySummaryDto;
  presets: ProviderPresetDto[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}): React.JSX.Element {
  const matched = matchPreset(initial, presets);
  const [presetId, setPresetId] = useState(matched.id);
  const preset = presets.find((p) => p.id === presetId) ?? matched;
  const [label, setLabel] = useState(initial?.label ?? preset.displayName);
  const [baseUrl, setBaseUrl] = useState(
    initial?.baseUrl ?? preset.baseUrl ?? "",
  );
  const [model, setModel] = useState(
    initial?.model ?? preset.defaultModel ?? "",
  );
  const [apiKey, setApiKey] = useState("");
  const [syncSecret, setSyncSecret] = useState(initial?.syncSecret ?? false);
  const [models, setModels] = useState<string[]>(
    initial?.model ? [initial.model] : [],
  );
  const [testState, setTestState] = useState<
    "idle" | "testing" | "ok" | "error"
  >("idle");
  const [testError, setTestError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  function applyPreset(next: ProviderPresetDto): void {
    setPresetId(next.id);
    if (!initial) {
      setLabel(next.displayName);
    }
    setBaseUrl(next.baseUrl || next.baseUrlHint || "");
    setModel(next.defaultModel ?? "");
    setModels(next.defaultModel ? [next.defaultModel] : []);
    setTestState("idle");
    setTestError(undefined);
  }

  async function runTest(): Promise<void> {
    setTestState("testing");
    setTestError(undefined);
    setError(undefined);
    try {
      if (preset.requiresKey && !apiKey.trim()) {
        throw new Error(
          initial?.hasKey
            ? "Paste the API key to test (it is never re-read from the vault)."
            : "API key is required to test this provider.",
        );
      }
      if (preset.keyPrefixHint && apiKey.trim()) {
        const hint = preset.keyPrefixHint;
        if (!apiKey.trim().startsWith(hint)) {
          setTestError(`Key usually starts with ${hint} — testing anyway.`);
        }
      }
      const result = await assistTestProvider({
        provider: preset.transport as AssistProviderId,
        baseUrl: baseUrl.trim() || undefined,
        apiKey: apiKey.trim() || undefined,
        presetId: preset.id,
      });
      if (!result.ok) {
        setTestState("error");
        setTestError(result.error ?? "Provider test failed.");
        setModels([]);
        return;
      }
      setTestState("ok");
      setModels(result.models);
      if (result.models.length > 0) {
        setModel((current) =>
          current && result.models.includes(current)
            ? current
            : (preset.defaultModel &&
                result.models.includes(preset.defaultModel)
              ? preset.defaultModel
              : result.models[0]!),
        );
      }
    } catch (reason) {
      setTestState("error");
      setTestError(String(reason));
      setModels([]);
    }
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const provider = preset.transport as AssistProviderId;
      const mutation: ApiKeyMutation = {
        label: label.trim(),
        provider,
        baseUrl:
          provider === "openaiCompat" || baseUrl.trim()
            ? baseUrl.trim() || undefined
            : undefined,
        model: model.trim() || undefined,
        syncSecret,
      };
      if (apiKey.trim()) mutation.apiKey = apiKey.trim();
      if (!initial && preset.requiresKey && !mutation.apiKey) {
        throw new Error("API key is required.");
      }
      if (provider === "openaiCompat" && !mutation.baseUrl) {
        throw new Error("Base URL is required for OpenAI-compatible providers.");
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

  const showBaseUrl =
    preset.transport === "openaiCompat" ||
    preset.id === "custom" ||
    preset.id === "azure-openai" ||
    Boolean(baseUrl && preset.baseUrl !== baseUrl) ||
    Boolean(preset.baseUrlHint);

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      kicker="Assist"
      title={initial ? "Edit provider" : "Add provider"}
      description={
        initial
          ? undefined
          : "Choose a preset, paste your key, then Test to load models."
      }
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
            value={presetId}
            onChange={(event) => {
              const next = presets.find((p) => p.id === event.target.value);
              if (next) applyPreset(next);
            }}
            className={inputClass}
            disabled={Boolean(initial)}
          >
            {presets.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.displayName}
              </option>
            ))}
          </select>
        </label>
        {showBaseUrl && (
          <Field
            label="Base URL"
            value={baseUrl}
            onChange={(event) => {
              setBaseUrl(event.target.value);
              setTestState("idle");
            }}
            placeholder={
              preset.baseUrlHint ?? "http://127.0.0.1:11434/v1"
            }
            required={preset.transport === "openaiCompat"}
            hint={
              preset.id === "azure-openai"
                ? "Replace {resource} with your Azure OpenAI resource name. Model is the deployment name."
                : undefined
            }
          />
        )}
        {preset.requiresKey && (
          <Field
            label={
              initial
                ? "API key (paste to Test; leave blank on Save to keep)"
                : "API key"
            }
            value={apiKey}
            onChange={(event) => {
              setApiKey(event.target.value);
              setTestState("idle");
            }}
            type="password"
            autoComplete="off"
            required={!initial}
            hint={
              preset.apiKeyUrl ? (
                <a
                  href={preset.apiKeyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent underline-offset-2 hover:underline"
                >
                  Get a key
                </a>
              ) : preset.keyPrefixHint ? (
                `Usually starts with ${preset.keyPrefixHint}`
              ) : undefined
            }
          />
        )}
        <div className="flex items-center gap-2">
          <Button
            variant="subtle"
            type="button"
            disabled={busy || testState === "testing"}
            onClick={() => void runTest()}
          >
            {testState === "testing" ? "Testing…" : "Test"}
          </Button>
          <span
            className={
              testState === "ok"
                ? "inline-block size-2.5 rounded-full bg-success"
                : testState === "error"
                  ? "inline-block size-2.5 rounded-full bg-danger"
                  : "inline-block size-2.5 rounded-full bg-fg-subtle/40"
            }
            aria-hidden
          />
          <span className="min-w-0 flex-1 truncate text-micro text-fg-subtle">
            {testState === "ok"
              ? `${models.length} model${models.length === 1 ? "" : "s"}`
              : testState === "error"
                ? (testError ?? "Failed")
                : testState === "testing"
                  ? "Calling /models…"
                  : "Not tested yet"}
          </span>
        </div>
        {models.length > 0 ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-micro font-medium text-fg-muted">Model</span>
            <select
              value={model}
              onChange={(event) => setModel(event.target.value)}
              className={inputClass}
            >
              {models.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <Field
            label="Model (optional)"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder={preset.defaultModel ?? "Run Test to load models"}
          />
        )}
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
