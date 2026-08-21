> **Completed — shipped as v0.3.0.**

# NEXT — v0.3.0: docs, then make it feel finished

> **Replaces the earlier `NEXT-v0.3.0.md`.** Do Phase A before Phase B.
> Do **not** start agent notifications, SSH agent forwarding, port forwarding, or
> Windows chrome — those are v0.4.0+.
> Baseline: `v0.2.11`, repo public, GitHub-only updates.

---

# PHASE A — Documentation

## A0. The actual problem

Three files each carry a milestone board — `HANDOFF.md`, `STATUS.md`,
`PROJECT.md` §12 — and they have drifted. HANDOFF currently says *"Canonical plan:
ROADMAP-v3"* and *"Next feature work is M13 Fleet."* Both are wrong. An agent
handed HANDOFF today would go build port forwarding.

**The fix is structural: one source of truth per fact.** Cleaning the text without
removing the duplication just resets the clock on the same failure.

| Fact | Lives in | Everywhere else |
|---|---|---|
| Architecture + hard rules | `PROJECT.md` | link only |
| What's done / what's next | `ROADMAP.md` | link only |
| Current task | `NEXT.md` | link only |
| How to build/run/release | `HANDOFF.md` | link only |
| Historical detail | `docs/milestones/M*.md` | link only |

`PROJECT.md` §12 (milestone summary) and every milestone board outside
`ROADMAP.md` get **deleted and replaced with a link.**

## A1. Target layout

```
/
  README.md            what it is, install, build, threat model, doc map
  LICENSE
  SECURITY.md
  CONTRIBUTING.md
  PROJECT.md           architecture + hard rules ONLY (no milestone board)
  ROADMAP.md           ← current plan. NOT versioned in the filename.
  HANDOFF.md           agent brief: how to work here, landmines, verify, release
docs/
  UPDATES.md
  PUBLIC-RELEASE-AUDIT.md
  milestones/          M1.md … M12.5.md
  archive/             superseded roadmaps + completed NEXT files
```

**Root holds seven files. No more.**

## A2. Moves

| From | To | Note |
|---|---|---|
| `ROADMAP-v5.md` | `ROADMAP.md` | **Current plan.** Add `_Revision 5 — 2026-08-21_` at top |
| `ROADMAP-v2.md`, `ROADMAP-v3.md`, `ROADMAP-v4.md` | `docs/archive/` | Add a one-line "superseded by ROADMAP.md" header to each |
| `NEXT.md`, `NEXT-5-revised.md`, `NEXT-v0_2_11.md` | `docs/archive/` | Completed |
| `STATUS.md` | `docs/archive/STATUS-v0.2.9.md` | See A3 |
| `docs/M*.md` | `docs/milestones/` | Fix inbound links |
| *(this file)* | `NEXT.md` at root | The current task is always `NEXT.md` |

## A3. Retire STATUS.md

`STATUS.md` and `HANDOFF.md` overlap by roughly 70% and that overlap is where the
drift lives. Fold anything unique from STATUS into HANDOFF or the relevant
milestone doc, then archive it. Do **not** maintain both.

## A4. Rewrite HANDOFF.md

Keep only what is genuinely handoff-shaped:

1. One-line product + wedge
2. Pointer to `ROADMAP.md` for status — **no milestone table**
3. Architecture summary + hard rules pointer to `PROJECT.md`
4. **Critical UI paths** table (keep — this is the most valuable thing in it)
5. **Known landmines** (keep, updated — see A5)
6. Verify / smoke commands
7. Release flow (GitHub-only; note the 2026-08-20 key rotation)
8. Doc map

Update the header: `main` @ current commit, tag `v0.2.11`, repo public.

## A5. Update landmine 1 with the v0.2.11 finding

> **1. Device-report filter and insert gates.** xterm answers DA / OSC 10–11 via
> `onData`. **Paste and insert are different operations.** Insert buttons arm
> gates (`armGates()` → `blurAll()` + suppress); **paste must not** —
> `pasteIntoTerminal` calling `armGates()` was the v0.2.11 bug: it stole focus and
> dropped the first Enter for both ⌘V and right-click. `looksLikeDeviceReport`
> must never classify lone C0 (`\r` / `\t` / `\x03`) as a report. See v0.2.8–v0.2.11.

## A6. Fix stale references everywhere

```bash
rg -n 'ROADMAP-v[0-9]|STATUS\.md|M13 Fleet|NEXT-5|docs/M[0-9]' --glob '!docs/archive/**'
```

Every hit outside `docs/archive/` must be updated. Particularly: `README.md` doc
map still lists `ROADMAP-v3.md` as canonical.

## A7. Add the convention to CONTRIBUTING.md

> **Docs convention.** `ROADMAP.md` is the only place milestone status lives.
> `NEXT.md` is always the current task; completed ones move to `docs/archive/`.
> Roadmap revisions bump a header line, not the filename. Never duplicate a
> milestone board.

**Commit Phase A on its own** before starting Phase B.

---

# PHASE B — Features

Everything here is visible daily. Mostly frontend and data — **no changes to
`inject.ts` or `registry.ts` input paths.**

## B1. Azure OpenAI provider preset

Add to `crates/core/data/assist_providers.json`. Data only.

Azure OpenAI differs from vanilla OpenAI in three ways:

- Per-resource base URL: `https://{resource}.openai.azure.com/openai/v1/`
- Auth header is `api-key`, not `Authorization: Bearer`
- Model identifier is a user-chosen **deployment name**, not a catalog ID — so
  `GET /models` may behave differently

If `OpenAiCompatible` can't express the header difference, extend the **preset
schema**, not the code (hard rule: catalogs are data).

**Never commit a key.** Preset is public; keys are local settings.

> **Maintainer note, not a task:** Claude models in Microsoft Foundry are a
> Marketplace partner offering and **cannot be paid for with Microsoft for
> Startups credits** — credit-based subscriptions are explicitly excluded. Azure
> OpenAI (first-party) works. Don't build anything assuming otherwise.

## B2. BYOK injection at launch

`byok_env` is stored and never used. Wire it up: at launch, resolve the project's
bound provider key from the vault → map to the preset's `byok_env` names → inject
into the agent process env.

**Remote injection — choose deliberately and document:**

- `VAR=secret cmd` keeps the key out of `argv`, but `/proc/PID/environ` is
  readable by the same user on that host
- **Never put a key in a tmux command line** — tmux stores and can display it
- Stronger: write a `0600` env file, source it, unlink

Surface which key a project is injecting, in the project UI.

## B3. Launcher: Running first

The hero promises *"Running agents stay alive in tmux"* and then shows Projects.
There is no Running section.

- Running → first section: agent, host, project, uptime, last activity, Attach / Kill
- Nothing running → drop the tmux hero copy; show a quiet empty state

Leave room in the row for a state chip — v0.4.0 notifications will fill it.

## B4. Settings: fill or hide

| Section | Minimum |
|---|---|
| Terminal | Font family/size/line height, ligatures, cursor style/blink, scrollback, copy-on-select, bell |
| Appearance | Theme, accent, window material + opacity, density |
| Keyboard | Full keymap, searchable |
| Shell | Default shell, login-shell toggle, env overrides, integration mode |
| Agents | Catalog, installed state, custom presets, BYOK bindings from B2 |
| Advanced | Log level, catalog source, reset layout, export diagnostics |

Hide anything still empty at the end. Style the browser-default blue focus ring on
the nav. Every setting reachable from the palette by name.

## B5. Design pass (M12.5 Track D)

Ordered by impact per effort.

**B5.1 — `Host.color` as ambient identity.** Highest value. Currently a 1px border
nobody sees. Promote to: collapsed rail indicator, active tab underline, hairline
along the top of the terminal viewport. You should know which machine you're on
peripherally, without reading. Safety property, not decoration.

**B5.2 — Reduce host-card button weight.** Three equal buttons × N hosts is a wall
of chrome. Card itself clickable for the primary action; secondary actions on
hover and in the context menu.

**B5.3 — Fix type hierarchy.** The hero is larger than anything it introduces.
Section headers do the navigational work. Shrink hero, strengthen sections.

**B5.4 — Mono vs sans.** Machine strings (hosts, ports, paths, fingerprints,
sizes) always mono. Human labels and prose sans. Inconsistent today.

**B5.5 — Real empty states.** Zero projects → *New project* as a target. Zero
hosts → *Import ~/.ssh/config* as the primary action.

**B5.6 — Smaller.** Sidebar footer reassurance on first unlock only. Overflow menu
entries become shortcuts *into* Settings, not a parallel surface. Tooltips with
shortcuts on toolbar icons. Fix the Projects/Hosts vertical gap; align the host
filter with its section header.

---

## Acceptance

**Phase A**
- [x] Root has exactly seven files
- [x] `ROADMAP.md` is the only milestone board; PROJECT §12 replaced with a link
- [x] `STATUS.md` archived, unique content folded into HANDOFF
- [x] Landmine 1 records the paste-vs-insert distinction
- [x] `rg` for stale references clean outside `docs/archive/`
- [x] Docs convention in CONTRIBUTING

**Phase B**
- [x] Azure OpenAI: paste key → Test → model list → Assist works
- [x] BYOK injects locally and remotely; no key in a tmux command line
- [x] Launcher shows Running first; honest empty state
- [x] No empty Settings sections
- [x] Host color in rail, tab, viewport hairline
- [ ] Paste → one Enter still works (v0.2.11 regression) — manual verify
- [ ] `scripts/ci-check.sh` green — after commit of generated bindings

Tag `v0.3.0`.
