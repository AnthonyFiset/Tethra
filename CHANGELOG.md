# Changelog

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
