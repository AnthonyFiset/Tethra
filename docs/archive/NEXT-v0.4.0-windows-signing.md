# NEXT — v0.4.0 step 1 of 4: Windows code signing

> **v0.4.0 rollout (ROADMAP Part 4 — "table stakes + wedge"):** four briefs,
> one release at the end. Notifications already shipped early (v0.3.2).
>
> 1. **Windows code signing** ← this brief
> 2. Terminal search (⌘F) + SFTP recursive folder transfer
> 3. Port forwarding (local/remote tunnels)
> 4. SSH agent forwarding (per-host opt-in) → then stamp + release v0.4.0
>
> **Scope:** this brief is ONLY signing. Do not start the other three. No
> changes to `inject.ts` / `registry.ts`. Baseline: `main` (v0.3.2 shipped).
>
> **Why now:** identity validation for **Biz Inbound Inc.** completed
> 2026-08-21 (valid to 2028-11-23). Azure side is fully provisioned — this
> brief is CI wiring only.

---

## Provisioned (Anthony, done — do not recreate)

- Artifact Signing account `tethra-signing` (East US, Basic),
  **Account URI: `https://eus.codesigning.azure.net/`**
- Certificate profile **`tethra-public-trust`** (Public Trust, active),
  subject `CN=Biz Inbound Inc., O=Biz Inbound Inc., L=Richmond Hill, S=Ontario, C=CA`
- Entra app `tethra-signing-ci` with the **Artifact Signing Certificate
  Profile Signer** role on the account
- GitHub Actions secrets: `AZURE_SIGNING_TENANT_ID`,
  `AZURE_SIGNING_CLIENT_ID`, `AZURE_SIGNING_CLIENT_SECRET`

## 1. Sign the Windows artifacts in the release workflow

Two viable mechanisms — pick the cleaner one after a look at our release
workflow, and note the choice in the PR:

- **A (preferred if it fits):** Tauri's `bundle.windows.signCommand` invoking
  `trusted-signing-cli` (the Azure Artifact/Trusted Signing CLI), so Tauri
  signs both the app `.exe` and the installer during bundling.
- **B:** post-build step with Microsoft's official signing GitHub Action
  (`azure/trusted-signing-action` — check for an artifact-signing rename)
  over the bundle outputs.

Requirements either way:
- Both the **app executable and the installer** (NSIS/MSI — whatever we ship)
  end up signed. SHA-256 digest, RFC 3161 timestamp (use the endpoint's
  timestamping service) so signatures outlive the cert.
- Signing params: endpoint `https://eus.codesigning.azure.net/`, account
  `tethra-signing`, profile `tethra-public-trust`, auth via the three
  `AZURE_SIGNING_*` secrets (client-secret credential).
- **Secret-gated:** when the secrets are absent (forks, PRs), skip signing
  with a friendly notice and still produce unsigned artifacts — same pattern
  as the ACR push and site deploy workflows. `scripts/ci-check.sh` must not
  require any signing tooling.
- No signing of macOS artifacts in this brief (Apple Developer ID is a
  separate later decision).

## 2. Updater sanity

- Confirm the Tauri updater accepts the newly signed Windows binaries
  (updater signature = existing `TAURI_SIGNING_PRIVATE_KEY` minisign flow,
  unrelated to Authenticode — both must coexist untouched).

## Acceptance

1. Dispatch a pre-release build (e.g. tag `v0.4.0-beta.1` or a
   workflow_dispatch lane) with secrets present → download the Windows
   installer → **Properties → Digital Signatures shows "Biz Inbound Inc.",
   timestamped, valid**. Verify on the `tethra-win` VM: install runs without
   the "unknown publisher" red banner. (SmartScreen *reputation* may still
   warm up over days — unknown-publisher going away is the acceptance bar.)
2. A run without the secrets stays green and produces unsigned artifacts
   with the skip notice.
3. `scripts/ci-check.sh` green.

## Do NOT

- Start terminal search, SFTP recursive, port forwarding, or agent
  forwarding (briefs 2–4)
- Stamp v0.4.0 (that happens in brief 4)
- Touch macOS signing/notarization, the minisign updater keys, or sync-server
- Print or log any `AZURE_SIGNING_*` values
