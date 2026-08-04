# Tethra handoff — v0.2.8 / roadmap v3

_Paste this (plus [`ROADMAP-v3.md`](ROADMAP-v3.md) / [`PROJECT.md`](PROJECT.md) if needed) into another session. Longer engineering status: [`STATUS.md`](STATUS.md)._

**As of:** 2026-08-04  
**Repo:** https://github.com/AnthonyFiset/Tethra (private)  
**Branch / commit:** `main` (tag `v0.2.8` after push)  
**Tag:** `v0.2.8` (publish GitHub draft when Release CI is green → `tethra-sync-server fetch-updates`)  
**Canonical plan:** [`ROADMAP-v3.md`](ROADMAP-v3.md) (supersedes M10/M11 in v2; mobile deferred to end)

---

## One-line product

Tethra is an E2E-encrypted SSH/SFTP vault client that **hosts coding agents** across your machines — not an agent itself. Wedge = **tmux persistence + vault sync reattach**, not AI.

---

## Milestone board (v3)

| # | Name | Status | Notes |
|---|---|---|---|
| M1–M9 | Core → Assist | **Done** | Through v0.2.5 |
| **M10** | Launcher and workspace | **Done** | Dashboard / Resume-first; sidebar Open tree; Launcher ↔ Workspace (⌘Esc) |
| **M11** | Provider + agent catalogs | **Done** | M11.1–11.3; BYOK launch deferred |
| **M12** | Terminal feel | **Mostly done** | M12.1–12.4 + polish audit; optional asciinema / ligatures; cross-device scrollback sync open |
| **M12.5** | Platform chrome | **Done (v0.2.7)** | A–D + terminal clipboard/menu fixes — [`docs/M12.5.md`](docs/M12.5.md) |
| **M13** | Fleet | **Next** | Port forward, live ProxyJump, snippets, `FleetExec` (was v2 M10) |
| **M14** | Mobile | Deferred | Reattach/monitor agents; keep iOS `cargo check` green |

**Build order:** **M13 Fleet** (promote ProxyJump if jump hosts block you today).

---

## What shipped in v0.2.8

### Terminal insert hygiene + password-on-device UX

- **Insert buttons (tools hint, Assist, block Rerun, menu rerun):** shared `injectShellText` path — suppress xterm `onData`, click shield, blur, double Ctrl-U, force PTY input so DA / OSC 10–11 color replies never prepend install commands (`1;2c…rgb:…npm install…`)
- Always filter pure device-report chunks and strip known DA/OSC-rgb mash from terminal input
- Clearer `IdentityNotFound` / host form banner when vault sync brought a host without a password on this device

## What shipped in v0.2.7

### M12.5 platform chrome + clipboard hardening

- `bundle.macOS.bundleName: "Tethra"` so Hide/Quit use the product name
- Full macOS menu bar → `menu-command` → same App handlers; Windows keeps About/Quit only
- **Track A:** sectioned Settings folds Sync / AI / Vault; terminal prefs; configurable vault idle auto-lock
- **Track B:** Opaque default; Appearance → Vibrant / Custom / Acrylic; `window-vibrancy` (mac vibrancy, Win11 Mica); chrome CSS translucency; terminal viewport stays opaque; `macOSPrivateApi` for dmg
- **Track C:** `ChromeStyle`, `tauri-plugin-decoration`, caption clearance, Settings full-page on win/linux, Windows system accent
- **Track D (first pass):** host-color ambient, calmer host cards, empty-state CTAs, toolbar Lock separated, brand accent `#3D8EF0`
- **Clipboard / menus (critical Mac fixes):** native clipboard plugin; Edit→Copy/Paste and ⌘C/⌘V target the PTY (not xterm’s hidden textarea); selection cache for menu-bar Copy; terminal right-click portal menu (not Radix) so every item fires; bubble-phase WebView contextmenu suppress so app menus open
- Titlebar clicks: no full-width decoration drag overlay on macOS; dedicated drag spacers between controls
- Docs: [`docs/M12.5.md`](docs/M12.5.md)

## What shipped in v0.2.6

### M10 — Launcher + workspace

- Launcher dashboard vs Workspace tabs; ⌘Esc toggles; title-bar / palette navigation both ways when tabs exist
- Resume-first Running sessions; sidebar Open tree; host cards
- Docs: [`docs/M10.md`](docs/M10.md)

### M11 — Provider + agent catalogs (data, not compiled special cases)

- Bundled `crates/core/data/assist_providers.json` + `assist_test_provider` (`GET /models`)
- Bundled `crates/core/data/agents.json` + catalog-driven probe/install
- Antigravity (`agy`) official install scripts; Gemini **Deprecated → antigravity** (open persists successor)
- Project form: Installed / Available from probe (neutral until probe ready); copy-install
- Assist settings: preset → paste key → Test → live models → Save (key never re-read from vault for Test)
- Docs: [`docs/M11.md`](docs/M11.md) — **BYOK env injection at launch still deferred**

### M12 — Terminal feel (+ audit polish)

- OSC 133 failed gutter + Copy cmd/out / Rerun; JetBrains Mono
- Output pump emits data **before** each OSC 133 block so markers don’t collapse onto one flush
- Agent TUI scroll-jump: strip ED2/ED3 inside DEC 2026 + `scrollOnEraseInDisplay`; filter `reset()` on dispose
- xterm theme from app CSS tokens
- Serialize → IndexedDB on project detach; restore on open / Resume / multi-window adopt (buffer PTY until restore finishes; await persist before dispose)
- Project delete clears scrollback snapshot; empty Workspace returns to Launcher
- Docs: [`docs/M12.md`](docs/M12.md)

---

## v3 principles that change how we build

1. **Catalogs are data** (`Catalog<T>`): bundled snapshot → sync-server fetch → vault overrides win. Agent/provider churn must not require a tagged release.
2. **One OpenAI-compat transport** covers OpenRouter + local (LM Studio, Ollama, …). Native Anthropic/OpenAI stay; everything else is base URL + key + UX.
3. **Stay on Radix and xterm.js** — no Base UI migration; M12 mitigates xterm scroll-jump under agent TUIs.
4. **Mobile last** (M14). Resume row from M10 is already the future mobile home.

---

## Architecture (don’t break)

```
crates/core     portable — MUST NOT depend on Tauri
apps/tauri      IPC glue only (assist, mux, sync, sftp, …)
apps/ui         React; ipc.ts is the ONLY invoke() surface
```

Hard rules: no secrets over IPC / in React state; session state in Rust by ID; host agents don’t become one; shell out to tmux/zellij; private keys device-local; passwords use `sync_secret`.

Tab × = **detach** (tmux lives). Sidebar Kill = **kill mux** + tombstone RunningSession.

---

## Known limitations

- Jump hosts metadata-only → **M13** (promote if blocking)
- Unsigned installers; private repo vs “open source” copy
- SFTP: no recursive folder transfer; queue not persisted
- `platform-ios` stub; keep aarch64-apple-ios CI green for M14
- Modal→PTY and layout↔activeId are regression-sensitive
- Assist Test on edit requires re-pasting the key (by design — never round-trip from vault)
- Scrollback is **same-device** IndexedDB only (cross-device deferred)
- BYOK: `byok_env` stored on agent presets but not injected at launch yet

---

## What to work on next

**M13 — Fleet** ([`ROADMAP-v3.md`](ROADMAP-v3.md)) — port forwarding, live `ProxyJump`, snippets, `FleetExec`.

Continue **M13 Fleet** when chrome is good enough, or deeper Track D polish /
materials tuning ([`docs/M12.5.md`](docs/M12.5.md)). Optional M12 leftovers: asciinema,
cross-device scrollback, BYOK launch injection, fuller agent seed as data-only PRs.

---

## Verify (smoke)

```bash
cargo test -p core --lib agents::
cargo test -p core --lib terminal::osc133::
cargo test -p core --features sync-http --lib catalog::
cargo check -p tethra
npm run build --prefix apps/ui
# full gate: scripts/ci-check.sh
```

---

## Doc map

| File | Role |
|---|---|
| [`HANDOFF.md`](HANDOFF.md) | This brief |
| [`ROADMAP-v3.md`](ROADMAP-v3.md) | **Canonical** plan |
| [`ROADMAP-v2.md`](ROADMAP-v2.md) | Historical (M6.2–M9); M10/M11 superseded |
| [`STATUS.md`](STATUS.md) | Engineering status |
| [`PROJECT.md`](PROJECT.md) | Architecture + hard rules + milestone summary |
| [`docs/M10.md`](docs/M10.md) | M10 launcher / workspace |
| [`docs/M11.md`](docs/M11.md) | M11 catalogs (BYOK deferred) |
| [`docs/M12.md`](docs/M12.md) | M12 terminal feel |
| [`docs/M12.5.md`](docs/M12.5.md) | Platform chrome (A–D spike; polish leftovers) |
| [`docs/UPDATES.md`](docs/UPDATES.md) | Self-update / mirror |
