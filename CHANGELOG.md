# Changelog

## v0.5.0

The visual overhaul: Warp-style blocks × Termius-style organization, verified
in the real app (WKWebView), not just the browser harness.

- **Command blocks:** every command renders as a block with a chrome header
  (cwd · duration · time · command) via OSC 133 shell integration — bash menu
  completion, optimistic echo, masked input, apt/npm streams, and `/clear` all
  block-correct under a torture QA suite.
- **Invisible tmux persistence:** every host tab is a named tmux session that
  survives the app closing; reattach looks like Warp, not like tmux (status
  off, passthrough marks, stale-session migration, no reattach duplication).
- **Full-screen apps own the session:** Claude Code / vim / htop hide the
  prompt panel and block chrome, which return when the app exits. DEC 2026
  sync-block ED2 rewrite kills the agent-TUI scroll-jump.
- **Terminal rendering correctness:** generated full-cell block-element font
  (`Tethra Blocks`, U+2580–259F) so agent logos and TUI bars render without
  background stripes (xterm 6's renderer takes them from the font, which only
  inks the em); lineHeight default 1.0; FitAddon padding contract fixed so the
  bottom/right rows never clip; post-attach sweep drops tmux replay junk from
  scrollback; viewport pinned to the app background ramp.
- **Home & workspace reorganization:** Overview rail, card language across
  every surface, group cards with filter state, hero live filter, palette +
  menus restyled, session sidebar with SFTP tabs, Finder drag-in uploads
  (through `ipc.ts`), brand-accented native controls.
- **Session restore:** page reload / app restart reattaches project tabs and
  host sessions with ordered PTY writes and intact scrollback sync.
- **Real-app QA harness:** `scripts/app-drive.mjs` + a DEV-only bridge drive
  the live WKWebView (eval, snapshots, native keys, window captures) — the
  mock harness alone no longer gates terminal work (docs/QA.md §1a).

## v0.4.1

- **Settings vs surfaces:** Settings trimmed to preferences only; workflow features promoted to first-class surfaces (Vault, Assist, Agents, Identities) with titlebar nav and command-palette shortcuts.
- **Dialog scrolling:** Every dialog capped at 85vh with a fixed header/footer and a single scrolling body — fixes host form clipping on short windows.
- **Narrow-window nav:** Surface nav collapses to a dropdown below 1000px.
- **dev:web harness:** `npm run dev:web` runs the UI in the browser with deterministic mock IPC for design review and future e2e.

## v0.4.0

- **Windows Authenticode:** installers signed via Azure Artifact Signing (Biz Inbound Inc.) when release secrets are present.
- **Terminal find:** ⌘F (macOS) / Ctrl+Shift+F find bar via `@xterm/addon-search`.
- **SFTP recursive folder transfer:** upload/download directory trees with aggregate progress.
- **Port forwarding:** local (`-L`) and remote (`-R`) tunnels on the host, with auto-start and live session controls.
- **SSH agent forwarding:** per-host opt-in (default off); proxies the local agent into the remote session without reading keys.
