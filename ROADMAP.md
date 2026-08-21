# Tethra roadmap

_Revision 6 — 2026-08-21 (v0.3.1 shipped, auto-update proven; plan focuses
v0.4.0). Current plan. Filename stays `ROADMAP.md`; bump the revision line, not
the name._

_Supersedes archived `docs/archive/ROADMAP-v2.md` / `ROADMAP-v3.md`._

---

## Product, restated

Tethra is an E2E-encrypted SSH/SFTP vault client that **hosts coding agents**
across your machines. Not an agent itself.

**Wedge:** tmux persistence + vault sync reattach. Start Claude Code on the
ThinkPad from your MacBook, close the lid, resume from your Windows desktop.
Warp is local-only. Termius has no agent story. Nobody ships the combination.

**Non-negotiable:** nobody can read your vault, including us. Every business
decision is subordinate to that.

---

## Part 1 — What's done

### Foundation
Portable `crates/core` with SSH PTY/exec/SFTP, vault crypto (Argon2id + HKDF +
XChaCha20-Poly1305, per-item encryption), sync (`FileBackend` + `HttpBackend`),
coordinated re-key, opt-in password `sync_secret`, iOS portability guard in CI.

### Terminal
OSC 133 blocks, alt-screen, truecolor, bracketed paste, OSC 52/7, Unicode 11,
mouse. Splits and multi-window. Sessions live in Rust by ID — closing a window
doesn't kill them. Same-device scrollback via `addon-serialize` + IndexedDB.
DEC 2026 ED2/ED3 scroll-jump filter for agent TUIs.

### Agents and projects
Projects (local or remote host + path), `AgentSpec` catalog, open → cd → launch,
tmux/zellij persistence, RunningSessions with reattach. Tab × = detach; sidebar
Kill = kill mux. Tools probe + install dialog.

### Catalogs
Bundled `agents.json` and `assist_providers.json` as **data, not code**. Assist
provider flow: preset → paste key → Test (`GET /models`) → live model list → save
as vault item. Gemini CLI marked deprecated → Antigravity successor.

### Product UI
Launcher ↔ Workspace with ⌘Esc. Resume-first dashboard. Command palette. Unified
Settings. Window materials (opaque default, vibrancy/Mica opt-in). macOS menu bar.
Custom context menus. Assist (⌘I) — propose/explain, insert without auto-run.

### v0.3.0 polish — shipped 2026-08-21
Azure OpenAI preset (`api-key` auth, deployment names) in the catalog. BYOK
injection at launch — vault key → preset `byok_env` names → process env; remote
via `0600` env file (never a tmux command line; `/proc/PID/environ` caveat
documented). Launcher shows Running first with an honest empty state. Settings
sections filled or hidden, palette-reachable. Design Track D: `Host.color` as
ambient identity (rail / tab / viewport hairline), type hierarchy, mono-vs-sans,
real empty states. Brief: [`docs/archive/NEXT-v0.3.0.md`](docs/archive/NEXT-v0.3.0.md).

### Distribution — completed 2026-08-21
- Security audit clean (`docs/PUBLIC-RELEASE-AUDIT.md`), history kept
- **Repo public**, Apache-2.0, `SECURITY.md`, `README.md`, `CONTRIBUTING.md`
- Secret scanning, push protection, AI detection, Dependabot, code scanning on
- Ruleset on `main` blocking force-push and deletion
- **Updater signing key rotated** after exposure; old key destroyed
- **GitHub Releases as the only update channel** — `tauri-action`, four-platform
  matrix, auto-publish on tag, no mirror, no `dangerousInsecureTransportProtocol`
- ThinkPad mirror retired; it is now purely a vault sync server

### Sync server (Azure-ready) — completed 2026-08-21
- `crates/sync-server/Dockerfile` multi-stage image; `GET /healthz` returns version
- Env bind/data (`TETHRA_SYNC_LISTEN` / `ADDR`+`PORT` / `DATA`); workflow
  `.github/workflows/sync-server-image.yml` (push skips politely without ACR secrets)
- Vault-derived device auth: `GET /v1/vault-header`, `POST /v1/enroll`, `POST /v1/auth`
  (argon2id verifier, 24h session, rate limit); legacy bearer still works
- Client: `HttpBackend` 401 → `/v1/auth` retry; Settings/VaultGate URL + master
  password first (legacy token opt-in). Brief:
  [`docs/archive/NEXT-azure-sync-device-auth.md`](docs/archive/NEXT-azure-sync-device-auth.md)

### SSH key identities — completed 2026-08-21
- Vault `IdentityRecord::{Password,SshKey}` (keys always `local_only`, never sync)
- Import OpenSSH / PEM RSA via `russh::keys::decode_secret_key`; IPC list/import/
  probe/rename/delete; host form Password | SSH key; Settings → Vault identities
- `~/.ssh/config` import exposes `identityFileHint` + one-click key import
- Brief: [`docs/archive/NEXT-ssh-key-identities.md`](docs/archive/NEXT-ssh-key-identities.md)

**Proven 2026-08-21:** end-to-end auto-update over the GitHub endpoint with the
rotated key — v0.2.11 machines updated to v0.3.1 cleanly. (The `v0.3.0` tag
exists but never published installers; its release run stalled and v0.3.1 was
stamped on the same tree.)

---

## Part 2 — Known bugs and gaps

| Item | Severity | Where |
|---|---|---|
| Paste needs refocus + double Enter | ✅ Fixed — paste must not arm insert gates | v0.2.11 |
| tmux swallows OSC 133 / OSC 52 | ✅ Fixed — `-L tethra` + allow-passthrough | v0.2.11 |
| tmux green status bar | ✅ Fixed (`status off`) | v0.2.11 |
| Roadmap language in UI | ✅ Fixed | v0.2.11 |
| BYOK env stored, never injected | ✅ Injected via 0600 env file at launch | v0.3.0 |
| Settings sections thin (Shell/Keyboard/Agents/Advanced) | ✅ Filled / searchable | v0.3.0 |
| Launcher promises Running, doesn't show it | ✅ Running section first | v0.3.0 |
| Azure OpenAI preset missing | ✅ Catalog + `api-key` auth | v0.3.0 |
| Host color underused; card weight; type hierarchy | ✅ Ambient rail / hairline / hierarchy | v0.3.0 |
| Agent notifications (BEL / tmux hooks) | ✅ Shipped — attached + detached watch | v0.3.2 |
| Click-through agent installs (native / Node first) | ✅ Shipped | v0.3.2 |
| Unsigned installers (Gatekeeper/SmartScreen) | Adoption blocker | v0.4.0 |
| No port forwarding | Table stakes | v0.4.0 |
| SFTP no recursive folder transfer | Table stakes | v0.4.0 |
| No terminal search (⌘F) | Table stakes | v0.4.0 |
| **No SSH agent forwarding** | 🐛 High — see §3.2 | v0.4.0+ |
| Windows is a copy-paste of the Mac build | Platform quality | v0.5.0 |
| Jump hosts metadata-only; no FleetExec/snippets | Deferred | v0.6.0 |
| Mobile stub only | Deferred | Last |

---

## Part 3 — The next big features, specced

### 3.1 Agent notifications — ✅ shipped in v0.3.2

Prototype landed: attached BEL / OSC 9 / OSC 777 / silence / OSC 133 exit;
detached via tmux `monitor-bell` / `monitor-silence` + alert hooks writing
`~/.tethra/alerts` and a 5s poll; desktop notifications, Running chips, dock
badge; Settings → Agents toggles (waiting/failed on, done off).

Remaining polish (later): per-agent overrides, quiet hours, Windows overlay
badge. Spec notes below kept for that work.

Agents run for tens of minutes and then *wait for input*. Today you have to go
look. This is what makes persistence **useful** rather than merely true, and
nothing else does it across a fleet.

**States:** `running` → `waiting` → `done` / `failed`

**Detection — don't rely on OSC 133 alone.** Once an agent takes over the screen,
it owns the TUI and won't emit prompt markers. Layer the signals:

| Signal | Meaning | Reliability |
|---|---|---|
| **BEL (`\a`)** | Agent wants attention | High — Claude Code and others emit this |
| **OSC 9 / OSC 777** | Explicit desktop notification request | High where supported |
| **OSC 133;D + exit code** | Command finished, success or failure | High for shell commands |
| Output silence > N seconds while process alive | Probably waiting | Heuristic, tunable, last resort |

**⚠️ The hard part — detached sessions.** When you detach, Tethra stops reading
the PTY, so it can't see BEL. But notifying about *detached* sessions is the whole
point. Two approaches:

1. **tmux-native.** `monitor-silence` / `monitor-activity` plus `set-hook` on
   `alert-silence` / `alert-bell` running a shell command that pings Tethra. No
   persistent connection, survives Tethra being closed. Preferred.
2. **Monitor connection.** Keep a lightweight reader per running session that
   discards output and watches for signals. Simpler, but costs a connection per
   session and dies when Tethra does.

Prototype (1) first. This is the interesting engineering in the whole roadmap.

**Surfaces:** native notification (`tauri-plugin-notification`), tab badge,
Running-list state chip, dock/taskbar badge count. Click a notification → jump
straight to that session.

**Settings:** per-agent notify on waiting / done / failed; global quiet hours.

### 3.2 SSH agent forwarding — a real gap

Not on any previous roadmap and it should be. If Claude Code is running on a
remote host and needs to `git push`, it needs credentials there. Today the options
are a deploy key on the box or nothing.

Agent forwarding (`ForwardAgent`) makes the local SSH agent available remotely, so
the agent can do git operations without any key living on the server. This is
core-workflow, not a nice-to-have.

Per-host opt-in with a clear warning: a root user on the remote can use your
forwarded agent while you're connected. Default off.

### 3.3 Command history search

You already parse every command into blocks. Make them searchable across all
hosts and all time — "what was that docker command I ran on the VPS in June."
Warp has this locally; you'd have it fleet-wide. Cheap given blocks exist, and
distinctive.

Also ship plain terminal search (⌘F, `@xterm/addon-search`) — currently missing.

### 3.4 Code signing

macOS: Apple Developer $99/yr, Developer ID + notarization via `tauri-action`.
Windows: **Azure Artifact Signing** (renamed from Trusted Signing, 2026) at
$9.99/mo — individual developers in the **US or Canada** are eligible, orgs in
US/CA/EU/UK/AU/NZ/JP/KR/SG/CH/NO/IL. Identity validation takes 1–20 business
days, so start it early. Fallback: Certum OV cert ~$99/yr. Neither skips
SmartScreen reputation warmup except EV.

### 3.5 Windows as a first-class target

[`docs/milestones/M12.5.md`](docs/milestones/M12.5.md) Track C landed the
foundation: a `ChromeStyle` abstraction (`'mac' | 'win' | 'linux'`) resolved once,
`tauri-plugin-decoration`, Segoe UI Variable, caption-button clearance, system
accent, Mica opt-in via Track B. What remains for v0.5.0 is the deeper pass —
Fluent settings page, acrylic tuning, per-platform QA — so Windows feels native
rather than ported.

**⚠️ The trap:** `decorations: false` silently breaks Windows 11 Snap Layouts.
Use `tauri-plugin-decoration` (native `HTMAXBUTTON` overlay) — it also handles the
macOS traffic-light inset, so one crate covers both.

---

## Part 4 — Release plan

| Version | Contents | Why |
|---|---|---|
| **v0.2.11** | Paste/Enter, tmux config, copy sweep | ✅ Shipped |
| **v0.3.0** | Azure OpenAI preset, BYOK injection, Launcher Running, Settings fill/hide, Track D design | ✅ Tagged; installers shipped as v0.3.1 |
| **v0.3.1** | Version re-stamp of v0.3.0; first proven auto-update | ✅ Shipped |
| **v0.4.0** | Agent notifications, SSH agent forwarding, code signing, port forwarding, SFTP recursive, terminal search | Table stakes + wedge notifications |
| **v0.5.0** | Windows native chrome, command history search | Platform quality |
| **v0.6.0** | Live ProxyJump, FleetExec, snippets, cross-device scrollback | Fleet features |
| **Later** | Hosted sync tier, mobile | See Part 5 |

**v0.4.0 carries the wedge** — notifications are what make persistence useful
rather than merely true. v0.3.0 was the polish pass; signing, port forwarding,
SFTP recursive, and ⌘F are what make the app usable by someone who isn't you.

---

## Part 5 — Business model (unchanged from v4)

**Phase 1 — free, BYOK, self-host.** Where you are. No account, no server, no
payment. Public default is bring-your-own-key. Anthony's personal default is Azure
OpenAI on startup credits — **preset in the catalog, key in local settings only,
never committed.**

**Phase 2 — hosted sync subscription.** We store ciphertext blobs and can't read
them. Near-zero hosting cost, no content support burden, self-host stays free
forever. Needs accounts, Stripe, server-side entitlements, one-click export.
Azure credits could host the prototype — that's the one legitimate use for them.

**Phase 3 — managed inference.** Deliberately last. It makes you an LLM reseller
with thin margins, prepaid fraud exposure, and content liability — and it's the
only feature that puts an asterisk on "we can't see anything," since Assist
prompts would flow through your proxy. **Consider an OpenRouter affiliate
arrangement instead:** users get credits, you get a cut, you never touch a prompt
or a payment. Preserve the seam (`Transport::Managed`) either way.

---

## Part 6 — Hard rules

1. No Tauri / wry / tao in `core` (CI checks the dep tree)
2. Plaintext secrets never cross IPC; none in React state or web storage
3. Session state in Rust by ID; layout is frontend; closing a window ≠ killing sessions
4. Host agents, don't become one — Assist stays small
5. Shell out to tmux/zellij; never build a multiplexer
6. Private keys stay device-local; passwords use `sync_secret`
7. Stay on Radix and xterm.js
8. Catalogs are data
9. Tab close = detach; Kill = kill mux
10. The vault key never leaves the device
11. Accounts are additive — everything that works without one keeps working
12. No personal credentials in the repo, ever

---

## Part 7 — Open decisions

- **Apple Developer $99/yr** — gates macOS adoption by anyone but you
- **Windows cert path** — resolved 2026-08-21: Azure Artifact Signing accepts
  individual developers in Canada; start identity validation before v0.4.0
- **Public catalog hosting** — bundled JSON only today; a public URL means
  strangers get new agent presets without waiting for a release
- **Zellij parity** — supported as a fallback; tmux gets all the attention
- **When to announce** — the repo is public but unannounced, zero users. v0.4.0
  with notifications working is the version worth showing people
