# NEXT — v0.4.1: UX architecture pass (surfaces vs. settings) + web harness

> **Scope:** UI restructure + the browser test harness. No new SSH/vault
> features. No changes to `inject.ts` / `registry.ts` input paths.
> Baseline: `main` (v0.4.0 shipped).
>
> **Why:** v0.4.0 shipped features fast and parked too many of them inside
> the Settings modal (now ~1,470 lines, 10 sections, broken scrolling).
> Anthony's verdict: workflow features must be first-class surfaces like the
> File Manager, not settings sections. The new rulebook is
> **`docs/DESIGN.md` — read it first; it is the spec for this brief.**

---

## 1. Apply the surface/preference split (DESIGN.md §1)

- **Settings keeps ONLY:** General, Appearance, Terminal, Shell, Keyboard,
  Advanced.
- **Move out to first-class surfaces** (Files-manager pattern: reachable
  from primary nav + command palette, own layout, own scroll):
  - **Vault & Sync** → one "Vault" surface: status, unlock/lock, sync
    backend + device list, master password actions.
  - **AI providers + Assist** → "Assist" surface (provider presets, keys
    status by ID, test button).
  - **Agents** → into the existing Launcher/Agents surface (catalog,
    defaults, notification toggles live with the thing they configure).
  - **Identities** (SSH keys) → surface (already speced in the key brief's
    Settings section — promote it).
  - Tunnels stay where they are (host/session panel — already correct).
- Settings rows that used to host these become deep-links ("Manage vault →")
  that open the surface. No functionality removed, only relocated.
- Primary nav lists the surfaces (≤7 — DESIGN.md §2); command palette
  entries for every surface ("Go to: Vault", "Go to: Assist", …).

## 2. Fix scrolling everywhere (DESIGN.md §3)

- Settings modal: fixed header + section nav, `overflow-y: auto` body only,
  `max-height: 85vh`, no nested scrollbars, trackpad + PgUp/PgDn + Home/End
  work in every section. Verify at a 900×600 window.
- Sweep the moved surfaces for the same rules while relocating them.
- Long lists (hosts, blocks) — virtualize if any currently render >200 rows
  unvirtualized; otherwise leave.

## 3. `dev:web` — browser harness with mocked IPC

The CI already enforces "Tauri imports confined to ipc.ts" — use that seam:

- `npm run dev:web` (apps/ui): vite dev with `VITE_TETHRA_MOCK=1`; `ipc.ts`
  swaps to a mock module implementing every IPC call against fixture data —
  a handful of hosts (password + key), one fake running session with canned
  terminal output, tunnels in various states, identities, sync status,
  update banner states.
- Mock is deterministic (no timers randomizing state) so screenshots are
  stable; interactions mutate the in-memory fixtures so flows are clickable.
- No mock code in the production bundle (tree-shaken behind the env flag);
  `scripts/ci-check.sh` builds stay green with zero Tauri present.
- One paragraph in CONTRIBUTING.md: how to run it, what it's for (design
  review + future Playwright/WDIO e2e).

## Acceptance

1. Settings shows exactly 6 preference sections; every former section's
   functionality reachable via its surface from nav AND command palette.
2. At 900×600: every Settings section and every surface scrolls to its last
   control with one scrollbar and working trackpad momentum.
3. `npm run dev:web` on a machine with no vault/hosts renders every surface
   with fixture data; add-tunnel and edit-host flows are clickable.
4. Screenshots of each surface at 1440×900 attached to the PR/summary.
5. `scripts/ci-check.sh` green; DESIGN.md §6 checklist passes (self-audit
   and say so explicitly).

## Do NOT

- New features, new IPC surface area beyond the mock, visual rebrand
  (tokens stay exactly as styles.css defines)
- WDIO/tauri-driver CI e2e (separate later brief)
- Touch sync-server, signing, release workflows
