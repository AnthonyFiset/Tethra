# Public-release audit — §1 findings + §2/§4 progress

_Audit 2026-08-07 against `main` @ `b630b80`. Scrub/docs follow Option **B**
(keep history). License: **Apache-2.0** (default; change before public flip if
desired)._

## Summary

| Check | Result |
|---|---|
| Updater **private** key in history | **Not found** |
| `gitleaks` / `trufflehog` | **Clean** |
| Real VPS / Tailscale IPs | **Not in tree or history** |
| §3 history strategy | **B — keep history** (approved) |
| §2 hostname defaults | **Scrubbed** → `sync.example` / empty UI fields |
| §4 public files | **Added** LICENSE, SECURITY, README, CONTRIBUTING |

---

## 1.1–1.4 Audit (unchanged conclusion)

- No `*.key` / `*.pem` / `PRIVATE KEY` blobs in history
- Public minisign key only in `tauri.conf.json`
- Workflows use `${{ secrets.TAURI_SIGNING_* }}` only
- Docker fixtures: `testuser` / `testpass` only
- Author email `tonyfise@my.yorku.ca` remains on historical commits (accepted with B)

Full command notes: earlier session; scanners re-runnable via `NEXT.md` §1.2.

---

## §2 Scrub performed

- UI sync/join defaults cleared; placeholders `http://sync.example:8787`
- `tauri.conf.json` updater endpoint → `sync.example`
- Tests/docs/comments: `thinkpad` hostname → `sync.example` / “always-on sync host”
- `.gitignore`: `*.key`, `.tethra-updater.key`
- Softened STATUS / HANDOFF / M6 / ROADMAP-v3 wording

Left intentional: `NEXT.md` task brief; historical `ROADMAP-v2.md` ThinkPad mentions
(low risk narrative).

---

## §4 Public files

| File | Notes |
|---|---|
| [`LICENSE`](../LICENSE) | Apache License 2.0 |
| [`SECURITY.md`](../SECURITY.md) | Disclosure + short threat model |
| [`README.md`](../README.md) | Product, build, threat model table |
| [`CONTRIBUTING.md`](../CONTRIBUTING.md) | Catalogs-first PRs |

---

## Still open (do not flip public until ready)

- [ ] **§5** Point updater at GitHub Releases + `tauri-action` matrix (after public)
- [ ] Confirm SECURITY contact email (interim school address in SECURITY.md)
- [ ] Repo settings: secret scanning, push protection, Dependabot, branch protection
- [ ] `scripts/ci-check.sh` on this scrub commit
- [ ] Test client update from GitHub endpoint (post-§5)
- [ ] Optional: soften remaining ThinkPad wording in `ROADMAP-v2.md`

---

## Acceptance (§6) progress

- [x] gitleaks / trufflehog clean over full history
- [x] No real IPs / home paths; personal hostname defaults scrubbed
- [x] Updater private key never committed
- [x] LICENSE / SECURITY / README / CONTRIBUTING present
- [ ] `scripts/ci-check.sh` passes on scrub
- [ ] Test release via `tauri-action`
- [ ] Client updates from GitHub with no sync-host mirror required
