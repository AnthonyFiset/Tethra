# Public-release audit — progress

_Last updated 2026-08-21. Amendments: mirror retired; GitHub-only updater._

## Done

| Item | Status |
|---|---|
| §1–§4 public prep | Done earlier (`0a5b6a2`) |
| Updater private key never in git | Confirmed; key **rotated** 2026-08-20 (new pubkey in `tauri.conf.json`) |
| §5 endpoint | **GitHub only** — `…/releases/latest/download/latest.json` |
| `dangerousInsecureTransportProtocol` | **Removed** |
| Runtime updater | No longer derives URL from vault sync HTTP |
| Release CI | Matrix macOS aarch64+x86_64, Win, Linux; draft during build → auto-undraft; `prerelease: false` |
| macOS ad-hoc sign | `signingIdentity: "-"` in `tauri.conf.json` |
| Runbooks | `docs/UPDATES.md`, `HANDOFF.md` rewritten |

## Remaining acceptance (needs a test tag)

- [ ] Push `v0.2.10` (or similar) and confirm Release CI publishes
- [ ] `latest.json` has non-empty signatures per platform
- [ ] Fresh install updates from GitHub (mirror off)
- [ ] Browser-downloaded macOS `.dmg` opens without “damaged”
- [ ] Manual reinstall on all machines (old pubkey cannot verify new signatures)

## Intentionally skipped

- Recovering ThinkPad mirror URL (archived updater cutover brief)
- Keeping mirror as second endpoint / §7 flag decision — mirror retired
