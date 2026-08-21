# Tethra

**Tethra** is an end-to-end encrypted SSH/SFTP vault client that **hosts coding
agents** across your machines — it is not an agent itself.

**Wedge:** persistent `tmux` / `zellij` sessions + vault sync reattach. Start an
agent on one device, resume it on another.

Desktop-first (macOS / Windows / Linux). Architected so mobile can be a port of
`crates/core`, not a rewrite.

## Install

Prebuilt installers: [GitHub Releases](https://github.com/AnthonyFiset/Tethra/releases).

macOS Gatekeeper may require `xattr -cr /Applications/Tethra.app` for unsigned
builds until Developer ID signing lands.

## Build from source

Requirements: **Rust** (stable), **Node 22+** (see [`.nvmrc`](.nvmrc)).

```bash
git clone https://github.com/AnthonyFiset/Tethra.git
cd Tethra
npm install --prefix apps/ui
cd apps/tauri/src-tauri
npx --prefix ../../ui tauri dev      # development
# npx --prefix ../../ui tauri build  # release bundle
```

Self-hosted vault sync (optional, Tailscale / LAN):

```bash
cargo build -p tethra-sync-server --release
./target/release/tethra-sync-server setup
```

See [`docs/milestones/M6.md`](docs/milestones/M6.md) and [`docs/UPDATES.md`](docs/UPDATES.md).

## Threat model (short)

| Protects | Does not protect |
|---|---|
| Host metadata at rest (master password) | Compromised remote host or local OS |
| Sync server sees ciphertext only | Active PTY session contents |
| Private keys stay device-local | Anything you type into a live shell |
| Passwords sync only with `sync_secret` | A leaked updater **private** signing key |

Fuller notes: [`SECURITY.md`](SECURITY.md).

## Docs

| Doc | Role |
|---|---|
| [`ROADMAP.md`](ROADMAP.md) | What’s done / what’s next (**only** status board) |
| [`NEXT.md`](NEXT.md) | Current engineering task |
| [`HANDOFF.md`](HANDOFF.md) | Agent brief: landmines, verify, release |
| [`PROJECT.md`](PROJECT.md) | Architecture + hard rules |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | How to contribute (catalogs first) |

## License

Licensed under the [Apache License 2.0](LICENSE).
