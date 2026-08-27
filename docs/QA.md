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
