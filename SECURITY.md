# Security Policy

## Supported versions

Security fixes are applied to the latest released tag on `main` (currently the
`v0.2.x` line). Older tags are not backported unless a release is still the
only signed updater channel in wide use.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security reports.

Email: **tonyfise@my.yorku.ca** (interim — replace with a dedicated security
contact before or soon after going public if preferred)

Include:

- Affected version / commit if known
- A clear description and reproduction steps
- Impact (e.g. vault ciphertext exposure, updater trust, remote code via PTY)

You should receive an acknowledgement when practical. There is **no bug bounty**;
response is best-effort.

## Threat model (short)

Tethra’s vault protects **at-rest host metadata and opted-in secrets** with a
master password (Argon2id + XChaCha20-Poly1305). Sync servers see **ciphertext
only**.

What the vault does **not** protect:

- A compromised SSH host or local machine can still read an active session
- Private keys stay **device-local** by design; they are not synced today
- Password identities sync only when the user enables `sync_secret`
- Update payloads are **minisign-verified**; do not redistribute a leaked
  updater private key — report it immediately
