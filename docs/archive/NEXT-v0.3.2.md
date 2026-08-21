# NEXT — v0.3.2: agent notifications + click-through installs + release

> **Scope:** this brief ships **v0.3.2**. Three parts, in order: (1) agent
> notifications, (2) no-prerequisite agent installs, (3) stamp + release.
> Do not start SSH agent forwarding, port forwarding, command history search,
> accounts/Stripe, or Windows chrome — later briefs. No changes to
> `inject.ts` / `registry.ts` input paths.
> Baseline: `main` at `4e5347b` (SSH key identities + opt-in key sync, already
> merged and green — they ride this release).
>
> **Why now:** persistence works (tmux sessions survive detach; hosted sync is
> live) but agents wait silently for input until Anthony goes looking.
> Notifications are what make persistence *useful* — ROADMAP §3.1 calls this
> the highest-value thing left. Full design lives there; this brief is the
> build order.

---

## 1. Agent notifications (ROADMAP §3.1 — follow its spec)

**States per running session:** `running` → `waiting` → `done` / `failed`.

**Attached sessions** (Tethra is reading the PTY) — layer the signals:
- BEL (`\a`) → `waiting` (Claude Code emits this when it wants attention)
- OSC 9 / OSC 777 → `waiting`, use the message text when present
- OSC 133;D with exit code → `done` (0) / `failed` (non-zero) for plain commands
- Output silence > N seconds while the foreground process is alive → `waiting`
  (heuristic; N tunable, default ~30s; lowest-priority signal, never overrides
  an explicit one)

**Detached sessions — the point of the feature.** Prototype the tmux-native
approach first (roadmap approach 1): `monitor-bell` / `monitor-silence` +
`set-hook` on `alert-bell` / `alert-silence` invoking a small ping back to
Tethra for that session id. Notes:
- The hook must work when Tethra isn't reading the PTY; on next attach/refresh
  Tethra reconciles real state.
- Hooks are set up when Tethra creates or adopts a session, and are idempotent
  (re-running setup must not stack duplicate hooks).
- If the tmux on the host is too old for hooks, degrade gracefully: attached
  detection still works; detached shows "no watch on this host" rather than
  silently pretending.
- Approach 2 (persistent monitor connection) only if hooks prove unworkable —
  document why in the PR if so.

**Surfaces:**
- Native desktop notification (`tauri-plugin-notification`) on `waiting` and
  `failed`; click focuses Tethra and jumps to that session.
- Running list: state chip per session (`running` / `waiting` / `done` /
  `failed`).
- App badge: count of sessions in `waiting`/`failed` (macOS dock now; Windows
  overlay when the Windows chrome brief lands).

**Settings (keep minimal):** global toggles — notify on waiting / on done / on
failed (defaults: waiting ✅, failed ✅, done ❌). Per-agent overrides and quiet
hours are **out of scope** this release.

## 2. Click-through installs (kill the Node prerequisite)

The tools dialog already probes and offers Run/Copy/insert. Fix the hints so
they actually work on a bare box:
- `crates/core/data/agents.json`: Claude Code → native installer
  (`curl -fsSL https://claude.ai/install.sh | bash` on macOS/Linux; the
  PowerShell equivalent on Windows). Check Codex / Gemini / opencode for
  native installers too; where none exists, keep npm **and** probe for the
  prerequisite: if `npm`/`node` is missing, the dialog lists Node first
  (platform-correct install hint) instead of letting `npm install -g` fail.
- Keep existing catalog tests updated (`agents::catalog::tests`).
- Acceptance is on a real box: fresh `tethra-vm` (Ubuntu, nothing installed) →
  add host → open project → the dialog alone gets tmux + Claude Code running,
  no manual terminal session outside Tethra.

## 3. Release v0.3.2

- Stamp `0.3.2` everywhere `0.3.1` is stamped today (Cargo, tauri conf,
  package.json — follow the pattern of commit `73ba369`).
- Changelog entry: SSH key identities + opt-in key sync, agent notifications,
  click-through installs.
- Tag and run the existing release workflow; installers publish as on v0.3.1.
  No updater/signing changes.

## Acceptance (the demo)

1. From the installed v0.3.2 app: connect to `tethra-vm` with the imported
   `.pem` key, open a project, click-through install tmux + Claude Code.
2. Launch Claude Code, give it a long task, **detach and close the tab**.
3. When it wants input: desktop notification fires → click → you're in the
   session. Running list shows `waiting` chip and the dock badge counts it.
4. `scripts/ci-check.sh` green; release workflow green.

## Do NOT

- SSH agent forwarding / port forwarding / history search / terminal ⌘F
  (next briefs)
- Per-agent notification rules or quiet hours (later polish)
- Touch sync-server, vault formats, or sync payloads (nothing here syncs)
- Add telemetry
