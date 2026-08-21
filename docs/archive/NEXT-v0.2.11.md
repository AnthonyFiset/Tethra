> **Completed.** Archived task brief.

# NEXT — v0.2.11: input correctness, tmux, copy sweep

> **Scope:** this release only. Do not start notifications, BYOK, Windows chrome,
> or design work — those are [`ROADMAP-v5.md`](ROADMAP-v5.md).
> Baseline: `main` @ `7252f06`, tag `v0.2.10`, repo public, GitHub-only updates.
>
> ⚠️ Read landmines 1 and 3 in [`HANDOFF.md`](HANDOFF.md) before touching any
> input path. This release is entirely in the regression-sensitive zone.

---

## 1. Paste requires refocus, then Enter twice 🐛

**Reported:** after pasting, the terminal doesn't have focus. Clicking it back,
then pressing Enter, does nothing — a second Enter runs the command.

**Hypothesis — one root cause, two symptoms:**

1. Paste (likely via the custom context menu from M12.5) leaves focus on the menu
   or its trigger. Radix returns focus to the *trigger element*, but xterm's
   focusable target is its hidden textarea, not the container div — so xterm never
   regains focus.
2. Clicking to refocus makes xterm emit its DA / OSC 10–11 replies through
   `onData`. The device-report filter sees them, arms the suppression window, and
   the first real Enter arrives inside that window and gets dropped.

**If that's right, fixing (1) removes (2)** — no click, no spurious report, no
armed gate. Verify the chain before patching both independently.

**Investigate in order:**

- `apps/ui/src/terminal/TerminalView.tsx` — context menu close handler; does it
  call `term.focus()`?
- `apps/ui/src/terminal/inject.ts` — `armShellInjectGate` scope and duration. Does
  the paste path arm it at all? Should it?
- `apps/ui/src/terminal/registry.ts` — `looksLikeDeviceReport` / `stripDeviceReports`
- Does ⌘V behave differently from right-click → Paste? **Test both.** If ⌘V is
  clean and only the menu path breaks, that confirms hypothesis (1) alone.

**Constraints:**

- **Do not widen the suppression window** to compensate. That reintroduces the
  v0.2.9 regression where lone C0 keys were swallowed.
- Do not add a parallel paste path. Route through `injectShellText`.
- Restore focus explicitly on menu close, targeting xterm's textarea.

**Regression tests required** (both, not either):

- Pure device reports are still dropped
- `\r`, `\t`, `\x03` pass through unconditionally, including immediately after a
  focus event

---

## 2. Bracketed paste — verify separately

While in here, confirm bracketed paste is actually working. Paste multi-line text
containing newlines into a plain shell:

- **Correct:** all lines land in the input buffer, nothing executes until Enter
- **Broken:** each newline executes its line

If broken, this is higher severity than §1 — it means pasting a code block into an
agent runs every line. Report before continuing.

---

## 3. tmux configuration 🐛 + polish

Tethra currently spawns tmux with inherited user config. Ship a minimal Tethra
config instead (don't modify the user's `~/.tmux.conf`).

```
set -g status off
set -g allow-passthrough on
set -sg escape-time 0
set -g focus-events on
set -g default-terminal "tmux-256color"
set -ga terminal-overrides ",*256col*:Tc"
```

**`allow-passthrough on` is a correctness fix, not cosmetics.** Without it tmux
swallows OSC 133 and OSC 52 — meaning block parsing and remote clipboard are
**currently broken inside every persistent session**, which is exactly the sessions
the product exists for. It degrades silently, which is why it hasn't been noticed.

`status off` removes the default green status bar — the loudest, least-designed
element on screen in a session.

**Verify after:** open a project session, run a failing command, confirm the OSC
133 error gutter appears. Then confirm OSC 52 copy from a remote host reaches the
local clipboard.

**Optional:** a Settings → Terminal toggle to re-enable a themed status bar,
generated from CSS tokens. Only if §1–§3 are done.

---

## 4. Copy sweep

Roadmap language shipped into the UI. Known instance in Quick Connect:

> "True one-off sessions without the vault land in a later slice."

Replace with: *"Connects immediately if it matches a saved host, otherwise opens
Add host prefilled."*

Then grep `apps/ui/src` for: `slice`, `deferred`, `milestone`, ` M1`, `TODO`,
`coming soon`, `not yet`. Rewrite anything user-facing in plain language.

---

## 5. Acceptance

- [ ] Paste (⌘V **and** right-click) leaves the terminal focused
- [ ] One Enter runs the pasted command
- [ ] Device reports still filtered; `\r` / `\t` / `\x03` still pass
- [ ] Multi-line paste doesn't auto-execute
- [ ] tmux status bar gone
- [ ] OSC 133 blocks render **inside** a tmux session
- [ ] OSC 52 from remote reaches local clipboard
- [ ] No roadmap language in the UI
- [ ] `scripts/ci-check.sh` green

---

## 6. Release

Tag `v0.2.11` and push. **Do not manually install.** All three machines are on
v0.2.10 with the rotated key — this is the first real auto-update test. Watch a
machine detect, download, and install on its own.

If that works, distribution is done.
