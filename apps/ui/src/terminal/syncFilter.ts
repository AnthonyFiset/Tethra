/**
 * Filter PTY bytes for agent TUI scroll-jump (M12.2).
 *
 * Claude Code / Codex / Copilot redraw with DEC 2026 sync blocks that contain
 * ED2 (`CSI 2 J`) / ED3 (`CSI 3 J`). With `scrollOnEraseInDisplay` xterm.js
 * pushes the erased screen into scrollback and yanks viewportY on every
 * frame (xtermjs/xterm.js#5801). Native terminals feel fine.
 *
 * Inside a sync block ED2 is REWRITTEN — not dropped — as "home + erase
 * below" wrapped in DECSC/DECRC, which clears the same cells without the
 * scrollback push. Dropping it (the previous behaviour) left every stale
 * row on screen and the next frame painted over them: Claude Code through
 * tmux (inline, no alt screen) rendered its logo and rules across leftover
 * shell text — "warped, lines everywhere". ED3 (wipe scrollback) inside a
 * sync block is still dropped. `clear`, vim, htop are unaffected — they
 * don't use mode 2026.
 *
 * Stateful across chunks (CSI may split on flush boundaries).
 */

type State = "ground" | "esc" | "csi";

export class SyncClearFilter {
  private state: State = "ground";
  private csi = "";
  /** Inside CSI ? 2026 h … l */
  private inSync = false;

  /**
   * Transform a chunk. Returns bytes safe to feed xterm (may be shorter).
   */
  push(input: Uint8Array): Uint8Array {
    if (!this.inSync && this.state === "ground" && !containsEsc(input)) {
      return input;
    }

    const out: number[] = [];
    for (let i = 0; i < input.length; i++) {
      const byte = input[i]!;
      switch (this.state) {
        case "ground":
          if (byte === 0x1b) {
            this.state = "esc";
          } else {
            out.push(byte);
          }
          break;
        case "esc":
          if (byte === 0x5b) {
            // CSI
            this.state = "csi";
            this.csi = "";
          } else {
            out.push(0x1b, byte);
            this.state = "ground";
          }
          break;
        case "csi": {
          // Collect until a final byte (0x40–0x7E).
          if (byte >= 0x40 && byte <= 0x7e) {
            const params = this.csi;
            const final = String.fromCharCode(byte);
            this.state = "ground";
            this.csi = "";
            this.handleCsi(params, final, out);
          } else if (byte >= 0x20 && byte <= 0x3f) {
            // Parameter / intermediate bytes
            this.csi += String.fromCharCode(byte);
            if (this.csi.length > 64) {
              // Pathological — emit and reset
              out.push(0x1b, 0x5b);
              for (let c = 0; c < this.csi.length; c++) {
                out.push(this.csi.charCodeAt(c));
              }
              out.push(byte);
              this.state = "ground";
              this.csi = "";
            }
          } else {
            // Invalid — emit what we buffered
            out.push(0x1b, 0x5b);
            for (let c = 0; c < this.csi.length; c++) {
              out.push(this.csi.charCodeAt(c));
            }
            out.push(byte);
            this.state = "ground";
            this.csi = "";
          }
          break;
        }
      }
    }
    return Uint8Array.from(out);
  }

  /** Drop partial CSI / stuck sync state (reconnect, dispose). */
  reset(): void {
    this.state = "ground";
    this.csi = "";
    this.inSync = false;
  }

  /**
   * Emit or swallow a completed CSI. Sync-block ED2/ED3 are dropped.
   */
  private handleCsi(params: string, final: string, out: number[]): void {
    // DEC private mode set/reset: CSI ? 2026 h/l
    if (params.startsWith("?") && (final === "h" || final === "l")) {
      const modes = params
        .slice(1)
        .split(";")
        .map((p) => p.trim());
      if (modes.includes("2026")) {
        this.inSync = final === "h";
      }
      emitCsi(params, final, out);
      return;
    }

    // ED: CSI Ps J — Ps defaults to 0
    if (final === "J" && !params.includes("?")) {
      const ps = params === "" ? "0" : (params.split(";")[0] ?? "0");
      if (this.inSync && ps === "3") {
        // Drop ED3 inside sync blocks — wiping scrollback mid-frame.
        return;
      }
      if (this.inSync && ps === "2") {
        // ED2 → DECSC, CUP 1;1, ED0, DECRC: clears the whole screen with no
        // scrollback push (the scroll yank) and the cursor stays put.
        out.push(0x1b, 0x37); // ESC 7
        emitCsi("1;1", "H", out);
        emitCsi("", "J", out);
        out.push(0x1b, 0x38); // ESC 8
        return;
      }
    }

    emitCsi(params, final, out);
  }
}

function emitCsi(params: string, final: string, out: number[]): void {
  out.push(0x1b, 0x5b);
  for (let i = 0; i < params.length; i++) {
    out.push(params.charCodeAt(i));
  }
  out.push(final.charCodeAt(0));
}

function containsEsc(data: Uint8Array): boolean {
  for (let i = 0; i < data.length; i++) {
    if (data[i] === 0x1b) return true;
  }
  return false;
}
