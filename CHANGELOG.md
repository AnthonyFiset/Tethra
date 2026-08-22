# Changelog

## v0.4.0

- **Windows Authenticode:** installers signed via Azure Artifact Signing (Biz Inbound Inc.) when release secrets are present.
- **Terminal find:** ⌘F (macOS) / Ctrl+Shift+F find bar via `@xterm/addon-search`.
- **SFTP recursive folder transfer:** upload/download directory trees with aggregate progress.
- **Port forwarding:** local (`-L`) and remote (`-R`) tunnels on the host, with auto-start and live session controls.
- **SSH agent forwarding:** per-host opt-in (default off); proxies the local agent into the remote session without reading keys.
