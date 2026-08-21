# NEXT — sync server on Azure + vault-derived device auth

> **Scope:** this task only. Do not start agent notifications, SSH agent
> forwarding, port forwarding, terminal search, or Windows chrome — those are
> the next briefs. No changes to `inject.ts` / `registry.ts` input paths.
> Baseline: `v0.3.1` on `main`, GitHub-only updates working.
>
> **Why now:** the Azure startup-credit clock needs the sync server running as a
> real workload, and Anthony wants device auth that doesn't require pasting a
> bearer token on every new machine. Azure portal work (resource creation,
> secrets) is Anthony's; everything below is code.

---

## 1. Containerize `tethra-sync-server`

- Multi-stage `Dockerfile` at `crates/sync-server/Dockerfile` (builder →
  `debian:bookworm-slim` or distroless). Final image runs as non-root.
- Bind address, port, and data directory configurable via env
  (`TETHRA_SYNC_ADDR`, `TETHRA_SYNC_PORT`, `TETHRA_SYNC_DATA`), falling back to
  existing `config.toml` behavior — self-host setups keep working unchanged
  (hard rule 11: additive).
- Data dir is a mounted volume (Container Apps `azurefile` mount). No state in
  the image, no secrets in the image or repo (hard rule 12).
- Add `GET /healthz` (no auth, returns version) for ingress probes.

## 2. CI: build and push the image

- New workflow `.github/workflows/sync-server-image.yml`:
  - Triggers: `workflow_dispatch` + pushes to `main` touching `crates/sync-server/**`
  - Build with `docker/build-push-action`, tag `latest` + short SHA
  - Push to ACR using `docker/login-action` with secrets
    `ACR_LOGIN_SERVER` / `ACR_USERNAME` / `ACR_PASSWORD` (Anthony creates these;
    skip the push step with a friendly notice if secrets are absent so forks
    stay green)
- `scripts/ci-check.sh` must not require Docker.

## 3. Vault-derived device auth (kill the pasted token)

Today every device needs the bearer token from the server's `config.toml`.
Replace the day-to-day path with what `PROJECT.md` §6.1 already designs:

- Client derives `auth_key = HKDF-SHA256(master_key, "vault-auth-v1")` on
  unlock. **`enc_key` / vault key never leave the device (hard rule 10).**
- Server stores only `argon2id(auth_key)` (its own salt/params), never
  `auth_key` itself.
- Endpoints (versioned under `/v1/`):
  - `GET /v1/vault-header` — **unauthenticated.** Returns the KDF salt +
    Argon2 params (already plaintext metadata by design). This is what lets a
    brand-new device derive `auth_key` from just the master password.
  - `POST /v1/enroll` — first caller after server setup registers the verifier.
    Requires the legacy bearer token **or** an empty server (explicit
    `--allow-enroll` / config flag). One vault per server.
  - `POST /v1/auth` — proves `auth_key`, returns a short-lived session token
    (opaque, in-memory or on-disk, 24h) used as `Authorization: Bearer` on the
    existing item endpoints.
- Constant-time comparison; rate-limit `/v1/auth` (e.g. 5/min/IP with backoff).
- Legacy static token keeps working (additive). New-device UX in the app:
  enter server URL + master password → sync works. No token field unless the
  user opts into legacy mode.
- TLS is terminated by Container Apps ingress in the hosted case; keep plain
  HTTP possible for LAN/Tailscale self-host, as today.

## 4. Client wiring

- `HttpBackend`: on 401, run `/v1/auth` with the derived `auth_key`, retry once.
- Settings → Sync: server URL + status (enrolled / authenticated / legacy
  token). Surface enroll errors plainly.
- No `auth_key` or session token in React state or web storage (hard rules 2/4)
  — both live in Rust; frontend gets status strings by ID as usual.

## Do NOT

- Build accounts, e-mail identities, Stripe, or multi-vault multi-tenancy —
  that's Phase 2 proper, after v0.4.0
- Add a Postgres backend yet (the Azure instance exists for the credit clock;
  wiring it is a later brief)
- Touch the updater, signing keys, or release workflow
- Log hostnames, tokens, or key material (PROJECT.md §14)

## Acceptance

- [ ] `docker build` from repo root produces a runnable image; `/healthz` OK
- [ ] Image workflow green on `workflow_dispatch` (push step skips politely
      without secrets)
- [ ] Fresh device: URL + master password → syncs; wrong password → clean
      failure, rate-limited
- [ ] Legacy token path still syncs (existing ThinkPad setup untouched)
- [ ] No plaintext secret crosses IPC; `cargo test -p core` + sync-server tests
      green; `scripts/ci-check.sh` green
- [ ] `docs/UPDATES.md` untouched; brief archived to `docs/archive/` when done
