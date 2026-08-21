> **Completed — 2026-08-21.** SSH key identities importable and connectable.

# NEXT — SSH key identities (connect with a key, not just a password)

> **Scope:** this task only. Do not start agent forwarding, port forwarding,
> terminal search, Windows chrome, accounts/Stripe, or Postgres wiring — those
> are later briefs. No changes to `inject.ts` / `registry.ts` input paths.
> Baseline: `main` at `1e772ab` (hosted sync live on Azure Container Apps).
>
> **Why now:** Anthony's first cloud host (`tethra-vm`, Ubuntu on Azure) only
> accepts key auth — the portal-generated `.pem` in `~/.ssh/`. The host form is
> password-only ("Password is required for a new host"), so Tethra cannot
> connect to its own cloud box. The engine is already done: `russh` key auth
> exists in `crates/core/src/ssh/session.rs` (`AuthKind::PrivateKey`,
> `load_private_key` with passphrase support), and `model/host.rs` already has
> `identity_id: Option<Uuid>` referencing a vault `Identity`. This brief is the
> missing vault storage + IPC + UI, not a new engine.

---

## 1. Vault: key identities

- Identity kinds: `Password` (today's behavior, unchanged) and `SshKey`
  { private key bytes (OpenSSH/PEM), optional passphrase, label, created_at }.
- Encrypted at rest in the vault like passwords. **Never synced** — the host
  form copy already promises "SSH private keys never sync"; make it true
  structurally (excluded from sync rows, not just flagged).
- Reusable: one identity can serve many hosts (`identity_id` already models
  this). CRUD: create (import), rename, delete; deleting an identity in use
  warns and lists dependent hosts.
- Accept the formats people actually have: OpenSSH (`id_ed25519`), PEM/RSA
  (Azure/AWS `.pem`). Reject with a plain error naming the format if unsupported.
  Encrypted keys: accept, store the passphrase alongside (encrypted) or prompt
  at connect — importer's choice via a checkbox ("remember passphrase").

## 2. IPC (Tauri)

- Commands: `identity_import` (path + optional pasted passphrase),
  `identity_list` (summaries only — label, kind, fingerprint, usage count),
  `identity_rename`, `identity_delete`.
- Key material and passphrases never cross to the frontend and never sit in
  React state (hard rules 2/4). Frontend deals in identity IDs + summaries;
  the file's bytes are read Rust-side from the picked path.
- Generated DTO bindings as usual (`export_bindings_*` tests).

## 3. UI

- **Host form:** an auth selector — `Password` | `SSH key`. Key mode shows a
  dropdown of existing identities plus "Import key…" (native file picker,
  defaulting to `~/.ssh`). Passphrase field appears only when the key needs
  one. Password mode is pixel-identical to today.
- **Settings → Vault (or a new Identities section):** list identities with
  fingerprint + which hosts use them; rename/delete.
- **`~/.ssh/config` import:** the importer already captures
  `identity_file_hint`. When a host with a hint is imported, offer one-click
  "import this key too" that reads the hinted file into a new identity and
  links it.

## 4. Connect path

- Host with a key identity → `AuthKind::PrivateKey` (already implemented).
  Wrong passphrase / rejected key → the existing plain-language error surface,
  distinguishing "server refused the key" from "couldn't read/decrypt the key".
- Passwordless hosts with a key identity must not trip the "enter a password to
  connect" gate.

## Acceptance

- Add `tethra-vm` (Azure Ubuntu, user `anthony`) via Add host → SSH key →
  import `~/.ssh/tethra-vm_key.pem` → Connect: lands in a shell. Relaunch app,
  reconnect after vault unlock: works with no re-import.
- A password host created before this brief connects exactly as before.
- Vault sync to the Azure server: hosts with key identities sync as hosts, but
  no key bytes appear in pushed rows (verify in the sync payload, not just UI).
- `scripts/ci-check.sh` green.

## Do NOT

- SSH agent forwarding or `ssh-agent` integration (next brief; design the
  identity enum so an `Agent` variant can be added without migration pain)
- Accounts, e-mail login, Stripe, Postgres — Phase 2 proper, still deferred
- Key *generation* (import only for now)
- Touch sync-server, updater, or release workflows
