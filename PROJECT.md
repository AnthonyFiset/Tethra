# Tethra — cross-platform SSH/SFTP client

> **For Cursor:** this file is the source of truth for architecture decisions.
> Read the **Hard rules** section before writing any code. If a request conflicts
> with a hard rule, say so and propose an alternative rather than silently
> breaking the rule.

---

## 1. What we're building

A free, open-source SSH and SFTP client with an encrypted vault of saved hosts
that syncs across devices — and the place coding agents run, on your laptop and
on every machine you own. Not an agent itself: a *host* for agents (Claude Code,
Codex CLI, OpenCode, aider, and whatever replaces them next — catalogs, not
compiled presets). The vault, fleet, and sync are the expensive half; the wedge
is **session persistence** (transparent multiplexer wrap so an agent survives
sleep/network/lid close and can reattach from another device).

**Desktop first** (macOS, Windows, Linux). **Mobile last (M14)** — check on agents
already running — but every decision today is made so that mobile is a port, not
a rewrite.

The original Termius-with-unread-credentials scope is done through M6.1. The
post-M6.1 narrative through Assist is in [docs/archive/ROADMAP-v2.md](docs/archive/ROADMAP-v2.md); **what
to build next** is [ROADMAP.md](ROADMAP.md). §9's `exec` path and
`ApprovalGate` remain the seam Assist (M9) plugs into.

---

## 2. Hard rules

These are not preferences. Violating any of them creates work that has to be
undone later.

1. **`crates/core` must never depend on `tauri`.** Not the crate, not a feature
   flag, not a transitive dep. CI enforces this (§4.1).
2. **No platform APIs inside `core`.** No `dirs::`, no `std::env::var` for paths,
   no `#[cfg(target_os)]`. Platform access goes through the traits in §5.
3. **Plaintext secrets never cross the IPC boundary into JavaScript.** The
   frontend refers to hosts and identities by ID only.
4. **No secrets in `localStorage`, `sessionStorage`, or IndexedDB.** Ever.
5. **Session state lives in Rust, keyed by session ID. Tab and pane *layout* is
   frontend state. OS windows are a desktop-only presentation layer over the
   same session registry.** Panes can move between windows; closing a window
   must not kill its sessions. Mobile never opens a second window.
6. **No fixed-width desktop chrome.** Layout must collapse to a single column
   under 768px from day one, even if it looks unpolished.
7. **Every struct holding key material derives `Zeroize` / `ZeroizeOnDrop`.**
8. **No `unsafe` in `core`** — `#![forbid(unsafe_code)]` at the crate root.

---

## 3. Stack

| Layer | Choice | Notes |
|---|---|---|
| Shell | Tauri v2 | Already supports iOS/Android targets |
| Core language | Rust (2024 edition) | |
| SSH | `russh` + `russh-sftp` | Pure Rust, no C deps, cross-compiles to iOS cleanly |
| SSH config parsing | `russh-config` | Gets us `ProxyCommand` / `ProxyJump` nearly free |
| Async runtime | `tokio` (multi-thread) | |
| Storage | `rusqlite` (bundled SQLite) | Stores already-encrypted blobs |
| KDF | `argon2` (RustCrypto) | Argon2id only |
| AEAD | `chacha20poly1305` (XChaCha20-Poly1305) | 24-byte nonces, safe to random-generate |
| HKDF | `hkdf` + `sha2` | |
| Memory hygiene | `zeroize`, `secrecy` | |
| Desktop secrets | `keyring` | Keychain / Credential Manager / Secret Service |
| Frontend | React + TypeScript + Vite | |
| Terminal | `@xterm/xterm` + `@xterm/addon-webgl` + `@xterm/addon-fit` | |

**Do not add** Electron, Node-based SSH libraries, `openssl`, or anything
requiring a C toolchain in the core path. Each of those breaks iOS
cross-compilation or bloats the binary.

---

## 4. Repository layout

```
crates/
  core/                 # portable. the whole product lives here.
    src/
      model/            # Host, Identity, Snippet, PortForward, Folder
      vault/            # key derivation, item encryption, unlock/lock
      ssh/              # session manager, pty channel, exec channel, sftp
      sync/             # storage adapter trait, cursor, conflict resolution
      error.rs
  platform/             # trait definitions ONLY. no impls.
  platform-desktop/     # keyring, dirs, desktop biometrics
  platform-ios/         # stub today. exists so the shape is obvious.
apps/
  tauri/                # command handlers + event plumbing. glue only.
    src-tauri/
  ui/                   # React app
    src/
      lib/ipc.ts        # the ONLY file that calls invoke()
      terminal/
      vault/
      sftp/
docs/
```

### 4.1 CI boundary check

Add this to CI. It is the single most important guardrail in the project.

```bash
cargo tree -p core --edges normal --prefix none \
  | grep -qE '^(tauri|wry|tao)' \
  && { echo "FAIL: core depends on the Tauri stack"; exit 1; }
cargo check -p core --target aarch64-apple-ios
```

The second line is the real test — if `core` compiles for iOS today, mobile stays
a port forever.

---

## 5. Platform traits

Defined in `crates/platform`. `core` receives these as `Arc<dyn Trait>` at
startup and never reaches for the OS itself.

```rust
#[async_trait]
pub trait SecretStore: Send + Sync {
    async fn get(&self, key: &str) -> Result<Option<Vec<u8>>>;
    async fn set(&self, key: &str, value: &[u8]) -> Result<()>;
    async fn delete(&self, key: &str) -> Result<()>;
}

pub trait AppPaths: Send + Sync {
    fn data_dir(&self) -> PathBuf;
    fn cache_dir(&self) -> PathBuf;
}

#[async_trait]
pub trait Biometrics: Send + Sync {
    fn is_available(&self) -> bool;
    async fn authenticate(&self, reason: &str) -> Result<()>;
}

/// Hardware-backed signing. Desktop impls may return Unsupported —
/// core must handle that branch, not assume it away.
#[async_trait]
pub trait HardwareKey: Send + Sync {
    fn is_available(&self) -> bool;
    async fn generate(&self, key_id: &str) -> Result<PublicKey>;
    async fn sign(&self, key_id: &str, data: &[u8]) -> Result<Vec<u8>>;
}

pub struct ShellSpec {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: Option<PathBuf>,
    pub env: Vec<(String, String)>,
}

/// Local process spawning is a platform capability. Desktop uses
/// `portable-pty`; iOS/Android report Unsupported.
pub trait LocalPty: Send + Sync {
    fn is_available(&self) -> bool;
    fn default_shell(&self) -> Option<ShellSpec>;
    fn spawn(&self, spec: ShellSpec, size: PtySize)
        -> Result<(Box<dyn LocalPtySession>, mpsc::Receiver<Bytes>)>;
}
```

Secure Enclave only does ECDSA P-256, so `HardwareKey` keys are
`ecdsa-sha2-nistp256`. Software keys default to Ed25519.

---

## 6. Vault and crypto

### 6.1 Key derivation

```
master_key  = Argon2id(password, salt, m=65536 KiB, t=3, p=4, len=32)
enc_key     = HKDF-SHA256(master_key, info="vault-enc-v1",  len=32)
auth_key    = HKDF-SHA256(master_key, info="vault-auth-v1", len=32)
```

- `salt` is 16 random bytes, stored in the local DB and synced as plaintext
  metadata. Salts are not secret.
- Argon2 params are **stored alongside the salt** so they can be raised later
  without breaking existing vaults. Never hard-code them at the read path.
- `enc_key` never leaves the device. `auth_key` is what the sync server sees.
- The server stores `Argon2id(auth_key)` again server-side, so a database leak
  does not yield login credentials.

### 6.2 Vault key

A random 32-byte `vault_key` is generated at vault creation and encrypted with
`enc_key`. This indirection means a master password change re-encrypts one
32-byte value, not the whole vault.

### 6.3 Item encryption

Each item is encrypted **individually** — not as one blob. This is what makes
sync conflicts resolvable per-item.

```
nonce      = 24 random bytes
ciphertext = XChaCha20-Poly1305(vault_key, nonce, plaintext, aad = item_id || version)
```

Binding `item_id` and `version` into the AAD prevents an attacker who controls
the server from swapping or replaying items between records.

### 6.4 Lock state

`Vault` has exactly two states: `Locked` (no key material in memory) and
`Unlocked { vault_key: Secret<[u8; 32]> }`. Auto-lock on a configurable idle
timer, on OS sleep, and on explicit lock. Locking must zeroize, not just drop.

---

## 7. Data model

```rust
struct Host {
    id: Uuid,               // v7, sortable
    label: String,
    hostname: String,
    port: u16,              // default 22
    username: String,
    identity_id: Option<Uuid>,
    jump_host_id: Option<Uuid>,
    folder_id: Option<Uuid>,
    known_host_key: Option<KnownHostKey>,
    tags: Vec<String>,
    color: Option<String>,
}

enum Identity {
    Password { secret_ref: SecretRef },
    PrivateKey { key: EncryptedBytes, passphrase: Option<SecretRef> },
    HardwareKey { key_id: String },   // never syncs, device-local
    Agent,                            // defer to ssh-agent
}
```

**Key sync policy for v1:** host metadata syncs, private keys do **not**. A
`HardwareKey` or locally-generated identity stays on its device; the app helps
you append its public key to a host's `authorized_keys`. Syncing encrypted
private keys is a later opt-in feature, off by default. Do not make it the
default — one master password compromise should not lose every host.

**Password sync (M6.2):** an explicit per-identity `sync_secret` flag, default
off. When on, the password rides the same item encryption as other vault items —
the sync server still learns nothing. This does **not** change the private-key
policy above.

**Shipped (M8):** first-class `Project` (local or remote location + default agent)
and `AgentSpec` (launch command, env, `persistent` multiplexer wrap). Projects
and running-session markers sync like hosts. See [docs/milestones/M8.md](docs/milestones/M8.md).

---

## 8. Sync

The server is deliberately stupid. It authenticates, stores opaque rows, and
returns everything changed since a cursor.

```
GET  /v1/items?since=<cursor>   -> { items: [...], cursor: "..." }
POST /v1/items                  -> { cursor: "..." }
```

Row shape (all the server ever sees):

```json
{
  "id": "uuid-v7",
  "kind": "host | identity | snippet | folder",
  "version": 7,
  "updated_at": "2026-07-29T10:00:00Z",
  "deleted": false,
  "nonce": "base64",
  "ciphertext": "base64"
}
```

**Conflict resolution:** last-write-wins on `version`, tie-broken by
`updated_at`, then by `id` for determinism. Deletes are tombstones retained for
30 days, never hard deletes — a hard delete on one device racing a sync on
another silently resurrects the row.

**Storage adapter trait.** Do not hard-code an HTTP client. Define
`trait SyncBackend` in `core/sync` and ship these impls in order:

1. `LocalOnly` — no sync at all. Ship v1 with this.
2. `FileBackend` — a directory the user points at iCloud Drive, Dropbox, or a
   git repo. Zero infrastructure, genuinely free, self-hosting by default.
3. `HttpBackend` — the optional hosted server, built last.

---

## 9. SSH layer

`core/ssh` exposes **two distinct paths**. Build both from the start even though
only the first has a UI today — the second is the seam the AI agent layer plugs
into, and retrofitting it means screen-scraping your own terminal.

```rust
impl SessionManager {
    /// Interactive path. Raw bytes, ANSI intact, straight to xterm.js.
    async fn open_pty(&self, host_id: Uuid, size: PtySize)
        -> Result<(PtyHandle, mpsc::Receiver<Bytes>)>;

    /// Structured path. No PTY, no ANSI, parseable.
    async fn exec(&self, host_id: Uuid, cmd: &str)
        -> Result<ExecResult>;   // { stdout, stderr, exit_code }

    async fn sftp(&self, host_id: Uuid) -> Result<SftpSession>;
}
```

Both paths route through an `ApprovalGate` hook before executing. It is a no-op
today, but the call site exists so Assist (M9) and agent-initiated destructive
commands can require confirmation without restructuring anything.

### 9.1 Host key verification

Trust-on-first-use with an explicit prompt. On mismatch: **refuse to connect**
and surface a clear warning. Never auto-accept a changed host key, never offer a
"remember and ignore" option.

---

## 10. Terminal performance

The naive implementation emits one Tauri event per SSH packet, JSON-serializes
it, and collapses the first time someone `cat`s a large file. Do it right up
front:

- **Coalesce PTY output in Rust** on a ~10ms tick into a single chunk before
  emitting. Cap chunk size around 64 KiB and flush early if exceeded.
- **Use Tauri v2 raw IPC / channels** for terminal data, not the JSON event
  system.
- **Enable `@xterm/addon-webgl`** with a canvas fallback.
- **Debounce resize** — send `window-change` at most every 100ms while dragging.
- Backpressure: if the frontend falls behind, drop from the *middle* of the
  buffer and mark it, rather than unbounded growth.

---

## 11. Frontend rules

- `src/lib/ipc.ts` is the only file permitted to call `invoke()`. Everything else
  imports typed wrappers from it. This keeps the mobile port to one file.
- Generate TS types from Rust with `ts-rs` or `specta`. Do not hand-maintain
  duplicate interfaces.
- Never hold a private key, password, or passphrase in React state.
- Terminal instances live in a module-level registry keyed by session ID, not in
  component state — React remounts must not kill sessions.
- Layout breakpoint at 768px: sidebar becomes a drawer, terminal goes full-bleed.

---

## 12. Milestones

**Do not maintain a milestone board here.** What’s done / what’s next lives only
in [`ROADMAP.md`](ROADMAP.md). The current engineering task is always
[`NEXT.md`](NEXT.md). Historical writeups: [`docs/milestones/`](docs/milestones/).

Agent brief (landmines, verify, release): [`HANDOFF.md`](HANDOFF.md).

---

## 13. Explicitly out of scope for now

Do not build these, and push back if asked outside the milestone that owns them:

- Anything beyond M9 Assist that turns Tethra into an agent (host agents; don't
  compete with them)
- Telnet, serial, RDP, VNC
- Mosh (revisit with M14 if mobile needs it, not before)
- Team/organization sharing
- Plugin system
- Migrating Radix → Base UI “because shadcn did” (v3: stay on Radix)
- Replacing xterm.js with Ghostty-WASM or similar (v3: stay; fix scroll-jump in M12)
- A custom multiplexer (shell out to `tmux` / `zellij`)
- Compiling agent/provider presets into the binary as the long-term source of
  truth (M11 catalogs are data)

---

## 14. Conventions

- `thiserror` in `core`, `anyhow` in `apps/tauri` only.
- Every public `core` function returns `core::Result<T>`. No `unwrap()` or
  `expect()` outside tests and `main`.
- `tracing` for logs. **Never log hostnames, usernames, key material, or command
  contents** above `debug`, and redact them even there.
- Tests: unit tests colocated; SSH integration tests run against a
  `linuxserver/openssh-server` container in CI.
- Conventional commits.
