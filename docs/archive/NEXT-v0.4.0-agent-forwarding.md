# NEXT — v0.4.0 step 4 of 4: SSH agent forwarding, then stamp + release

> **v0.4.0 rollout:** 1. ✅ signing · 2. ✅ ⌘F + SFTP recursive ·
> 3. ✅ port forwarding · **4. this brief — the last one.**
>
> **Scope:** agent forwarding, then the v0.4.0 release. No changes to
> `inject.ts` / `registry.ts` input paths. Baseline: `main` at `79bb629`.
>
> **Why (ROADMAP §3.2):** when Claude Code runs on `tethra-vm` and needs to
> `git push`, credentials must exist there. Today: deploy key or nothing.
> Forwarding the local SSH agent fixes it with zero keys stored on the
> server — core workflow for the whole agent-hosting wedge.

---

## 1. SSH agent forwarding (per-host opt-in, default OFF)

- **Host setting:** "Forward SSH agent" toggle on the host form, default
  off, stored on the host record (vault-synced metadata). Warning copy next
  to the toggle, roadmap wording: *"A root user on the remote host can use
  your forwarded agent while you're connected."*
- **Engine:** when enabled, request `auth-agent-req@openssh.com` on the
  session; serve incoming agent channels by proxying to the **local** agent:
  - macOS/Linux: `$SSH_AUTH_SOCK` unix socket
  - Windows: OpenSSH agent named pipe (`\\.\pipe\openssh-ssh-agent`)
- Tethra is a dumb pipe: it never reads, parses, or stores keys or agent
  responses. No agent material in logs, DTOs, or React state.
- **No local agent / socket missing:** the session still connects; the
  Tunnels/status area shows "agent forwarding unavailable — no local SSH
  agent" with a one-line hint (macOS: keys load via `ssh-add`; Windows:
  enable the OpenSSH Authentication Agent service).
- Forwarding state (active / unavailable) visible wherever the session
  shows its status chips, consistent with the tunnels pattern.
- Multiplexed/tmux sessions: forwarding rides the SSH connection as usual;
  no special handling beyond not breaking when the channel is reused.

## 2. Stamp + release v0.4.0

- Stamp `0.4.0` everywhere `0.3.2` is stamped (Cargo, tauri conf,
  package.json — the `73ba369` pattern).
- Changelog for v0.4.0: Windows code signing (installers now signed by
  Biz Inbound Inc.), terminal find (⌘F), SFTP recursive folder transfer,
  port forwarding (local/remote tunnels), SSH agent forwarding.
- Tag `v0.4.0` → release workflow publishes signed installers; confirm
  `releases/latest` points at v0.4.0 after publish (the beta stays
  prerelease).
- Delete nothing: `v0.4.0-beta.1` prerelease remains for history.

## Acceptance

1. On the Mac with a key in the local agent (`ssh-add -l` non-empty):
   enable forwarding on `tethra-vm`, connect, run `ssh-add -l` **on the VM**
   → lists the local key(s). `git ls-remote git@github.com:AnthonyFiset/Tethra.git`
   on the VM succeeds with no key file on the VM.
2. Toggle off → reconnect → `ssh-add -l` on the VM fails ("no agent") as
   before.
3. With `SSH_AUTH_SOCK` unset locally: session connects fine, UI shows the
   unavailable notice, nothing crashes.
4. Release: `v0.4.0` published, Windows installer signed (Digital
   Signatures → Biz Inbound Inc.), `releases/latest` = v0.4.0, auto-update
   from a v0.3.2 install works.
5. `scripts/ci-check.sh` green.

## Do NOT

- Agent forwarding ON by default, or a global default toggle — per-host,
  opt-in only
- ProxyJump interaction work (v0.6.0)
- Touch sync-server, vault crypto, or the signing/minisign setup beyond the
  version stamp
