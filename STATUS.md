# Tethra — Project Status

_Snapshot for handoff / reassessment. Last updated after M5.6._

Tethra is a free, open-source, cross-platform SSH/SFTP client with an
end-to-end encrypted vault of saved hosts. Desktop-first (macOS/Windows/Linux),
architected so iOS/Android are a port, not a rewrite. See [`PROJECT.md`](PROJECT.md)
for the authoritative architecture and hard rules.

- **Repo:** https://github.com/AnthonyFiset/Tethra (private)
- **Branch:** `main` with M5.6 changes in the current working tree
- **Stack:** Tauri v2, Rust 2024, React + TypeScript + Vite, Tailwind v4 + Radix + cmdk + lucide, `russh` / `russh-sftp`, `rusqlite`, Argon2id + XChaCha20-Poly1305
- **Toolchain:** Node 20+ required (see `.nvmrc`); Tailwind's `@tailwindcss/oxide` native binary is skipped on older Node, which silently produces a stylesheet with no utility classes

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
| **M6** | Sync — `FileBackend` first (iCloud/Dropbox/git folder), then `HttpBackend` | Not started |
| **M7** | Power features: port forwarding, live jump hosts, snippets, multi-host broadcast | Not started |
| **M8** | Mobile: `platform-ios` shim, layout fixes; core should need zero changes | Not started |

---

## Architecture at a glance

```
crates/
  core/                 portable product logic; MUST NOT depend on Tauri
    src/
      model/            Host, Identity, auth types
      vault/            kdf, crypto, store, repository, records
      ssh/              session manager, handler, pty, exec, sftp, approval, fingerprint
      ssh_config.rs     ~/.ssh/config parsing
      sync/             SyncBackend trait + LocalOnly (FileBackend/HttpBackend TODO)
      error.rs
  platform/             trait definitions only (including LocalPty)
  platform-desktop/     keyring, paths, power monitor, portable-pty local terminal
  platform-ios/         stub
apps/
  tauri/src-tauri/      command glue only
    src/lib.rs          vault + host + terminal + SFTP commands, session lifecycle
    src/output_pump.rs  shared SSH/local terminal batching and backpressure
    src/local_fs.rs     local filesystem commands for SFTP left pane
    src/sftp.rs         SFTP browser sessions + transfer tasks
  ui/                   React app
    src/lib/ipc.ts      the ONLY file that calls invoke()
    src/terminal/       xterm registry + shared SSH/local terminal view
    src/components/     logo and command palette
    src/sftp/           SftpBrowser, FilePane, TransferQueuePanel, queue runner, path helpers
    src/vault/          VaultGate, ChangePasswordModal
    src/hosts/          HostFormModal, SshConfigImportModal
docs/                   M1.md .. M5.5.md
```

### Hard rules being enforced
- `crates/core` never depends on Tauri (CI checks the dep tree).
- No platform APIs in `core`; access via `platform` traits.
- Plaintext secrets never cross IPC; frontend refers to hosts by ID only.
- No secrets in `localStorage` / `sessionStorage` / `IndexedDB` / React state.
- Tabs and panes are frontend state, not OS windows.
- Layout collapses to single column under 768px.
- Key material zeroizes on drop; `#![forbid(unsafe_code)]` in `core`.
- `ipc.ts` is the sole `invoke()` surface; TS types generated via `ts-rs`.

---

## What M5 added (most recent work)

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

### Housekeeping
- Removed the unused `AppIcons/` pack; canonical icons live in
  `apps/tauri/src-tauri/icons/`. Dock icon rebuilt on Apple's grid (transparent
  squircle) earlier in the session.

---

## Known limitations / deferred

- **SFTP:** folder (recursive) transfers not supported; the transfer queue is not
  persisted across app restarts; resume only applies to partial files retained in
  the current session.
- **Sync (M6):** only `LocalOnly` exists; `FileBackend` and `HttpBackend` are TODO.
- **Jump hosts:** `ProxyJump` is stored as metadata; live routing is M7.
- **Private keys:** host metadata is the sync target; private-key identities stay
  device-local (key sync is a deferred opt-in).
- **Power monitor:** macOS observer is a best-effort stub; idle-timer lock is the
  primary path.
- **Mobile:** `platform-ios` is a stub; no mobile build yet.
- **macOS distribution:** native sidebar vibrancy uses Tauri's
  `macos-private-api` feature, which is compatible with direct distribution but
  must be removed or replaced before a Mac App Store submission.

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
cargo clippy --workspace --all-targets --features cli -- -D warnings
cargo test -p core --lib --bins
cargo test -p tethra
cargo test -p tethra export_bindings
git diff --exit-code -- apps/ui/src/lib/generated
npm run build --prefix apps/ui
cargo check -p core --target aarch64-apple-ios          # iOS portability guard
cargo tree -p core --edges normal --prefix none | grep -qE '^(tauri|wry|tao)' && echo FAIL || echo OK

# Docker-backed SSH/SFTP integration tests
docker compose -f crates/core/tests/docker-compose.yml up -d
cargo test -p core --test ssh_integration -- --ignored --test-threads=1 --nocapture
docker compose -f crates/core/tests/docker-compose.yml down -v
```

The local CI-equivalent commands pass on the M5.5 working tree. The existing
Docker suite remains the M5 regression check (6 tests, including SFTP
mkdir/rename/remove and progress/cancel/resume).

---

## Suggested next step

**M6 — Sync, starting with `FileBackend`.** The seam already exists
(`SyncBackend` trait + `LocalOnly` in [`crates/core/src/sync/mod.rs`](crates/core/src/sync/mod.rs)),
and item-level encryption from M3 was designed for per-item conflict resolution.
`FileBackend` (a user-pointed directory: iCloud Drive, Dropbox, or a git repo)
needs zero infrastructure and is genuinely free before any hosted server.

Optional quick wins: add a README + LICENSE and flip the repo public, since
`PROJECT.md` frames Tethra as open source.
