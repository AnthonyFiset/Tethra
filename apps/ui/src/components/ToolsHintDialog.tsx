import { useState } from "react";
import { suppressPtyUserInput, type ToolsProbeDto } from "../lib/ipc";
import {
  armClickShield,
  suppressAllTerminalUserInput,
} from "../terminal/registry";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";
import { ErrorBanner } from "./ui/Field";

const DISMISS_KEY = "tethra.toolsHint.dismissed";

export function toolsHintDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function setToolsHintDismissed(value: boolean): void {
  try {
    if (value) localStorage.setItem(DISMISS_KEY, "1");
    else localStorage.removeItem(DISMISS_KEY);
  } catch {
    // ignore
  }
}

interface ToolsHintDialogProps {
  probe: ToolsProbeDto;
  /** Where to insert commands (active project/local session). */
  sessionId: string;
  onInsert: (sessionId: string, command: string, run: boolean) => void;
  onClose: () => void;
}

/** Keep only what should be typed into a shell — drop control / OSC leftovers. */
function sanitizeShellCommand(command: string): string {
  return command
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
}

export function ToolsHintDialog({
  probe,
  sessionId,
  onInsert,
  onClose,
}: ToolsHintDialogProps): React.JSX.Element {
  const [error, setError] = useState<string>();
  const [copiedId, setCopiedId] = useState<string>();

  const platformLabel =
    probe.platform === "macos"
      ? "macOS"
      : probe.platform === "linux"
        ? "Linux"
        : probe.platform === "windows"
          ? "Windows"
          : probe.uname || probe.platform;

  async function copyCommand(id: string, command: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(sanitizeShellCommand(command));
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(undefined), 1500);
    } catch (reason) {
      setError(String(reason));
    }
  }

  /**
   * Insert while the dialog still covers the terminal, then close behind a
   * click shield. IPC-level suppress drops any leftover xterm onData.
   */
  function queueInsert(command: string, run: boolean): void {
    const clean = sanitizeShellCommand(command);
    if (!clean) {
      setError("Install command was empty after sanitizing.");
      return;
    }
    suppressPtyUserInput(1000);
    suppressAllTerminalUserInput(1000);
    onInsert(sessionId, clean, run);
    armClickShield(500);
    onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      kicker="Missing tools"
      title={`Install on this ${platformLabel} host`}
      description="These aren’t on PATH yet. Defaults still work where they can — install to unlock the full feature."
      width="md"
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              setToolsHintDismissed(true);
              onClose();
            }}
          >
            Don't show again
          </Button>
          <Button variant="primary" onClick={onClose}>
            Got it
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error && <ErrorBanner>{error}</ErrorBanner>}

        {probe.missing.map((tool) => (
          <div
            key={tool.id}
            className="rounded-md border border-line bg-base px-3 py-2"
          >
            <div className="text-ui font-medium text-fg">{tool.label}</div>
            <p className="mt-0.5 mb-2 text-micro text-fg-muted">{tool.reason}</p>
            <code
              className="block font-mono text-micro break-all text-fg"
              data-selectable
            >
              {tool.installCommand}
            </code>
            <div className="mt-2 flex flex-wrap justify-end gap-2">
              <Button
                size="sm"
                variant="subtle"
                onClick={() => void copyCommand(tool.id, tool.installCommand)}
              >
                {copiedId === tool.id ? "Copied" : "Copy"}
              </Button>
              <Button
                size="sm"
                variant="subtle"
                onPointerDown={(event) => event.preventDefault()}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  queueInsert(tool.installCommand, false);
                }}
              >
                Insert
              </Button>
              <Button
                size="sm"
                variant="primary"
                onPointerDown={(event) => event.preventDefault()}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  queueInsert(tool.installCommand, true);
                }}
              >
                Insert & run
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  );
}

export function shouldShowToolsHint(probe: ToolsProbeDto): boolean {
  if (probe.missing.length === 0) return false;
  if (toolsHintDismissed()) return false;
  return true;
}
