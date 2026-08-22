# NEXT — v0.4.0 step 3 of 4: port forwarding (local + remote tunnels)

> **v0.4.0 rollout:** 1. ✅ signing · 2. ✅ ⌘F + SFTP recursive ·
> **3. this brief** · 4. SSH agent forwarding → stamp + release v0.4.0.
>
> **Scope:** port forwarding only. Do not start agent forwarding or the
> release stamp. No changes to `inject.ts` / `registry.ts` input paths.
> Baseline: `main` at `4e59e4f`.
>
> **Why:** ROADMAP Part 4 table stakes. The concrete use case: an agent or
> dev server runs on `tethra-vm` (e.g. `npm run dev` on :5173) and Anthony
> opens it in his local browser as `localhost:5173`. Every serious SSH
> client has `-L`/`-R`; we have neither.

---

## 1. Engine (crates/core)

- **Local forward (`-L`):** listen on a local port, pipe each accepted
  connection through the SSH session via `channel_open_direct_tcpip` to
  `target_host:target_port` (target resolved from the remote side, so
  `localhost` means the SSH host itself).
- **Remote forward (`-R`):** request `tcpip_forward` on the session; each
  incoming remote connection pipes to a local `target_host:target_port`.
- Bind address defaults to `127.0.0.1` on whichever side listens — never
  `0.0.0.0` by default. An "allow other devices" toggle per tunnel may bind
  `0.0.0.0`, with warning copy.
- Many concurrent connections per tunnel; per-connection failures don't kill
  the tunnel. Tunnel lifecycle is tied to its SSH session: disconnect stops
  tunnels; a clean stop closes listeners and in-flight channels.
- Clear, typed errors surfaced in plain language: local port already in use;
  remote refused the forward (e.g. `AllowTcpForwarding no`); target
  connection refused.

## 2. Model + persistence

- Tunnel definitions live on the host record (vault-synced like other host
  metadata; contains no secrets): direction, bind port, target host, target
  port, label, `auto_start` flag, `allow_lan` flag.
- `auto_start: true` tunnels start when a session to that host connects
  (and report failures without blocking the connection).

## 3. UI

- A **Tunnels** section on the host (visible in the connected session view
  and host details): list with direction arrow, `local:port → target:port`,
  live state (starting / active / error / stopped), per-tunnel start/stop,
  add/edit/delete.
- Add-tunnel form: direction, ports, target (default `localhost`), label,
  auto-start, allow-LAN (with the warning). Sensible defaults: local
  forward, target `localhost`, same port both sides once the user types one.
- Active-tunnel count surfaces wherever the session already shows status
  (chip or similar — match existing patterns). Copy-address button copies
  `http://localhost:<port>`.

## Acceptance

1. On `tethra-vm`: `python3 -m http.server 8000`. Add local tunnel
   `8000 → localhost:8000`, start it, open `http://localhost:8000` in a
   browser on the Mac: directory listing renders. Stop → connection refused.
2. Remote forward: expose a local port to the VM and `curl` it from the VM
   successfully.
3. Occupied local port → plain-language error, tunnel shows error state,
   session unaffected.
4. `auto_start` tunnel starts on connect and survives multiple concurrent
   requests (browser + curl loop).
5. Disconnect the session: tunnels stop, no orphaned listeners (port is
   free again).
6. `scripts/ci-check.sh` green; DTO bindings updated.

## Do NOT

- SSH agent forwarding (brief 4) or the v0.4.0 stamp
- Dynamic/SOCKS (`-D`) proxying — later, note it in the tunnel UI copy only
  if trivial, otherwise skip entirely
- ProxyJump changes (v0.6.0), sync-server, vault crypto, signing workflow
