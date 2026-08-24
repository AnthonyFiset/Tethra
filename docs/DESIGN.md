# Tethra UI design rules

_The rulebook every UI change is reviewed against. North stars: **Warp**
(block-based terminal, command palette, dark IDE feel), **Termius 2025**
(navigation flattened so the terminal gets the space), **Cursor** (chrome
disappears while you work). Tethra copies none of them pixel-for-pixel; it
borrows their discipline._

## 1. The one architectural rule

Every piece of UI is either a **surface** or a **preference**:

- **Surface** — a place you *do work*: connect, browse files, run agents,
  manage tunnels, manage identities. Surfaces are first-class: reachable
  from primary navigation and the command palette, own their layout, own
  their scroll. The File Manager is the reference pattern.
- **Preference** — something you *set once and forget*: theme, font size,
  shell, keybindings. Preferences live in Settings and nowhere else.

**The test:** if it has live state, a start/stop button, or a list you add
to weekly, it is a surface. If removing it for a day would only annoy you
when you next tweak a default, it is a preference.

Settings therefore contains ONLY: General, Appearance, Terminal, Shell,
Keyboard, Advanced. Vault management, Sync, AI providers, Agents, Tunnels,
Identities are surfaces (a Settings row may deep-link to them, styled as a
link, not a section).

## 2. Navigation

- Primary navigation lists surfaces, nothing else. Keep it to ≤7 entries.
- The command palette (⌘K family) can reach every surface, every host, and
  every open session — it is the power-user path and must never lag.
- Terminal space is sacred (Termius's lesson): navigation chrome shrinks or
  collapses when a session has focus; nothing steals width from the
  terminal by default.
- One idea per surface. A surface may have internal tabs/subsections only
  when they operate on the same noun (e.g. Files: local/remote panes).

## 3. Scrolling — where past bugs live

- Exactly one scroll container per pane. Never nest two vertical scrollbars.
- Modals: fixed header/footer, `overflow-y: auto` on the body only,
  `max-height: 85vh`. The page behind a modal never scrolls.
- Lists virtualize past ~200 rows (hosts, blocks, transfer logs).
- Anything focusable that scrolls must respond to trackpad, wheel, PgUp/PgDn,
  and Home/End. Test with a 2-line window and a 4k window.
- Terminal scrollback belongs to xterm; never wrap the terminal in an outer
  scroll container.

## 4. Tokens, type, spacing

- Colors come from `apps/ui/src/styles.css` `@theme` — never hex literals in
  components. Accent `--color-accent` is for primary actions and focus;
  success/warning/danger only mean state, never decoration.
- Type: `--text-ui` (13px) for controls, `--text-micro` (11px) for meta.
  Mono (`--font-mono`) for anything a user might copy: paths, ports, URLs,
  fingerprints, commands.
- Spacing on a 4px grid; panel radius `--radius-panel` (10px); one border
  color per edge (`--color-line`, `--color-line-strong` for emphasis).
- Density: this is a pro tool — compact by default, but touch targets ≥28px.

## 5. Components

- **Status indicators** are a small dot + plain text in `fg-muted` — same
  shape everywhere a state appears (sessions, tunnels, agent forwarding,
  sync, running list). **No tinted pill backgrounds** and **no colored
  borders around status text.** Prefer copy like `● 1 active · agent on`
  in a strip, not `"1 ACTIVE"` / `"AGENT ON"` chips.
- **Icon tiles** (groups, rail, running list, host avatars) use a neutral
  `#1b1b1b` / `--color-elevated` tile with the colored glyph or letter —
  never a color-washed fill.
- **The amber agent-waiting banner** (Review / “Waiting for you…”) is the
  **one** allowed emphatic tinted status element. It fires only on a
  genuine agent attention signal (BEL / OSC 9 / OSC 777) — never on an
  idle prompt and never from silence alone. Check every status in its
  **empty/idle** state, not only when active.
- **Empty states** teach: one sentence of what the surface does + the
  primary action. Never a bare "No items."
- **Errors** are plain language, name the fix, and never expose raw Rust
  error chains. Pattern: what failed → why (if known) → the next action.
- **Destructive actions** (delete host/identity/tunnel, disable sync)
  confirm inline (button swap or 2-step), not with a nested modal.
- **Keyboard**: every surface reachable without the mouse; Esc always means
  "close the topmost layer, return focus where it was."

## 6. Review checklist (used by the design-review skill)

1. Is anything with live state or CRUD inside Settings? → violation of §1.
2. Double scrollbars, dead trackpad zones, clipped content at 900×600? → §3.
3. Hex colors or ad-hoc spacing in changed components? → §4.
4. Tinted status pills, color-washed icon tiles, or waiting banner on idle? → §5.
5. New feature reachable from both primary nav and command palette? → §2.
6. Empty state and error copy present and instructive? → §5.
7. Terminal width stolen by new chrome while a session is focused? → §2.
8. Status indicators checked in their empty/idle state (not only active)? → §5.
