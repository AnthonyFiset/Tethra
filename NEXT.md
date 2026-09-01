# NEXT — active brief: WebdriverIO real-app harness (v0.5.0 shipped)

> **v0.5.0 shipped 2026-08-31** (visual overhaul — see `CHANGELOG.md`,
> `ROADMAP.md` rev 8, archived brief `docs/archive/NEXT-v0.5.0.md`).
>
> **Head start:** `scripts/app-drive.mjs` + the DEV-only bridge
> (`apps/ui/src/dev/bridge.ts`, docs/QA.md §1a) already drive the live
> WKWebView — eval, buffer snapshots, native keys, window captures. It
> caught every terminal bug the mock harness missed during v0.5.0. This
> brief formalizes that into a repeatable pre-merge gate; build on the
> bridge rather than starting from zero.
>
> `dev:web` stays for fast Chromium iteration. **Nothing is called done
> on browser-harness evidence alone.** Acceptance for UI work that
> touches sessions, fonts, rendering, IPC-backed lists, or native chrome
> requires a pass in the real app (`npm run tauri dev` / packaged build)
> — preferably automated.

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

