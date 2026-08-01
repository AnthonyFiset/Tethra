# Tethra — Project Status

_Snapshot for handoff / reassessment. Last updated for **v0.2.6** (M10–M12 + polish
audit). Strategy brief: [`HANDOFF.md`](HANDOFF.md).
**Canonical plan:** [`ROADMAP-v3.md`](ROADMAP-v3.md) (v2 kept for M6.2–M9 history)._

Tethra is a free, open-source, cross-platform SSH/SFTP client with an
end-to-end encrypted vault of saved hosts — and a host for coding agents on
every machine you own. Desktop-first (macOS/Windows/Linux), architected so
iOS/Android are a port, not a rewrite. See [`PROJECT.md`](PROJECT.md) for
architecture and hard rules; [`ROADMAP-v3.md`](ROADMAP-v3.md) for what to build
next.

- **Repo:** https://github.com/AnthonyFiset/Tethra (private)
- **Branch:** `main`; latest shipped tag `v0.2.6`
- **Stack:** Tauri v2, Rust 2024, React + TypeScript + Vite, Tailwind v4 + Radix + cmdk + lucide, `russh` / `russh-sftp`, `rusqlite`, Argon2id + XChaCha20-Poly1305
- **Toolchain:** Node 22 in CI (see `.nvmrc`); Tailwind's `@tailwindcss/oxide` native binary is skipped on older Node, which silently produces a stylesheet with no utility classes (CI guards against this)

---

## Milestone progress

| Milestone | Scope | Status |
|---|---|---|
| **M1** | Headless portable core: SSH connect, PTY, exec, SFTP list/get/put | Done |
| **M2** | Tauri desktop shell, xterm.js, batched PTY output, tabs, responsive layout | Done |
| **M3** | Encrypted vault: Argon2id + HKDF + XChaCha20-Poly1305, lock/unlock, keyring recovery, host CRUD | Done |
| **M4** | `~/.ssh/config` import into the vault (`russh-config`, ProxyJump preserved as metadata) | Done |
| **M5** | Dual-pane SFTP browser, file management, drag/drop, transfer queue with pause/resume | Done |
| **M5.5** | Stable identity, local terminal, host colors, branding, sidebar rail, command palette, native polish | Done |
| **M5.6** | UI overhaul: Tailwind v4 design tokens, Radix primitives, icon rail, native menu, window drag fix | Done |
| **M6** | Sync — `FileBackend`, `HttpBackend`, ThinkPad sync server, release installers | Done |
| **M6.1** | Sync hardening: in-app vault join/reset, tag-driven versions, self-update via sync host, CI cleanup | Done |
| **M6.2** | Sync you don't think about: `sync_secret`, background sync, coordinated re-key, iOS CI, auto-mirror | Done |
| **M7** | Real terminal: conformance (alt screen, truecolor, paste, OSC 52/7, mouse), OSC 133 blocks, splits / multi-window | Done |
| **M8** | Projects and agents: `Project` + `AgentSpec`, open→cd→launch, tmux persistence, cross-device reattach | Done |
| **M9** | Assist: NL→command in input, ApprovalGate, pluggable providers, vault API keys | Done |
| **M10** | Launcher + workspace (Resume-first dashboard; sidebar only in Workspace) | **Done** — see `docs/M10.md` |
| **M11** | Provider + agent catalogs (data, not compiled); paste-key / `GET /models` UX | **Done** — M11.1–11.3 (`docs/M11.md`); BYOK launch deferred |
| **M12** | Terminal feel: OSC 133 blocks UI, scroll-jump, fonts, reattach scrollback | **Done** (core) — M12.1–12.4 (`docs/M12.md`); asciinema / ligatures / cross-device scrollback optional |
| **M13** | Fleet: port forwarding, live jump hosts, snippets, `FleetExec` (was v2 M10) | Not started |
| **M14** | Mobile: reattach/monitor agents (deferred; was v2 M11) | Deferred |

---

## Architecture at a glance

```
crates/
  core/                 portable product logic; MUST NOT depend on Tauri
    src/
      model/            Host, Identity, auth types
      vault/            kdf, crypto, store, repository, records (+ reset)
      ssh/              session manager, handler, pty, exec, sftp, approval, fingerprint
      ssh_config.rs     ~/.ssh/config parsing
      terminal/         OSC 133 parser, shell-integration scripts/wrappers
      assist/           NL→command providers; ApprovalGate AssistInsert
      sync/             SyncBackend, FileBackend, HttpBackend, SyncEngine, conflict
      error.rs
  sync-server/          tethra-sync-server: HTTP sync + update mirror for Tailscale hosts
    src/server.rs       axum routes: sync + /updates/* + /healthz
    src/mirror.rs       gh-backed release-asset mirror (fetch-updates)
    src/updates.rs      update manifest model + version compare
  platform/             trait definitions only (including LocalPty)
  platform-desktop/     keyring, paths, power monitor, portable-pty local terminal
  platform-ios/         stub
apps/
  tauri/src-tauri/      command glue only
    src/lib.rs          vault + host + terminal + SFTP + sync + updater commands
    src/assist.rs       Assist propose/explain + vault API key CRUD
    src/mux.rs          probe tools, ensure/kill mux, prune stale RunningSessions
    src/sync.rs         sync settings, folder picker, HTTP configure, join, sync-now
    src/updater.rs      self-update; endpoint derived from sync server URL
    src/output_pump.rs  shared SSH/local terminal batching; OSC 133 + app-wide emit
    src/shell_integration.rs  local shell wrapper (OSC 133 / OSC 7)
    src/local_fs.rs     local filesystem commands for SFTP left pane
    src/sftp.rs         SFTP browser sessions + transfer tasks
  ui/                   React app
    src/lib/ipc.ts      the ONLY file that calls invoke()
    src/terminal/       xterm registry + shared SSH/local terminal view
    src/components/     logo, command palette, AssistBar, AssistSettingsModal, SyncSettingsModal, UpdateBanner
    src/sftp/           SftpBrowser, FilePane, TransferQueuePanel, queue runner, path helpers
    src/vault/          VaultGate (create/unlock/recover/join), ChangePasswordModal
    src/hosts/          HostFormModal, SshConfigImportModal
    src/projects/       ProjectFormModal, PathBrowser, launch helpers
scripts/
  set-version.mjs       stamp one version across all manifests from the git tag
docs/                   M1.md .. M10.md, M6.2.md, UPDATES.md; root HANDOFF.md + ROADMAP-v3.md
.github/workflows/      ci.yml + release.yml (dmg / exe / deb + updater artifacts on tag)
```

### Hard rules being enforced
- `crates/core` never depends on Tauri (CI checks the dep tree).
- No platform APIs in `core`; access via `platform` traits.
- Plaintext secrets never cross IPC; frontend refers to hosts by ID only.
- No secrets in `localStorage` / `sessionStorage` / `IndexedDB` / React state.
- Session state in Rust by session ID; tab/pane layout is frontend state; OS
  windows are a desktop-only presentation layer (closing a window must not kill
  sessions). See `PROJECT.md` hard rule 5 / M7.
- Layout collapses to single column under 768px.
- Key material zeroizes on drop; `#![forbid(unsafe_code)]` in `core`.
- `ipc.ts` is the sole `invoke()` surface; TS types generated via `ts-rs`.
- Sync moves host ciphertext; password identities stay `local_only` unless the
  per-identity `sync_secret` opt-in is on (M6.2).
- Every device shares one vault key: the sync header's wrapped key is the source
  of truth; a device must join (adopt the header) rather than create its own vault.
  Coordinated re-key (M6.2) publishes a `rekey_from` attestation so peers adopt a
  new password wrap without reset.

---

## What M9 + v0.2.5 session polish added (most recent)

See [`docs/M9.md`](docs/M9.md) and [`HANDOFF.md`](HANDOFF.md).

- **Assist:** Cmd/Ctrl+I bar; propose / explain; insert without Enter;
  `ApprovalGate::AssistInsert`; Anthropic / OpenAI / OpenAI-compat providers;
  vault API keys with `sync_secret`.
- **Mux semantics:** tab close = detach only; sidebar Kill = kill mux + tombstone
  `RunningSession`.
- **Tools probe:** OS-aware missing-tool dialog with Copy / Insert / Insert & run;
  install insert gated so DA/mouse/OSC replies cannot prepend junk.
- **Tab focus:** opening or selecting a session always shows that session’s pane
  (`activateSession` + `activeId`-driven layout + safe xterm attach).

---

## What M8 added

See [`docs/M8.md`](docs/M8.md).

- **Project + AgentSpec** vault models; open = connect → cd → launch agent.
- **tmux / zellij** persistence for `persistent` agents (local + remote).
- **Running sessions** sidebar + cross-device reattach via vault markers.
- Built-in agent presets (shell, Claude Code, Codex, aider, …) as data.

---

## What M7 added

See [`docs/M7.md`](docs/M7.md).

- **Conformance:** OSC 52 clipboard, Unicode 11 widths, bracketed paste, OSC 7
  cwd, truecolor env.
- **OSC 133:** streaming parser in `core`; block events on the app-wide
  `terminal-event` bus (beside raw bytes).
- **Shell integration:** connect wrapper + per-host Auto/Disabled preference.
- **Splits:** layout tree with resize sash and zoom; single-column under 768px.
- **Multi-window:** new / move-tab windows; closing a secondary window reclaims
  tabs to main without killing Rust sessions.

---

## What M6.2 added

See [`docs/M6.2.md`](docs/M6.2.md).

- **`sync_secret`:** opt-in password identity sync (default off); host form checkbox.
- **Background sync:** debounce after mutations/unlock, 5-minute interval, focus/
  visibility refresh; Sync now kept as a certainty action.
- **Coordinated re-key:** `rekey_from` attestation on the shared header so peers
  adopt a master-password change on next sync.
- **iOS CI:** `macos-latest` job runs `cargo check -p core --target aarch64-apple-ios`.
- **Auto-mirror:** `tethra-sync-server install-updates-timer` (+ wizard prompt).

---

## What M6.1 added

### Sync correctness — [`crates/core/src/sync/engine.rs`](crates/core/src/sync/engine.rs)
- `publish_header` no longer blindly overwrites the shared header; it seeds an
  empty backend and otherwise refuses when the local vault key differs, so a
  second device can't strand the others' ciphertext.
- `header_matches_backend` + a clear `Error::Sync` ("created separately") instead
  of a raw AEAD failure.
- `Vault::reset()` wipes items, header, and keyring recovery secret so a device
  can abandon its own vault and join the synced one.
- Regression test: `separately_created_vault_refuses_to_clobber_header`.

### Join flow — desktop + UI
- `sync_join_http` (with `reset_existing`) adopts the shared header before a
  vault exists, and bootstraps at startup when sync is already configured.
- **Join a synced vault** is always reachable on the welcome screen, even when a
  vault exists, with a confirmed **Replace this device's vault and join**.
- The same reset-and-join action appears on the sync mismatch error in
  `SyncSettingsModal`. No more deleting `vault.sqlite3` by hand.

### Versioning — [`scripts/set-version.mjs`](scripts/set-version.mjs)
- One idempotent script stamps `tauri.conf.json`, `package.json`,
  `package-lock.json`, and workspace `Cargo.toml` from the git tag; CI runs it on
  every release so shipped binaries match the tag (fixes v0.1.1 shipping as 0.1.0).

### Self-update — [`apps/tauri/src-tauri/src/updater.rs`](apps/tauri/src-tauri/src/updater.rs) + [`crates/sync-server`](crates/sync-server)
- `tauri-plugin-updater` + `tauri-plugin-process`; updater artifacts signed in CI
  with `TAURI_SIGNING_PRIVATE_KEY` (public key in `tauri.conf.json`).
- Clients derive the update endpoint from their configured HTTP sync server, so
  updates are zero-config. `UpdateBanner` offers "Update and restart".
- The sync server mirrors release assets via `gh` (`fetch-updates`) and serves
  `GET /updates/{target}/{arch}/{current_version}` + `/updates/download/{file}`;
  private-repo assets never need a client credential. See [`docs/UPDATES.md`](docs/UPDATES.md).
- `dangerousInsecureTransportProtocol` is enabled because the tailnet host is
  plain HTTP; payloads are minisign-verified on-device, so transport isn't trusted.

### Startup/crash fixes
- `#![windows_subsystem = "windows"]` (release) removes the blank console window
  on Windows launch.
- The updater's release-only https check was crashing the app at startup with an
  http endpoint; fixed and verified by running the release binary both ways.

### CI/CD cleanup — `.github/workflows/`
- Removed the `aarch64-apple-ios` compile check (never worked on Ubuntu — no
  `xcrun`) and the `--features cli` clippy flag.
- Dropped the Intel Mac (`macos-13`) release target; release now builds Apple
  Silicon `.dmg`, Windows NSIS `.exe`, Linux `.deb`/AppImage, and the sync-server
  binary — plus signed updater artifacts.
- Idempotent version stamping; cancelled the old stuck/failed runs.

---

## What M6 added

### Core — [`crates/core/src/sync/`](crates/core/src/sync/)
- `FileBackend` layout: `manifest.json`, `vault-header.json`, `items/<uuid>.json`
- `HttpBackend` (feature `sync-http`) for self-hosted sync
- `SyncEngine` vault-header bootstrap + LWW conflict resolution
- Hosts sync; password identities stay device-local

### Sync server — [`crates/sync-server`](crates/sync-server)
- `tethra-sync-server` for Ubuntu/ThinkPad over Tailscale, setup wizard + status
  TUI + systemd user unit; optional `--token` / `TETHRA_SYNC_TOKEN`

### Desktop + UI
- Configure shared folder or HTTP URL+token; Sync now / Disable
- **Vault sync** in the ⋯ menu and command palette

See [`docs/M6.md`](docs/M6.md).

---

## What M5 added

### Core — [`crates/core/src/ssh/sftp.rs`](crates/core/src/ssh/sftp.rs)
- Directory entries now include modification time; added `stat`, `mkdir`,
  `rename`, `remove_file`, `remove_dir`.
- `get_with` / `put_with`: byte-offset transfers with a progress callback and a
  cooperative `TransferControl` cancel handle.
- Resume: downloads seek both files to the retained local size; uploads seek
  locally and write remotely from the retained offset without truncating.
- New `Error::TransferCancelled`. Types re-exported from
  [`crates/core/src/ssh/mod.rs`](crates/core/src/ssh/mod.rs).
- Integration tests in [`crates/core/tests/ssh_integration.rs`](crates/core/tests/ssh_integration.rs):
  `sftp_mkdir_rename_remove` and `sftp_transfer_progress_cancel_and_resume`
  (byte-for-byte resume verified against a Docker openssh-server).

### Desktop IPC
- [`apps/tauri/src-tauri/src/local_fs.rs`](apps/tauri/src-tauri/src/local_fs.rs):
  local home, list, mkdir, rename, recursive-safe remove (rejects `..`, does not
  follow symlinks during recursive delete).
- [`apps/tauri/src-tauri/src/sftp.rs`](apps/tauri/src-tauri/src/sftp.rs):
  persistent browser SFTP sessions keyed by session ID, remote list/canonicalize/
  mkdir/rename/remove, and `sftp_transfer` (a dedicated SFTP connection per active
  transfer with a progress `Channel`) plus `sftp_cancel_transfer`.
- Vault lock, idle auto-lock, and suspend all cancel active transfers and close
  SFTP sessions alongside PTY sessions.
- Home directory exposed from [`crates/platform-desktop/src/lib.rs`](crates/platform-desktop/src/lib.rs).

### Frontend — [`apps/ui/src/sftp/`](apps/ui/src/sftp/)
- `SftpBrowser.tsx`, `FilePane.tsx`, `TransferQueuePanel.tsx`, plus
  `transferQueue.ts` (sequential runner) and `path.ts` helpers.
- Tabs generalized to `terminal | sftp` in [`apps/ui/src/App.tsx`](apps/ui/src/App.tsx);
  a **Files** action opens an SFTP tab, and closing a tab closes the right backend session.
- Dual pane (local home | remote `.`), navigation, refresh, sort, create folder,
  rename, confirmed delete, drag/drop between panes, upload/download selected,
  and a transfer queue with progress, pause, resume, retry, cancel.
- Responsive: side-by-side panes on desktop, stacked below 768px.

---

## Known limitations / deferred

- **SFTP:** folder (recursive) transfers not supported; the transfer queue is not
  persisted across restarts; resume only applies to partial files retained in the
  current session.
- **Signing key:** updater private key lives at `~/.tethra-updater.key` on the
  machine that generated it and as a repo secret — losing it forces manual
  reinstalls of every client.
- **Jump hosts:** `ProxyJump` is stored as metadata; live routing is **M13**
  (promote above M12 only if jump is blocking today — see `ROADMAP-v3.md`).
- **Private keys:** host metadata is the sync target; private-key identities stay
  device-local (key sync is a deferred opt-in; passwords use `sync_secret`).
- **Terminal / projects / Assist:** M7–M9 done — see `docs/M7.md`, `docs/M8.md`,
  `docs/M9.md`, and `HANDOFF.md`.
- **xterm.js:** stay; M12.2 mitigates agent TUI scroll-jump; M12.4 restores
  same-device project scrollback via serialize + IndexedDB. Cross-device snapshot
  sync still open.
- **Radix:** stay; do not migrate to Base UI unless a specific bug forces it.
- **Power monitor:** macOS observer is a best-effort stub; idle-timer lock is the
  primary path.
- **Mobile:** `platform-ios` is a stub — **M14** (deferred). Keep
  `cargo check -p core --target aarch64-apple-ios` green.
- **Code signing:** installers are unsigned — macOS needs `xattr -cr` / Gatekeeper
  override, Windows shows SmartScreen. Tied to public-repo decision in v3.
- **macOS distribution:** native sidebar vibrancy uses Tauri's `macos-private-api`,
  compatible with direct distribution but must be removed before a Mac App Store
  submission.
- **Agent/provider presets:** **M11.1–11.3** ship bundled provider + agent
  catalogs; BYOK env injection and sync-server catalog fetch remain follow-ups.

---

## What M5.5 added

- Pinned the existing keyring service (`app.tethra.desktop`), app directory
  (`tethra`), recovery-key account, and bundle identifier with regression tests;
  no data-moving identity migration was introduced.
- Renamed the desktop Cargo package/binary to `tethra` and library to
  `tethra_lib`; added the Tauri mobile entry-point attribute.
- Added the platform-neutral `LocalPty` API, a `portable-pty` desktop adapter,
  iOS unsupported stub, real PTY roundtrip test, and local terminal IPC.
- SSH and local terminals share one bounded output pump. Vault lock closes
  remote terminal/SFTP sessions while local terminal tabs remain alive behind
  the lock screen.
- Host colors now round-trip through encrypted records, summaries, generated
  IPC types, and the host editor. They identify host cards, tab hairlines, and
  terminal viewports.
- Added a reusable SVG Tethra logo, favicon, vault/empty/about placements,
  persistent expanded/rail sidebar, `Cmd/Ctrl+B`, and a fuzzy command palette
  on `Cmd/Ctrl+K`.
- Added macOS overlay titlebar, traffic-light-safe spacing, sidebar vibrancy,
  keyboard focus treatment, reduced-motion support, and mobile rail overrides.

---

## How to run & verify

```bash
# Run the desktop app
cd apps/tauri/src-tauri
npx --prefix ../../ui tauri dev

# Full local CI-equivalent (from repo root)
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test -p core --lib --bins
cargo test -p tethra
cargo test -p tethra export_bindings
git diff --exit-code -- apps/ui/src/lib/generated
npm run build --prefix apps/ui
cargo tree -p core --edges normal --prefix none | grep -qE '^(tauri|wry|tao)' && echo FAIL || echo OK

# Docker-backed SSH/SFTP integration tests
docker compose -f crates/core/tests/docker-compose.yml up -d
cargo test -p core --test ssh_integration -- --ignored --test-threads=1 --nocapture
docker compose -f crates/core/tests/docker-compose.yml down -v
```

## Release & update flow

```bash
# 1. Cut a release (CI stamps version, builds installers, signs updater artifacts)
git tag v0.2.5 && git push origin v0.2.5
# 2. Publish the draft release on GitHub (gh only sees published releases)
# 3. On the sync host, mirror it for clients:
tethra-sync-server fetch-updates
# 4. Clients with HTTP sync configured show "Update and restart" on next launch
```

---

## Suggested next step

**M13 — Fleet** (port forward, live ProxyJump, snippets, `FleetExec`) unless you
want optional **M12.5 asciinema** or ligature toggle first
([`ROADMAP-v3.md`](ROADMAP-v3.md), [`docs/M12.md`](docs/M12.md)).

Strategy brief: [`HANDOFF.md`](HANDOFF.md).

On the ThinkPad after v0.2.5 publishes:
`tethra-sync-server fetch-updates` (and `install-updates-timer` if not already).

Open decisions (v3): public vs private repo; catalog hosting (ThinkPad-only vs
public URL).
