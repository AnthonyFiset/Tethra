import { useEffect, useState } from "react";
import { Copy, MoreHorizontal, Play, Share2 } from "lucide-react";
import { writeClipboardText } from "../lib/ipc";
import { armShellInjectGate } from "./inject";
import {
  dismissBlockMenu,
  setBlockMenuListener,
  type BlockMenuRequest,
} from "./blockMenuBridge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../components/ui/DropdownMenu";

/**
 * App-level Radix dropdown for block actions. Collision-aware (flip/shift)
 * so the menu never clips at the window edge.
 *
 * Stays mounted; `open` is driven by the imperative bridge so the trigger
 * exists before Radix positions the content.
 */
export function BlockMenuHost(): React.JSX.Element {
  const [request, setRequest] = useState<BlockMenuRequest | null>(null);

  useEffect(() => {
    setBlockMenuListener(setRequest);
    return () => setBlockMenuListener(null);
  }, []);

  const open = request != null;
  const anchorX = request?.anchorX ?? 0;
  const anchorY = request?.anchorY ?? 0;
  const block = request?.block;
  const snapshot = request?.snapshot;

  function run(action: () => void): void {
    dismissBlockMenu();
    action();
  }

  return (
    <DropdownMenu.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) dismissBlockMenu();
      }}
      modal={false}
    >
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          className="pointer-events-none fixed size-0 overflow-hidden opacity-0"
          style={{ left: anchorX, top: anchorY }}
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenuContent
          side="bottom"
          align="end"
          sideOffset={4}
          collisionPadding={12}
          className="min-w-[11rem]"
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          {block && snapshot ? (
            <>
              <DropdownMenuItem
                icon={<Copy size={14} />}
                onSelect={() =>
                  run(() => void writeClipboardText(block.commandText || ""))
                }
              >
                Copy command
              </DropdownMenuItem>
              <DropdownMenuItem
                icon={<Copy size={14} />}
                onSelect={() =>
                  run(() => void writeClipboardText(block.outputText || ""))
                }
              >
                Copy output
              </DropdownMenuItem>
              <DropdownMenuItem
                icon={<Share2 size={14} />}
                onSelect={() =>
                  run(() =>
                    void writeClipboardText(
                      [block.commandText, block.outputText]
                        .filter(Boolean)
                        .join("\n\n"),
                    ),
                  )
                }
              >
                Share block
              </DropdownMenuItem>
              <DropdownMenuItem
                icon={<Play size={14} />}
                disabled={!block.commandText}
                onSelect={() =>
                  run(() => {
                    if (!block.commandText) return;
                    armShellInjectGate();
                    snapshot.onRerun?.(block.commandText);
                  })
                }
              >
                Re-run
              </DropdownMenuItem>
              {snapshot.context.isAgentSession &&
              snapshot.context.onJumpToAgent ? (
                <DropdownMenuItem
                  icon={<MoreHorizontal size={14} />}
                  onSelect={() =>
                    run(() => snapshot.context.onJumpToAgent?.())
                  }
                >
                  Jump to agent
                </DropdownMenuItem>
              ) : null}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
