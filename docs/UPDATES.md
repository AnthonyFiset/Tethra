# Automatic updates

Desktop clients self-update from the **same server that hosts vault sync**. No
extra configuration: if Vault sync points at an HTTP server, updates come from
that server too.

## Why not straight from GitHub

The repo is private, so release assets require a credential. Embedding one in
the app would leak it. The sync host is already authenticated with `gh` and
already reachable from every device over Tailscale, so it mirrors the assets
instead. Payloads are minisign-signed by CI and verified on the client, so the
mirror never has to be trusted.

## Release flow

1. Tag a release: `git tag v0.2.1 && git push origin v0.2.1`
2. CI stamps the version from the tag into every manifest
   (`scripts/set-version.mjs`), builds installers, signs updater artifacts with
   `TAURI_SIGNING_PRIVATE_KEY`, and publishes `latest.json`.
3. **Publish the draft release** on GitHub — `gh` only sees published releases.
4. On the sync host, mirror it:

```bash
tethra-sync-server fetch-updates            # latest published release
tethra-sync-server fetch-updates --tag v0.2.1
```

5. Clients show "Tethra x.y.z is available" on next launch and update in place.

To keep the host current automatically, install the updates timer (also offered
by the setup wizard):

```bash
tethra-sync-server install-updates-timer
# later: tethra-sync-server uninstall-updates-timer
```

That writes units whose `ExecStart` points at the installed binary:

```ini
# ~/.config/systemd/user/tethra-updates.service
[Unit]
Description=Mirror Tethra release assets

[Service]
Type=oneshot
ExecStart=/path/to/tethra-sync-server fetch-updates
```

```ini
# ~/.config/systemd/user/tethra-updates.timer
[Unit]
Description=Check for new Tethra releases hourly

[Timer]
OnBootSec=5min
OnUnitActiveSec=1h
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
systemctl --user status tethra-updates.timer
```

## Why `dangerousInsecureTransportProtocol` is on

The sync host serves plain HTTP on a tailnet, and the updater plugin refuses
non-`https` endpoints in release builds — it fails to initialize, which takes
the whole app down at startup. Debug builds only print a warning, so this only
ever shows up in a shipped binary.

Enabling the flag is safe here because the update payload is minisign-signed by
CI and verified on the client before install: a tampered or swapped payload is
rejected regardless of transport. Turn it off if the update host ever gets a
TLS certificate.

## Signing keys

CI signs with `TAURI_SIGNING_PRIVATE_KEY` (repo secret); the app verifies with
the public key in `tauri.conf.json` under `plugins.updater.pubkey`.

The private key is also saved at `~/.tethra-updater.key` on the machine that
generated it. **Back it up.** Losing it means shipped clients can no longer
verify new updates, and every device must be reinstalled by hand.

## Endpoints

The server exposes, unauthenticated:

| Route | Purpose |
|---|---|
| `GET /updates/{target}/{arch}/{current_version}` | Manifest, or `204` when current |
| `GET /updates/download/{file}` | Mirrored asset |

These skip the sync token deliberately: a device that cannot authenticate is
exactly the device that most needs to update. Integrity comes from the
signature, not the transport.
