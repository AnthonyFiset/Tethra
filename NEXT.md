# NEXT — v0.4.0 step 2 of 4: terminal search (⌘F) + SFTP recursive transfer

> **v0.4.0 rollout:** 1. ✅ Windows code signing (CI wired; beta tag verifies)
> · **2. this brief** · 3. port forwarding · 4. SSH agent forwarding → stamp +
> release v0.4.0.
>
> **Scope:** these two features only. Do not start port forwarding, agent
> forwarding, or the release stamp. No changes to `inject.ts` / `registry.ts`
> input paths. Baseline: `main` at `8641922`.
>
> **Why:** ROADMAP Part 4 — "signing, port forwarding, SFTP recursive, and ⌘F
> are what make the app usable by someone who isn't you." Both are table
> stakes every terminal/SFTP client has and we don't.

---

## 1. Terminal search (⌘F)

- `@xterm/addon-search` wired into our terminal component.
- **Shortcut:** ⌘F (macOS) / Ctrl+Shift+F (Windows/Linux — plain Ctrl+F must
  keep going to the shell). Route through the existing keyboard/registry
  system's conventions for app-level shortcuts, without touching the input
  paths named above.
- Find bar overlaid at the top-right of the terminal pane: input, match
  count ("3 of 17"), next/prev (Enter / Shift+Enter + buttons), case toggle,
  Esc or ✕ closes and returns focus to the terminal.
- Searches the full scrollback, decorations highlight all matches, current
  match distinct (use the app's accent tokens).
- Works in both attached SSH sessions and local terminals; no behavior change
  when the bar is closed.

## 2. SFTP recursive folder transfer

Today single files only. Add directory upload and download:

- Selecting a folder (either pane) enables the same transfer actions files
  have; drag-and-drop of a folder works where file drag-drop works today.
- Walk the tree Rust-side (`russh-sftp`): create directories as needed,
  transfer files sequentially or with a small bounded concurrency — keep it
  simple and cancellable.
- **Progress:** extend the existing `TransferEvent` flow — aggregate
  (files done / total, bytes done / total) plus the current file name.
  One cancel action cancels the whole tree cleanly.
- **Failure policy:** a single file failing (permissions, vanished mid-walk)
  records the error and continues; at the end surface "N of M failed" with
  the list. Do not abort the whole tree on one failure.
- **Safety rails:** don't follow symlinks (skip + note them); refuse to
  download into a directory that would overwrite the source path itself;
  existing single-file overwrite semantics apply per file.
- Resume for interrupted trees is NOT required (existing per-file resume
  stays as-is); cancelled transfers leave partial trees — acceptable, noted
  in the completion message.

## Acceptance

1. ⌘F in a session with long scrollback: type a term → count + highlights;
   Enter cycles; Esc returns to typing in the shell with no stray input.
2. Upload a nested folder (≥3 levels, ≥20 files) to `tethra-vm`, download it
   back to a new location; both show aggregate progress, cancel works
   mid-tree, contents byte-identical (spot-check).
3. A tree with one unreadable file completes with "1 of N failed" and lists
   the failure, rest transferred.
4. `scripts/ci-check.sh` green; generated DTO bindings updated if
   `TransferEvent` changes.

## Do NOT

- Port forwarding or SSH agent forwarding (briefs 3–4)
- Stamp v0.4.0
- Cross-host command history search (v0.5.0)
- Touch sync-server, vault, signing workflow, or updater
