# Tethra QA gates

Three layers. A terminal/SSH change ships only when all three pass.

## 1. Real-SSH terminal QA (automated, required for any terminal/tmux/shell-integration change)

```bash
scripts/qa-terminal.sh
```

Spins up two Dockerized sshd targets (one plain, one with tmux + bash + git,
bash login shell — an Ubuntu-VPS stand-in) and runs:

- `crates/core/tests/terminal_qa.rs`
  - OSC 133 marks arrive **through real tmux** (passthrough envelope works)
  - tmux stays invisible: no status bar, no alternate screen, settings
    verified on the live server — including the fresh-server path (first
    connect ever on a host), which is where the status-bar regression hid
  - persistence: shell + environment survive disconnect/reattach; session
    is version-stamped (`@tethra_iv`)
  - migration: sessions from pre-passthrough builds are replaced on attach
  - keystroke echo latency through ssh+tmux (median must stay < 250ms
    locally; observed ~1ms — catches pipeline stalls)
- `crates/core/tests/ssh_integration.rs` (exec, pty, sftp, host keys)

## 1b. Real-stream UI replay (renderer truth)

The Ubuntu QA test (`ubuntu_apt_update_clear_then_typing_works`) saves the
raw byte stream it captured to `target/qa-transcripts/ubuntu-apt-clear.bin`.
Replay it against the live renderer to catch overlay/renderer bugs the
core tests can't see (black screens, stuck covers, dead input box):

```bash
base64 -i target/qa-transcripts/ubuntu-apt-clear.bin -o apps/ui/public/qa-apt-clear.b64
cd apps/ui && npm run dev:web
```

Then in Playwright (or the browser console) on http://localhost:5173:

```js
window.__tethraSkipFixture = true;   // set BEFORE the session opens (reload)
const b64 = (await (await fetch('/qa-apt-clear.b64')).text()).replace(/\s/g,'');
const raw = atob(b64);
for (let i = 0; i < raw.length; i += 1024) {
  window.__tethraFeedB64(btoa(raw.slice(i, i + 1024)));
  await new Promise(r => setTimeout(r, 15));
}
```

The feed hook parses OSC 133 marks and emits block events exactly like the
Rust backend. Assert with `window.__tethraTermDebug(window.__tethraLastSession())`:
viewport shows the prompt, headers exist (`.tethra-block-overlay-header`),
no oversized `.tethra-block-overlay-blank`, and typing mirrors into the
input box (`textarea[placeholder]`, NOT xterm's helper textarea).

Note: xterm's WebGL canvas screenshots BLACK in headless captures — assert
on buffer/DOM state, never on screenshot pixels of the terminal area.

Mandatory replay assertions (each caught a real shipped bug):
1. **Typing mirrors after `clear`**: type in `textarea[placeholder]`; its
   value must show the typed text (clear DISPOSES block markers — the
   mirror must fall back to the cursor row).
2. **No uncovered raw PS1 rows**: for every viewport row matching
   `^[\w.-]+@[\w.-]+:[^\s]*[#$](\s|$)`, a `.tethra-block-chrome-group` or
   `.tethra-block-overlay-blank` must cover its midpoint. Row pixel math:
   base off `.xterm-screen`'s rect (the overlay root sits ~8px above it),
   cell = screenRect.height / term.rows.
3. Run the audit BOTH mid-stream (during the running command) and at the
   end — the mid-apt state is where covers historically died.
4. **Header consistency (the user's #1 complaint)**: after replaying
   `qa-apt-full.b64` (preload the submitted commands via
   `__tethraNoteCmd(sid, cmd)` — that simulates the input box), EVERY
   finished command must show a header with ITS OWN text: `ls -a`, the
   sudo rm, `sudo apt-get update`, the echo. Feed at full speed (no
   delays) — burst timing is what broke attribution (whole-queue phase
   flush), and short plain commands ("sudo apt update", "npm run build")
   were once discarded by the directory-listing heuristic.
5. **Retype a previously-run command** (a finished block's exact text):
   the chrome on the CURSOR row must be the active header showing a bare
   `❯` — never the typed text, never a finished block's header. (Finished
   blocks text-matching the live row painted the user's in-progress typing
   into the terminal.)
`window.__tethraTermDebug(sid)` exposes `mirror` and `blockState`
(markers disposed? open phases?) for diagnosing failures.

## 2. UI harness (automated, every UI change)

```bash
cd apps/ui && npm run dev:web   # mock IPC on :5173
```

Drive with Playwright/Chrome tools per `.claude/skills/design-review`.
Covers layout, dialogs, keyboard flows — NOT tmux/SSH truth (see layer 1)
and NOT WKWebView rendering (see layer 3).

## 3. Real-app acceptance (manual, before merge)

`npm run tauri dev`, then on at least one local shell AND two remote hosts:
Warp block chrome renders, input box routes keys, quit → relaunch restores
sessions **with content**, no raw-terminal flashes, drag/⌘K/⌘B work.
