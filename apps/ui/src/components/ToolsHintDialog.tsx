import { useState } from "react";
import type { ToolsProbeDto } from "../lib/ipc";
import {
  armShellInjectGate,
  sanitizeShellPayload,
} from "../terminal/inject";
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
      await navigator.clipboard.writeText(sanitizeShellPayload(command).trim());
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(undefined), 1500);
    } catch (reason) {
      setError(String(reason));
    }
  }

  /**
   * Insert while the dialog still covers the terminal, then close. Gates
   * arm on pointerdown; injectShellText clears the line + drops DA/color
   * replies. Delay dialog close one frame so Radix unmount doesn't race.
   */
  function queueInsert(command: string, run: boolean): void {
    const clean = sanitizeShellPayload(command).replace(/^\n+|\n+$/g, "");
    if (!clean) {
      setError("Install command was empty after sanitizing.");
      return;
    }
    armShellInjectGate();
    onInsert(sessionId, clean, run);
    requestAnimationFrame(() => onClose());
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
                onPointerDown={(event) => {
                  event.preventDefault();
                  armShellInjectGate();
                }}
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
                onPointerDown={(event) => {
                  event.preventDefault();
                  armShellInjectGate();
                }}
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
