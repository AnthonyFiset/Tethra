# Tethra handoff

_Paste this into a new agent session with [`ROADMAP.md`](ROADMAP.md) / [`PROJECT.md`](PROJECT.md) if needed._

**As of:** 2026-08-21  
**Repo:** https://github.com/AnthonyFiset/Tethra (public)  
**Branch / commit:** `main` @ `5f58532`  
**Latest tag:** `v0.3.0`  
**Current task:** none — see [`ROADMAP.md`](ROADMAP.md)  
**Status / plan:** [`ROADMAP.md`](ROADMAP.md) — **only** place milestone status lives

---

## One-line product

Tethra is an E2E-encrypted SSH/SFTP vault client that **hosts coding agents** across your machines — not an agent itself.

**Wedge:** tmux/zellij persistence + vault sync reattach. Not “another AI chat.”

---

## How to work here

1. Read [`NEXT.md`](NEXT.md) for the active task. Completed briefs live in `docs/archive/`.
2. Read [`ROADMAP.md`](ROADMAP.md) for what’s done / what’s next — **do not invent milestones.**
3. Respect hard rules in [`PROJECT.md`](PROJECT.md). Especially: `core` ≠ Tauri, secrets ≠ JS, `ipc.ts` only.
4. Do not widen terminal input suppress windows to “fix” focus bugs — see landmines.
5. Ship desktop changes as tagged releases (GitHub Releases). See [`docs/UPDATES.md`](docs/UPDATES.md).

---

## Architecture (summary)

```
crates/core          portable product logic — MUST NOT depend on Tauri
crates/platform*     traits + desktop/ios adapters
crates/sync-server   HTTP vault sync (optional; not the updater)
apps/tauri/src-tauri IPC glue only
apps/ui              React; apps/ui/src/lib/ipc.ts is the ONLY invoke() surface
```

Full hard rules: [`PROJECT.md`](PROJECT.md).

Tab × = **detach**. Sidebar Kill = **kill mux**.

---

## Critical UI paths (regression-sensitive)

| Concern | Files |
|---|---|
| Terminal create / onData / theme / scroll filter | `apps/ui/src/terminal/registry.ts`, `syncFilter.ts` |
| **Insert / paste into PTY** | `apps/ui/src/terminal/inject.ts` — `injectShellText`, `armShellInjectGate` |
| OSC 133 block UI / Rerun | `apps/ui/src/terminal/blocks.ts` |
| Project scrollback | `apps/ui/src/terminal/scrollback.ts` |
| Tools / Assist insert | `ToolsHintDialog.tsx`, `AssistBar.tsx` → App |
| Clipboard / menus | `apps/ui/src/lib/ipc.ts`; `TerminalView.tsx`; `webview_chrome.rs`; `app_menu.rs` |
| SSH connect | `crates/core/src/ssh/session.rs` |
| Agent / provider catalogs | `crates/core/data/*.json`, `agents/`, `assist/` |
| Project launch / tmux | `apps/ui/src/projects/launch.ts`, `tmuxConf.ts` |

---

## Known landmines

1. **Device-report filter and insert gates.** xterm answers DA / OSC 10–11 via `onData`. **Paste and insert are different operations.** Insert buttons arm gates (`armGates()` → `blurAll()` + suppress); **paste must not** — `pasteIntoTerminal` calling `armGates()` was the v0.2.11 bug: it stole focus and dropped the first Enter for both ⌘V and right-click. `looksLikeDeviceReport` must never classify lone C0 (`\r` / `\t` / `\x03`) as a report. See v0.2.8–v0.2.11.
2. **Passwords don’t sync by default** — hosts sync; identities need `sync_secret` or re-entry on the peer.
3. **Modal → PTY focus** — dialog close can focus xterm and fire DA/color replies; insert path uses suppress + click shield + Ctrl-U. Don’t “simplify” Insert to raw `sendTerminalInput`.
4. **Edit → Copy/Paste on Mac** — xterm’s hidden textarea is not a form field; selection cleared by menu-bar focus (selection cache).
5. **Titlebar drag overlay** — full-width decoration drag steals clicks on Mac.
6. **`window-vibrancy`** — pin compatible with Tauri (historically `=0.6.0`).
7. **Node 22** — older Node skips Tailwind oxide → empty CSS utilities.
8. **Updater key rotation (2026-08-20)** — installs before the post-rotation build cannot auto-update; they need a one-time manual reinstall. Do not regenerate the keypair without cause.

---

## Verify (smoke)

```bash
scripts/ci-check.sh
cargo test -p core --lib agents::
cargo check -p tethra
npm run typecheck --prefix apps/ui

# Desktop
cd apps/tauri/src-tauri && npx --prefix ../../ui tauri dev
```

**After any `inject.ts` / `registry.ts` onData change:**

1. Type a command → **Enter runs it**
2. Paste (⌘V **and** right-click) → terminal stays focused → **one Enter** runs
3. Tools Insert → clean command (no `1;2c…rgb:…`)
4. Multi-line paste does not auto-execute each line

---

## Release flow

```bash
node scripts/set-version.mjs 0.3.0
# commit
git tag -a v0.3.0 -m "…"
git push origin main && git push origin v0.3.0
# CI builds/signs/publishes latest.json (not a draft, not a prerelease)
```

Endpoint: `https://github.com/AnthonyFiset/Tethra/releases/latest/download/latest.json`  
Details: [`docs/UPDATES.md`](docs/UPDATES.md).

---

## Doc map

| File | Role |
|---|---|
| [`NEXT.md`](NEXT.md) | **Current task only** |
| [`ROADMAP.md`](ROADMAP.md) | **Only** milestone / status board |
| [`PROJECT.md`](PROJECT.md) | Architecture + hard rules |
| [`HANDOFF.md`](HANDOFF.md) | This brief |
| [`README.md`](README.md) | Product / install / threat model |
| [`docs/UPDATES.md`](docs/UPDATES.md) | Self-update |
| [`docs/milestones/`](docs/milestones/) | Historical milestone writeups |
| [`docs/archive/`](docs/archive/) | Superseded roadmaps + completed NEXT / STATUS |
