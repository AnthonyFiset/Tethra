> **Completed.** Archived task brief.

# NEXT — §5 (revised): updater on GitHub Releases + auto-publish

> **Scope:** this task only. Do not start M13, BYOK, notifications, or design work.
> Prerequisites: repo public; audit §1–§4 done (`docs/PUBLIC-RELEASE-AUDIT.md`);
> updater key rotated (§0 below).
> Supersedes the earlier `NEXT-5.md`.

**Goal:** tagging `vX.Y.Z` builds, signs, publishes, and updates clients — no
manual publish step, no ThinkPad dependency.

---

## 0. Context: the key was rotated

The updater keypair was regenerated on 2026-08-20 after the old private key was
exposed. State when this task starts:

- New keypair at `~/.tethra-updater.key` / `.key.pub` (private key **not** in the repo)
- `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` updated in
  GitHub Actions secrets
- New public key committed to `tauri.conf.json` → `plugins.updater.pubkey`
- Old key archived at `~/.tethra-updater-OLD.key`, pending verification

**Consequences that shape this task:**

1. **Existing v0.2.9 installs cannot auto-update to anything signed with the new
   key.** They verify against the old embedded public key and will reject the
   signature. All three machines get a manual reinstall — this is expected, not a
   bug to work around.
2. Because a manual reinstall is happening anyway, **the endpoint fix and the key
   rotation ship in the same build.** Don't produce an interim build.
3. **Do not regenerate the keypair again.** If signing fails, the cause is a
   malformed secret or a wrong password, not the key.

---

## 1. Recover the real mirror endpoint

The §2 scrub replaced the ThinkPad hostname with a placeholder. Current state:

```json
"endpoints": ["http://sync.example:8787/updates/{{target}}/{{arch}}/{{current_version}}"],
"dangerousInsecureTransportProtocol": true
```

`sync.example` resolves to nothing, so builds from current `main` have no working
update endpoint at all.

```bash
git log -p -- apps/tauri/src-tauri/tauri.conf.json | grep -i '8787' | head
```

If history doesn't have it, read it off the ThinkPad's `tethra-sync-server` config.
**Ask before guessing.**

---

## 2. Endpoint strategy — decide, then implement

Two shapes are in play and they are not interchangeable:

| | Format | Behavior |
|---|---|---|
| ThinkPad mirror | `.../{{target}}/{{arch}}/{{current_version}}` | **Dynamic** — server computes the response per request |
| GitHub Releases | `.../releases/latest/download/latest.json` | **Static** — a file uploaded by CI |

Tauri supports both and tries endpoints in array order.

**Normally** you'd add GitHub *before* the mirror and keep both, so existing
clients discover the new endpoint. **That reasoning does not apply here** — the key
rotation already forces a manual reinstall, so there is no install in the field
that can be reached by adding an endpoint.

Therefore:

```json
"endpoints": [
  "https://github.com/AnthonyFiset/Tethra/releases/latest/download/latest.json",
  "<recovered ThinkPad URL from §1>"
]
```

GitHub first, mirror second as a private-network fallback. Keeping the mirror is
the reason `dangerousInsecureTransportProtocol` stays — flag that to Anthony as a
decision (see §7), don't silently remove it.

---

## 3. Version check

`tauri-plugin-updater` is **2.10.1** and `@tauri-apps/plugin-updater` is **^2.10.1**.
Both clear the ≥ 2.10.0 requirement for `{os}-{arch}-{installer}` keys in
`latest.json`. **No upgrade needed.**

---

## 4. Convert Release CI to `tauri-action`

- Matrix: macOS `aarch64` + `x86_64`, Windows `x86_64`, Linux `x86_64`
- `releaseDraft: false`
- **`prerelease: false`** — GitHub's `releases/latest/download/` path *excludes*
  prereleases. A prerelease produces green CI and a 404 at the endpoint.
- Trigger on `v*` tag push only, never on `main`
- Pass `TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` from secrets
- **macOS without an Apple certificate needs an ad-hoc signing identity**, or
  Apple Silicon builds downloaded from GitHub report as damaged
- `scripts/ci-check.sh` stays a required gate before the build job
- Review the existing `actions/upload-artifact@v4` step at `release.yml:133` —
  confirm it isn't uploading signing material or build secrets

---

## 5. Verify signing before anything else ships

The rotation is unverified until CI produces a signature with the new key.

After the first successful run:

```bash
curl -sL https://github.com/AnthonyFiset/Tethra/releases/latest/download/latest.json | jq '.platforms | keys, (.[].signature | length)'
```

Every platform needs a non-empty `signature`. If any is missing or the build
failed at the signing step, the secret is malformed — most likely a trailing
newline or a password mismatch. **Report; do not regenerate the key.**

---

## 6. Update the runbook

Rewrite the release sections of [`docs/UPDATES.md`](docs/UPDATES.md) and
[`HANDOFF.md`](HANDOFF.md):

```bash
node scripts/set-version.mjs 0.3.0
git commit -am "release: 0.3.0" && git tag -a v0.3.0 -m "…"
git push origin main && git push origin v0.3.0
# CI builds, signs, publishes, and generates latest.json
```

Remove "publish the draft" and the ThinkPad step from the documented happy path.
Add a short note that v0.2.9 and earlier require a manual reinstall due to the key
rotation.

---

## 7. Flag for Anthony, don't decide alone

**`dangerousInsecureTransportProtocol: true`** exists because the ThinkPad mirror
is plain HTTP. Keeping the mirror means keeping the flag. Signature verification
still protects payload integrity, but shipping a public app with that flag set
invites questions. Options: keep it (mirror survives), drop mirror + flag
(GitHub only), or put the mirror behind HTTPS.

---

## 8. Acceptance

- [ ] Real mirror URL recovered; no `sync.example` anywhere
- [ ] `endpoints` = GitHub first, mirror second
- [ ] `pubkey` matches the new keypair
- [ ] Test tag (`v0.2.10`) publishes installers + `latest.json` with no manual step
- [ ] Release is **not** marked prerelease
- [ ] Every platform in `latest.json` has a non-empty signature
- [ ] Fresh install of the new build updates via the **GitHub** endpoint with the
      ThinkPad powered off
- [ ] macOS `.dmg` downloaded **through a browser** opens without "damaged"
      (`curl` doesn't set the quarantine attribute and won't reproduce the bug)
- [ ] `docs/UPDATES.md` + `HANDOFF.md` updated
- [ ] `scripts/ci-check.sh` green

---

## 9. Human steps after this lands

1. Manually install the new build on MacBook, Mac mini, and Windows desktop —
   auto-update cannot bridge the key change
2. Confirm each launches and unlocks the existing vault (the vault master password
   is unrelated to the updater key; nothing should change)
3. Verify auto-update works between the new build and a subsequent test tag
4. Delete `~/.tethra-updater-OLD.key` once all three are on the new build
5. Repo Settings → secret scanning, push protection, Dependabot, branch protection
   on `main`; Actions → require approval for outside-collaborator fork PRs

---

## Do NOT

- Regenerate the updater keypair
- Commit any private key, or `cat` one into a shared log or chat
- Delete `~/.tethra-updater-OLD.key` before §9.4
- Guess the mirror URL — ask
- Mark the test release as a prerelease
- Start M13, BYOK, notifications, or design work
