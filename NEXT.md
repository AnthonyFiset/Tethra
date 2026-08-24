# NEXT — after v0.5 blockers: WebdriverIO real-app harness

> **Immediate brief — before anything else ships after the WKWebView /
> Projects / sort blockers land.** `dev:web` stays for fast Chromium
> iteration. **Nothing is called done on browser-harness evidence alone.**
> Acceptance for UI work that touches sessions, fonts, WebGL, IPC-backed
> lists, or native chrome requires a pass in the real app (`npm run tauri
> dev` / packaged build) — preferably automated.

## Goal

Automate the design-review flow checklist against a live Tauri window
(WKWebView on macOS), so Chromium-only false greens cannot ship again.

## Scope

1. **WebdriverIO + Tauri** driver (or Appium for the webview) that:
   - launches `tethra` from `target/debug` or `tauri dev`
   - unlocks a fixture vault (or uses a dedicated test vault path)
   - runs the design-review skill flows: home→session→home, tabs on home,
     RUNNING with a live session, Arrange-by reorder, hover lifts,
     dialogs at a small window, way-back from every surface
2. **Assert** terminal cells paint (not empty black), host sort reorders
   on `lastConnectedAt`, Projects section is present and palette-reachable
3. **CI job** (macOS) optional-but-preferred; local `npm run test:e2e:app`
   must be the default pre-merge gate for UI PRs that touch those surfaces
4. Keep Playwright/`dev:web` for unit-speed UI checks — dual harness

## Non-goals

Rewriting the mock IPC harness; replacing design-review screenshots;
Windows/Linux drivers in v1 (macOS first — that's where WKWebView bites).

---

# NEXT — v0.5.0: the visual overhaul (Warp blocks × Termius organization)

> **Branch:** `visual-redesign` (from design-overhaul). Open a draft PR into
> main immediately; do NOT merge before design review passes. PR #1
> (design-overhaul) merges first; this PR rebases on main after.
>
> **The spec is visual and it is approved.** Anthony signed off on these
> mockups — match them:
> - `docs/design/v0.5/v05-home.png` (+ `home-reference.html`, the exact
>   markup/values it renders — lift paddings, radii, sizes, rgba tints
>   from it verbatim)
> - `docs/design/v0.5/v05-session.png` (+ `session-reference.html`)
> Tokens are the existing `styles.css` `@theme` — the references use only
> those plus host-identity colors. `docs/DESIGN.md` still governs (§3
> scrolling, §5 chips/errors, §6 checklist).
>
> **Acceptance (updated):** static + interaction + flow passes in
> `dev:web` are necessary but **not sufficient**. Session paint, host
> sort on real vault data, and home/Projects must be confirmed in the
> real app (`tauri dev`) before merge. The WDIO brief above is next.
>
> **Scope:** this brief restyles and reorganizes; it does not add
> protocol/vault features. No changes to `inject.ts` / `registry.ts` paths.

---

## Part A — App shell + Home (build first; pure UI)

1. **Left rail** (~224px, `#101010`, hairline right border) replaces the
   titlebar surface pills as primary navigation:
   - Top: vault card — logo, vault name, state line ("unlocked · synced"
     with green dot; locked/red and syncing states too).
   - Nav: Hosts (count), Tunnels (live count badge), Identities, Files,
     Assist — icons per the reference. Active item = `#222` pill.
   - **RUNNING section**: live sessions list — colored terminal icon
     (host color), session/project name, right status dot (running green /
     waiting amber / failed red). Click = attach. This is the Termius
     "Terminals" pattern and the wedge on permanent display.
   - Bottom: Settings.
   - Narrow windows (< the surface-nav breakpoint): rail collapses to
     icon-only (tooltips), NOT hidden. Terminal focus mode (Part B) also
     collapses it.
2. **Home pane**: quick-connect hero (46px input, mono, `❯` accent prefix,
   accent Connect button), tag-filter chip row + "Arrange by", GROUPS
   card row (icon tile in group color, name, host count, dashed New
   group), HOSTS card grid (36px rounded-square avatar in the host's
   existing color, name, mono user@host, right-side status/`key` chip,
   dashed New host). Group data: hosts already have tags — groups ARE
   tags for now (a group card filters by tag); no new vault schema.
3. **Titlebar** becomes minimal: traffic-light inset, centered ⌘K search
   pill, right icons (lock, overflow). Session tabs live in the titlebar
   row as in the session reference (colored dot, name, dim project,
   close ×; active = elevated bg + border; `+` for new).
4. Surfaces (Vault, Assist, Agents, Identities) open from the rail —
   SurfaceShell keeps its 880px grid; palette entries stay.

## Part B — Session view (the Warp treatment)

1. **Context bar** under the tabs (34px): cwd chip and git-branch chip
   (both already known via shell integration / OSC 133 cwd reporting),
   right side dim `tmux · up 1h · <ip>`. Omit chips gracefully when shell
   integration is off.
2. **Block chrome** on the existing xterm + OSC 133 block model — pick
   the mechanism (xterm decorations API, or an overlay gutter aligned to
   block marks) and note it in the PR; do NOT replace xterm or fork the
   scrollback:
   - 3px left status rail per block: green ok / red non-zero exit / accent
     active, with the dim block-header line (path · branch · right-aligned
     duration + time) rendered per the reference.
   - Active/last block: accent border + faint tint per reference.
   - Block hover ⋮ menu: Copy command, Copy output, Share block (copies
     both), Re-run, Jump to agent (when the block is an agent session).
     Data for all of these exists in the parsed block model.
   - Collapsed representation for huge finished blocks ("npm install ·
     1,204 lines · 32s") — expand on click. If collapse is infeasible
     this release, ship the rest and say so; don't fake it.
3. **Prompt panel**: the input line area gets the framed treatment —
   `#141414` panel, `#363636` border, radius 10, `❯` accent — as a visual
   frame around the real PTY input (xterm keeps handling keystrokes; no
   local line-editing layer). Hint row beneath: ⌘F find · ⌘K commands ·
   blocks count. Agent-waiting state renders the amber banner + Review
   button inside the active block (wires to the existing notification
   state; Review = focus session).
4. **Focus mode**: when a session has focus, the rail auto-collapses to
   icons (DESIGN.md §2 — terminal space is sacred).

## Harness + fixtures

- Extend `dev:web` mocks: rail counts, running sessions with all three
  states, host colors, groups-from-tags, session view with fixture blocks
  (ok / failed / active+waiting) so the design review can screenshot
  every state without SSH.

## Acceptance

1. Side-by-side: dev:web screenshots at 1440×900 vs `v05-home.png` and
   `v05-session.png` — same anatomy, spacing rhythm, and tones (not
   pixel-identical: real data differs; structure and tokens must match).
2. DESIGN.md §6 self-audit passes; every dialog still obeys the 85vh rule;
   rail collapse verified at 900×600.
3. Real-world check on `tethra-vm`: blocks render on a live session, the
   ⋮ menu copies a real command/output, agent-waiting banner appears when
   Claude Code prompts.
4. `scripts/ci-check.sh` green. No release stamp in this brief — v0.5.0
   stamps after design review + code review pass on the PR.

## Do NOT

- Replace or fork xterm; no local line-editor for the prompt
- New vault schema (groups are tag views)
- Touch sync-server, signing, release workflows
- Windows-native chrome / history search (still separate v0.5.x briefs)
