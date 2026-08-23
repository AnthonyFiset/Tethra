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

- **Status chips** (running / waiting / done / failed / active / error) use
  one shared chip component — same shape everywhere a state appears
  (sessions, tunnels, agent forwarding, sync).
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
4. States shown with bespoke one-off styling instead of chips? → §5.
5. New feature reachable from both primary nav and command palette? → §2.
6. Empty state and error copy present and instructive? → §5.
7. Terminal width stolen by new chrome while a session is focused? → §2.
