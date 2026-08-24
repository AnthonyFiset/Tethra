---
name: design-review
description: Run Tethra's UI in a browser, screenshot every surface, and audit it against docs/DESIGN.md — UX/placement/scroll/token violations, ranked. Use when asked to review the UI, check design, find UX issues, or verify a UI change visually.
---

# Tethra design review

Audit the real rendered UI against the rules in `docs/DESIGN.md`.

## 1. Boot the UI in a browser

Preferred: the mock-IPC web harness (no SSH hosts or vault needed):

```bash
cd apps/ui && npm run dev:web   # mock IPC + fixture data on http://localhost:5173
```

If `dev:web` doesn't exist yet, fall back to `npm run dev` and note that
IPC-backed views will be empty — still screenshot chrome, settings, and
layout. (The mock harness is the reliable path; if missing, flag that as a
finding.)

## 2. Capture

Use the Claude-in-Chrome tools (load via ToolSearch if deferred): open the
URL in a fresh tab and screenshot each surface at TWO window sizes —
1440×900 and 900×600 (the small size exposes scroll/clipping bugs):

- Launcher/home, Hosts list
- A terminal session (mock), Files/SFTP, Tunnels, Identities/Vault
- Settings — EVERY section, and scroll each section to the bottom
- Command palette open
- **EVERY dialog/modal/sheet in the app — no sampling.** Enumerate them
  from the code (`grep -rl "Dialog\|Modal" apps/ui/src`) and open each
  one: host form (edit, with all sections), project form, add tunnel,
  rename, assist settings, tools hint. For each, at the SMALL size run
  the §3 check programmatically: dialog height ≤ viewport, one
  `overflow-y: auto` body, header/footer reachable, nothing clipped
  offscreen (`getBoundingClientRect` top ≥ 0 and bottom ≤ innerHeight).
  A skipped dialog is a failed review — the host-form clipping bug
  shipped because a review sampled instead of enumerating.

## 2b. Interaction pass (MANDATORY — screenshots cannot catch these)

Static captures miss broken hover states and dead controls entirely. On
every surface, using Playwright:

- **Hover** each interactive element class once (host card, rail item,
  tab, block, button, chip) and screenshot mid-hover — verify a visible
  hover state exists and uses the tokens (`--color-hover`/elevated).
- **Click every control that promises behavior** and assert the behavior:
  a sort control must reorder, a filter chip must filter, a toggle must
  toggle. A control that does nothing is a FAKE CONTROL — blocker-level
  finding (DESIGN.md no-filler rule), either wire it or remove it.
- **Keyboard**: Tab reaches the primary controls; Esc closes the top
  layer; Enter activates the focused control.
- Check the browser console after the pass — any error logged during
  interactions is a finding.

## 3. Audit

Score each screenshot against `docs/DESIGN.md` §6 checklist. For every
violation record: surface, rule broken (§ number), severity (blocker /
paper-cut), one-line fix. Also flag anything that feels off even without a
rule — say why, and propose the rule if it recurs.

## 4. Report

Deliver findings ranked (blockers first) with the screenshot evidence
inline. If asked to fix: small CSS/markup fixes may be made directly;
structural moves (a feature changing surfaces) go into a NEXT.md brief
instead. Never restyle with literals — tokens only (§4).
