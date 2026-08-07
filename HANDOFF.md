# Tethra handoff — v0.2.9 / roadmap v3

_Paste this into Claude Code (or any new agent session) with [`ROADMAP-v3.md`](ROADMAP-v3.md) and [`PROJECT.md`](PROJECT.md) if needed. Longer engineering diary: [`STATUS.md`](STATUS.md)._

**As of:** 2026-08-07  
**Repo:** https://github.com/AnthonyFiset/Tethra (private)  
**Branch / commit:** `main` @ `b630b80`  
**Latest tag:** `v0.2.9` — Enter-key regression fix after insert hygiene  
**Canonical plan:** [`ROADMAP-v3.md`](ROADMAP-v3.md) (supersedes M10/M11 in v2; mobile deferred)

---

## How to use this doc (for Claude Code)

1. **Product intent first** — host coding agents across machines; do not turn Tethra into an agent.
2. **Respect hard rules** (architecture section) — especially `core` ≠ Tauri, secrets ≠ JS, `ipc.ts` only.
3. **Next feature work is M13 Fleet** unless the user says otherwise. Optional polish is listed under leftovers.
4. **Do not invent milestones** — prefer [`ROADMAP-v3.md`](ROADMAP-v3.md) + per-milestone `docs/M*.md`.
5. **Ship desktop fixes as tagged releases** (`scripts/set-version.mjs` → commit → `vX.Y.Z` → push → publish draft → sync host `fetch-updates`). See [`docs/UPDATES.md`](docs/UPDATES.md).
6. Prefer small, reviewable PRs/commits; run `scripts/ci-check.sh` (or the pre-push gate) before pushing `main`.

---

## One-line product

Tethra is an E2E-encrypted SSH/SFTP vault client that **hosts coding agents** across your machines — not an agent itself.

**Wedge:** tmux/zellij persistence + vault sync reattach (Resume a running agent on another device). Not “another AI chat.”

---

## Milestone board (truth table)

| # | Name | Status | Notes / doc |
|---|---|---|---|
| **M1–M9** | Core → Assist | **Done** | Shipped through **v0.2.5** |
| **M10** | Launcher + workspace | **Done** | Resume-first dashboard; ⌘Esc; sidebar only in Workspace — [`docs/M10.md`](docs/M10.md) |
| **M11** | Provider + agent catalogs | **Done** (core slices) | M11.1–11.3; BYOK launch + remote catalog fetch **deferred** — [`docs/M11.md`](docs/M11.md) |
| **M12** | Terminal feel | **Core done** | M12.1–12.4 done; asciinema / cross-device scrollback optional — [`docs/M12.md`](docs/M12.md) |
| **M12.5** | Platform chrome | **Done enough to ship** (v0.2.7) | Settings / materials / menus / clipboard; Track D polish leftovers — [`docs/M12.5.md`](docs/M12.5.md) |
| **M13** | Fleet | **Not started — NEXT** | Port forward, live ProxyJump, snippets, `FleetExec` |
| **M14** | Mobile | **Deferred** | Reattach/monitor agents; keep iOS `cargo check` green |

**Build order now:** **M13 Fleet** (promote live ProxyJump first if jump hosts block real machines today).

---

## What is done (by area)

### Foundation (M1–M6.2)

- Portable `crates/core`: SSH PTY/exec/SFTP, vault crypto, sync (`FileBackend` + `HttpBackend`)
- Desktop Tauri shell + React UI; Node **22** in CI (`.nvmrc`)
- Vault join/reset, background sync, opt-in password `sync_secret`, coordinated re-key
- Self-update via sync host mirror (`tethra-sync-server fetch-updates`) — [`docs/UPDATES.md`](docs/UPDATES.md)
- iOS stub + CI `cargo check -p core --target aarch64-apple-ios` (keep green for M14)

### Terminal + sessions (M7–M9)

- Conformance: alt screen, truecolor, bracketed paste, OSC 52/7, Unicode 11, mouse
- OSC 133 blocks in core + UI gutter (copy cmd/out, rerun)
- Splits + multi-window (closing a window must **not** kill Rust sessions)
- Projects + agents: open → cd → launch; tmux/zellij persist; RunningSessions + reattach
- Assist (`⌘I`): propose/explain, insert **without** auto-Enter; vault API keys
- Tab × = **detach**; sidebar Kill = **kill mux** + tombstone RunningSession

### Product UI (M10–M12.5)

- Launcher ↔ Workspace; Resume-first; empty-state Import `~/.ssh/config`
- Bundled provider + agent JSON catalogs; Assist Test = `GET /models`; deprecated Gemini → Antigravity
- JetBrains Mono; xterm theme from CSS tokens; DEC 2026 ED2/ED3 scroll-jump filter
- Same-device project scrollback via `@xterm/addon-serialize` + IndexedDB
- Unified Settings; window materials (opaque default; vibrancy/Mica opt-in); macOS menu bar; Mac clipboard/context-menu hardening (v0.2.7)

### Recent patch releases (read before touching terminal input)

| Tag | Why it exists |
|---|---|
| **v0.2.7** | M12.5 chrome + Mac clipboard / right-click / Edit menu / titlebar click fixes |
| **v0.2.8** | Insert buttons (tools / Assist / Rerun) must not prepend xterm DA + OSC 10/11 rgb junk → `apps/ui/src/terminal/inject.ts` |
| **v0.2.9** | `looksLikeDeviceReport` falsely dropped Enter/`\r` (and other lone C0 keys). **Do not** classify keystrokes as reports unless report-shaped bytes were actually stripped |

---

## What is NOT done (backlog)

### M13 — Fleet (**primary next milestone**)

No implementation yet. Intent (from v2/v3):

1. **Live ProxyJump** — today `Host.jump_host_id` is metadata from `~/.ssh/config` import only; `ssh/session.rs` connects **direct**. This is the highest-value Fleet slice if bastions block you.
2. **Port forwarding** — local/remote forwards managed in-app.
3. **Snippets** — vault-stored command snippets (data model already anticipates `kind: snippet` in sync docs).
4. **`FleetExec`** — structured multi-host exec API returning per-host results; UI on top (not a naive “broadcast keystrokes” toy).

Promote ProxyJump above other Fleet work if jump hosts are blocking real machines.

### Deferred / optional leftovers (not blockers for M13)

| Item | Status | Where |
|---|---|---|
| **BYOK at launch** | `byok_env` stored on agent presets; **not injected** into agent process env yet | M11 differentiator — [`docs/M11.md`](docs/M11.md) |
| Sync-server / public **catalog fetch** | Bundled JSON only today | `ROADMAP-v3.md` §A |
| Fuller agent seed (Cursor CLI, Goose, Cline, …) | Data-only PRs to `agents.json` | `crates/core/data/agents.json` |
| Vault custom AgentSpec / Custom command preset | Not built | M11 |
| Ephemeral **quick connect** (no vault) | Deferred | [`docs/M10.md`](docs/M10.md) |
| Host tag editing in form | Tags display only | M10 |
| Cross-device scrollback sync | Same-device IndexedDB only | M12.4 follow-up |
| Asciinema session recording | Not started | M12 optional |
| Settings sections still thin | Shell / Keyboard / Agents / Advanced incomplete vs M12.5 wishlist | [`docs/M12.5.md`](docs/M12.5.md) Track A |
| Track D design polish | Ambient/host cards landed; deeper polish open | M12.5 |
| SFTP recursive folder transfer + persisted queue | Not supported | Known limitation |
| Private-key identity sync | Device-local; passwords use `sync_secret` | Deferred opt-in |
| Code signing / public repo | Unsigned installers; Gatekeeper/SmartScreen | Product decision |
| M14 mobile UI | Stub only | Keep iOS check green |

**Ligature toggle:** prefs + Settings Terminal section exist (`getTerminalLigatures` / CSS `font-variant-ligatures`). Treat as **done** unless UX polish is requested; older docs calling it “open” are stale.

---

## Architecture (do not break)

```
crates/core          portable product logic — MUST NOT depend on Tauri
crates/platform*     traits + desktop/ios adapters
crates/sync-server   HTTP sync + update mirror (Tailscale sync host)
apps/tauri/src-tauri IPC glue only (commands, mux, updater, output pump)
apps/ui              React; apps/ui/src/lib/ipc.ts is the ONLY invoke() surface
```

### Hard rules

1. No Tauri / wry / tao in `core` (CI checks the dep tree).
2. Plaintext secrets never cross IPC; no secrets in `localStorage` / React state. Assist Test on edit = re-paste key by design.
3. Session state lives in Rust by session ID; tab/pane layout is frontend; OS windows are presentation — closing a window ≠ killing sessions.
4. Host agents; don’t become one. Shell out to `tmux`/`zellij` — do not build a multiplexer.
5. Private keys stay device-local; password identities default `local_only` unless `sync_secret`.
6. Stay on **Radix** and **xterm.js** (no Base UI / Ghostty-WASM migration).
7. Catalogs are **data** (`agents.json`, `assist_providers.json`) — not compiled special cases.
8. Tab close = detach; Kill = kill mux.

### Critical UI paths (regression-sensitive)

| Concern | Files |
|---|---|
| Terminal create / onData / theme / scroll filter | `apps/ui/src/terminal/registry.ts`, `syncFilter.ts` |
| **Insert / paste into PTY** (use this, don’t invent parallel paths) | `apps/ui/src/terminal/inject.ts` ← `injectShellText`, `armShellInjectGate` |
| OSC 133 block UI / Rerun | `apps/ui/src/terminal/blocks.ts` |
| Project scrollback | `apps/ui/src/terminal/scrollback.ts` |
| Tools Insert buttons | `apps/ui/src/components/ToolsHintDialog.tsx` → App `insertToolCommand` |
| Assist Insert | `apps/ui/src/components/AssistBar.tsx` |
| Clipboard / menus | `apps/ui/src/lib/ipc.ts` (`readClipboardText` / `writeClipboardText`); `TerminalView.tsx`; `apps/tauri/.../webview_chrome.rs`; `app_menu.rs` |
| All IPC | `apps/ui/src/lib/ipc.ts` + `apps/ui/src/lib/generated/` (ts-rs) |
| SSH connect | `crates/core/src/ssh/session.rs` |
| Vault / sync | `crates/core/src/vault/`, `crates/core/src/sync/` |
| Agent / provider catalogs | `crates/core/data/*.json`, `crates/core/src/agents/`, `crates/core/src/assist/` |

---

## Known landmines (read before coding)

1. **Device-report filter** — xterm answers DA / OSC 10–11 via `onData`. Filtering is required for Insert buttons, but **must not drop Enter/Tab/Ctrl-C**. See v0.2.8 → v0.2.9. Any change to `looksLikeDeviceReport` / `stripDeviceReports` needs both: pure-report drop **and** C0 keystroke pass-through tests.
2. **Passwords don’t sync by default** — hosts sync; identities need `sync_secret` or re-entry on the peer. `IdentityNotFound` UX improved in v0.2.8 (host form banner + clearer error).
3. **Modal → PTY focus** — dialog close can focus xterm and fire DA/color replies; inject path uses suppress + click shield + Ctrl-U. Don’t “simplify” Insert to raw `sendTerminalInput`.
4. **Edit → Copy/Paste on Mac** — xterm’s hidden textarea is not a form field; selection is cleared by menu-bar focus (use selection cache). See v0.2.7 notes.
5. **Titlebar drag overlay** — full-width decoration drag steals clicks on Mac; macOS path must not recreate that regression.
6. **`window-vibrancy`** — pin compatible with Tauri (historically `=0.6.0`); wrong version → ObjC symbol duplex.
7. **Node 22** — older Node skips Tailwind oxide binary → empty CSS utilities in CI/prod.

---

## What to work on next (recommended)

### Default: start M13 with live ProxyJump

Suggested approach:

1. Read `Host.jump_host_id` / import path in `ssh_config.rs` + `vault/repository.rs`.
2. Teach `ssh/session.rs` `connect` to open via bastion (russh jump / channel-over-channel — match existing stack; no OpenSSH subprocess if avoidable).
3. Surface jump status / errors in UI; keep secrets in Rust.
4. Tests: unit + optional docker SSH with a jump topology.
5. Then port forwards → snippets → `FleetExec`.

### Alternate tracks (if user asks)

- **BYOK launch injection** — biggest remaining M11 differentiator; inject vault Assist keys matching `byok_env` at agent launch (local + remote).
- **Catalog fetch** from sync server (`GET /catalogs/...`).
- **M12.5 Track D / Settings** polish.
- **Cross-device scrollback** or asciinema (demo candy, not wedge-critical).

---

## Verify (smoke)

```bash
# From repo root — full local gate
scripts/ci-check.sh

# Targeted
cargo test -p core --lib agents::
cargo test -p core --lib terminal::osc133::
cargo test -p core --features sync-http --lib catalog::
cargo check -p tethra
npm run typecheck --prefix apps/ui
npm run build --prefix apps/ui

# Desktop
cd apps/tauri/src-tauri && npx --prefix ../../ui tauri dev
```

**Manual terminal regressions after any `inject.ts` / `registry.ts` onData change:**

1. Type a command → **Enter runs it**
2. Tools hint → Insert / Insert & run → clean command only (no `1;2c…rgb:…` prefix)
3. Assist Insert → no auto-run; Enter still works after
4. ⌘C / ⌘V and terminal right-click Copy/Paste on macOS

---

## Release flow (desktop)

```bash
node scripts/set-version.mjs 0.2.x
# commit + docs pin
git tag -a v0.2.x -m "…"
gh auth switch --user AnthonyFiset   # if multiple gh accounts
git push origin main && git push origin v0.2.x
# Wait for Release CI → publish GitHub draft release
# On sync host:
tethra-sync-server fetch-updates --tag v0.2.x
```

Details: [`docs/UPDATES.md`](docs/UPDATES.md).

---

## Open product decisions (v3)

1. **Private vs public repo** — blocks signing + “catalog as PR target.”
2. **Catalog hosting** — sync-host-only vs public URL so strangers get agent presets without a release.

---

## Doc map

| File | Role |
|---|---|
| [`HANDOFF.md`](HANDOFF.md) | **This brief** — give to the next agent |
| [`ROADMAP-v3.md`](ROADMAP-v3.md) | Canonical plan + principles |
| [`ROADMAP-v2.md`](ROADMAP-v2.md) | Historical M6.2–M9; Fleet detail under old M10 |
| [`PROJECT.md`](PROJECT.md) | Architecture + hard rules + milestone summary |
| [`STATUS.md`](STATUS.md) | Long engineering status |
| [`docs/M10.md`](docs/M10.md)–[`M12.5.md`](docs/M12.5.md) | Shipped milestone notes |
| [`docs/M1.md`](docs/M1.md)–[`M9.md`](docs/M9.md) | Earlier milestones |
| [`docs/UPDATES.md`](docs/UPDATES.md) | Self-update / mirror |

---

## Recent release changelog (short)

- **v0.2.9** — Restore Enter and other C0 keys (`looksLikeDeviceReport` false positive).
- **v0.2.8** — `injectShellText` insert hygiene; clearer missing-password-on-device UX.
- **v0.2.7** — M12.5 platform chrome + Mac clipboard/menu/titlebar fixes.
- **v0.2.6** — M10–M12 launcher, catalogs, terminal feel.
- **v0.2.5** — M9 Assist + session UX polish.
