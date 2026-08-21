# Automatic updates

Desktop clients self-update from **GitHub Releases**. CI builds installers,
minisign-signs updater artifacts, uploads `latest.json`, and publishes the
release when every platform finishes. No ThinkPad / sync-host mirror is required
for updates (vault sync over HTTP remains optional and separate).

## Release flow

```bash
node scripts/set-version.mjs 0.3.0
git commit -am "release: 0.3.0"
git tag -a v0.3.0 -m "v0.3.0"
git push origin main
git push origin v0.3.0
# CI: require-ci → matrix builds → undraft release → latest.json live
```

Clients poll:

`https://github.com/AnthonyFiset/Tethra/releases/latest/download/latest.json`

That path **excludes prereleases**. Never mark a shipping tag as prerelease.

## Key rotation note (2026-08-20)

The updater signing keypair was rotated after the previous private key was
exposed. **v0.2.9 and earlier cannot auto-update** to builds signed with the new
key — they still embed the old public key. Install the first post-rotation build
manually on each machine; later updates resume normally.

Do **not** regenerate the keypair again unless it is compromised. Signing
failures are usually a malformed Actions secret or password mismatch.

## Verify a release

```bash
curl -sL https://github.com/AnthonyFiset/Tethra/releases/latest/download/latest.json \
  | jq '.platforms | keys, (.[].signature | length)'
```

Every platform key needs a non-empty signature length. Download macOS `.dmg`
**through a browser** when checking Gatekeeper (“damaged” often means quarantine
+ missing ad-hoc signature; `curl` alone won’t reproduce quarantine).

## Sync server (vault only)

`tethra-sync-server` still syncs vault ciphertext. Its optional `fetch-updates`
mirror is **retired for the client updater path**. Prefer GitHub Releases for
desktop updates; leave the mirror disabled unless you have a private fork that
needs it.

## Public key

The minisign public half lives in `tauri.conf.json` under `plugins.updater.pubkey`.
The private half is only in GitHub Actions secrets (`TAURI_SIGNING_PRIVATE_KEY` /
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) and the operator’s local
`~/.tethra-updater.key` — never commit it.
