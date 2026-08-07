# NEXT — Prepare Tethra for public release

> **Scope:** this task only. Do not start M13, design work, or feature work.
> Stop when §6 acceptance passes and report findings.
> Context: [`ROADMAP-v4.md`](ROADMAP-v4.md), [`PROJECT.md`](PROJECT.md), [`HANDOFF.md`](HANDOFF.md).

**Goal:** get `AnthonyFiset/Tethra` safe to flip public, then switch the updater
off the ThinkPad mirror and onto GitHub Releases.

**Why now:** the private repo blocks three things at once — the GitHub updater
endpoint, code signing, and catalogs-as-PRs. One decision unblocks all of them.

---

## 1. Audit history — do this first, report before changing anything

**Making a repo public exposes the entire git history, not just `HEAD`.** A secret
deleted later is still readable in the commit that added it. Audit `git log`, not
the working tree.

### 1.1 Updater signing key — highest priority

```bash
git log --all --full-history -- '*.key' '*.pem' '*.p12' '*updater*'
git log --all -p -S'PRIVATE KEY' --oneline
git log --all -p -S'TAURI_SIGNING' --oneline
```

This one is categorically different from other secrets. Installed clients verify
update payloads against its public half — anyone with the private key can sign a
`latest.json` that every installed Tethra downloads and runs. It is a supply-chain
compromise, not a leak.

**If it appears anywhere in history: STOP and report.** Do not proceed to §3.
Rotation requires shipping a release signed with the old key that carries the new
public key, before the old key is burned.

### 1.2 Scanners over full history

```bash
gitleaks detect --source . --log-opts="--all" --verbose
trufflehog git file://. --json | jq 'select(.Verified==true)'
```

Install via `brew` if missing. Report all findings; do not auto-remediate.

### 1.3 Real infrastructure in the tree

Known values that are likely present in fixtures, tests, or docs:

- `216.250.118.11` — **public IP with root user**. Highest priority to scrub.
- `100.80.50.90`, `100.101.225.90` — Tailscale addresses
- `anthonyfiset`, `Anthonys-MacBook-Pro`, `/Users/anthonyfiset/...`
- Any tailnet hostnames in `crates/sync-server` config or docs

```bash
git grep -nI '216\.250\|100\.80\.50\|100\.101\.225\|anthonyfiset' -- . | head -80
```

### 1.4 Manual checks scanners miss

- `crates/core/tests/docker-compose.yml` — SSH test credentials
- `.github/workflows/*` — confirm secrets are `${{ secrets.X }}` refs only, never
  inlined during past debugging
- `.env`, `.envrc`, `*.local.*` — gitignored **and** never committed pre-ignore
- `docs/` images — same disclosure risk as code
- Vault test fixtures — any real blobs or dev master passwords

**Deliverable for §1:** a written findings list. Nothing modified yet.

---

## 2. Scrub the working tree

Replace real infrastructure with documentation-safe values:

- Hosts → `example.com`, `host.example`
- IPs → RFC 5737 ranges: `192.0.2.0/24`, `198.51.100.0/24`
- Usernames → `user`, `deploy`
- Paths → `/home/user/...` or `$HOME/...`

Keep it working: tests that need a live host should read from env vars with
documented defaults, not hardcoded values.

---

## 3. Decide history strategy (ask before executing)

Present both, recommend based on §1 findings:

**A — Fresh repo (recommended if anything sensitive is in history).** New public
repo, working tree copied without `.git`, one initial commit. Archive the private
repo — don't delete it; the history stays private and intact. A partial
`git-filter-repo` scrub that misses one blob is worse than no scrub, because it
produces false confidence.

**B — Keep history** if §1 comes back clean.

Either way, the old private repo is archived, never deleted.

---

## 4. Add the public-repo files

- **`LICENSE`** — ask which. Default recommendation **Apache-2.0** (patent grant,
  permissive; MIT is fine if simpler is preferred).
- **`SECURITY.md`** — disclosure contact, "best-effort response, no bounty",
  supported versions.
- **`README.md`** — what it is, the wedge (agent persistence + reattach), install,
  build from source, and a short **threat model**: what the vault protects, what
  it doesn't (a compromised endpoint reads your session regardless), private keys
  stay device-local, sync server sees ciphertext only.
- **`CONTRIBUTING.md`** — short. Point catalog additions at
  `crates/core/data/agents.json` as the easiest first PR.

---

## 5. Switch the updater to GitHub Releases

Once public, `https://github.com/AnthonyFiset/Tethra/releases/latest/download/latest.json`
resolves without auth. That removes the reason the ThinkPad mirror exists.

1. Point `tauri-plugin-updater` endpoints at that URL.
2. **Verify `tauri-plugin-updater` ≥ 2.10.0** — `latest.json` now emits
   `{os}-{arch}-{installer}` keys and older plugin versions won't parse them.
3. Convert Release CI to `tauri-action` with a platform matrix and
   `releaseDraft: false` so publishing is automatic on a `v*` tag.
4. macOS builds without an Apple cert need an **ad-hoc signing identity**, or
   Apple Silicon downloads from GitHub get flagged as damaged.
5. Reuse the existing `TAURI_SIGNING_PRIVATE_KEY` (unless §1.1 forced rotation).
   Do not regenerate — installed clients will reject updates signed by a new key.
6. Keep `tethra-sync-server`'s mirror working as a fallback; just stop making it
   the primary path.

---

## 6. Acceptance

- [ ] `gitleaks` and `trufflehog` clean over full history
- [ ] No real IPs, hostnames, usernames, or home paths in the tree
- [ ] Updater key confirmed never committed (or rotation plan written)
- [ ] `LICENSE`, `SECURITY.md`, `README.md`, `CONTRIBUTING.md` present
- [ ] `scripts/ci-check.sh` passes
- [ ] A test release builds and publishes via `tauri-action`
- [ ] An installed client updates from the GitHub endpoint with no ThinkPad

---

## 7. After flipping public (checklist for Anthony, not Cursor)

Enable in repo settings: **secret scanning**, **push protection**, **Dependabot**,
branch protection on `main` with required CI.

---

## Do NOT do in this task

- Do not commit or reference any API key, including Anthony's personal Azure /
  OpenAI credentials. Personal provider config lives in local app settings and
  gitignored files — **never** in `assist_providers.json` or any committed file.
- Do not start M13, notifications, BYOK injection, or design work.
- Do not run `git filter-repo` or BFG without explicit approval (§3).
- Do not delete the private repo.
- Do not regenerate the updater keypair without approval.
