# Tethra roadmap — v2

_Supersedes the old M7/M8 rows in [`PROJECT.md`](PROJECT.md) §12. Written after M6.1.
Canonical milestone summary also lives in `PROJECT.md` §12 and [`STATUS.md`](STATUS.md)._

## The reframe

Tethra was scoped as "Termius, but the sync server can't read your credentials."
That part is done and works. The next phase is a different product thesis:

> **Tethra is where your coding agents run — on your laptop and on every machine
> you own.**

Not an agent. A *host* for agents. Claude Code, Codex CLI, Gemini CLI, aider, and
whatever ships next are all just well-behaved TTY programs. The job is to be an
excellent terminal for them, in a place that already knows all your machines.

**Why this is defensible:** Warp is a great agent terminal that is effectively
local-only. Termius manages a fleet but has no agent story and a mediocre terminal.
The vault, the fleet, and the sync are already built — that's the expensive half,
and it's the half neither competitor can bolt on quickly.

**The wedge feature is session persistence, not AI.** Agents run for tens of
minutes. SSH sessions die on sleep, network change, and lid close. Wrap remote
sessions in a multiplexer transparently and an agent survives all three — and
because the vault syncs, it can be reattached from a *different device*. That is
the demo that sells the product, and it contains no model calls.

---

## Revised milestones

| # | Name | Why now |
|---|---|---|
| **M6.2** | Sync you don't think about | Your stated friction; also clears debt |
| **M7** | Real terminal | Agent CLIs are demanding TTY clients; everything downstream needs this |
| **M8** | Projects and agents | The actual product thesis |
| **M9** | Assist | Natural language to command, gated |
| **M10** | Fleet power features | Was M7; demoted — parity, not differentiation |
| **M11** | Mobile | Reframed, and much stronger for it |

---

## M6.2 — Sync you don't think about

### The friction is probably not what you think

Known limitations say *password identities never sync — re-enter per device after
joining*. So "you don't have to keep putting in credentials" is true for hosts and
false for passwords. That's the papercut you're feeling.

Fix it as an explicit, per-identity opt-in: a `sync_secret` flag on `Identity`.
Default off. When on, the secret rides the same item encryption as everything else
— the sync server still learns nothing, because it never had the vault key. This
does not change the private-key policy (`PROJECT.md` §7); SSH private keys stay
device-local. Passwords are a lower-value, higher-annoyance secret and deserve a
different default.

### Rest of the track

- **Background sync on an interval** plus on vault unlock, on window focus, and
  after any mutation. Kill the manual "Sync now" as the primary path; keep it as
  a menu item for when you want certainty.
- **Coordinated re-key.** Changing the master password currently strands every
  other device. Publish a re-key envelope: new wrapped key encrypted to the old
  key, so devices that can still read the old header adopt the new one on next
  sync without a reset-and-rejoin.
- **Restore the iOS portability guard.** M6.1 deleted
  `cargo check -p core --target aarch64-apple-ios` because Ubuntu has no `xcrun`.
  Move it to the macOS runner you already have for the `.dmg`, with
  `rustup target add aarch64-apple-ios`. Without it, `core` rots silently and M11
  stops being a port.
- **Auto-mirror timer** on the ThinkPad so updates don't need a manual
  `fetch-updates`.

---

## M7 — Real terminal

Agent CLIs exercise terminal features that a plain SSH client can get away with
skipping. Every item below is something Claude Code or similar will actually hit.

### Conformance checklist

- **Alternate screen buffer** — agent TUIs and `vim`/`htop` depend on it
- **Truecolor** — `COLORTERM=truecolor`, 24-bit SGR
- **Bracketed paste** — agents paste multi-line code constantly; without it,
  every pasted newline executes
- **OSC 52 clipboard** — lets an agent on a *remote* box copy to your *local*
  clipboard. Commonly broken, immediately noticeable, cheap to support
- **OSC 7 working directory** — the shell reports its cwd, so "new tab here" and
  "open this project" know where "here" is
- **Mouse reporting** (SGR 1006) and correct `SIGWINCH` on resize
- **Unicode width and emoji** — agents emit box drawing and emoji; wrong widths
  corrupt the whole frame

**Acceptance test:** run Claude Code locally and over SSH. If it renders and
behaves identically to Terminal.app and Ghostty, the track is done. This is a
better spec than any checklist I can write.

### Blocks — OSC 133

Parse the stream into command blocks (prompt, command, output, exit code) using
the FinalTerm/OSC 133 semantic prompt sequences that iTerm2, VS Code, WezTerm,
Ghostty and Warp all speak.

The parser is pure byte handling — no platform APIs — so it lives in `core`,
alongside the output pump, and works identically for local and SSH. Emit
structured block events *beside* the raw byte stream; never in place of it.

**Shell integration delivery** is the hard part and needs a deliberate choice:

| Approach | Trade-off |
|---|---|
| Inject on connect (source an inline script before handing over) | Zero install, no dotfile changes, fragile across exotic shells |
| Install once per host (`~/.tethra/integration.sh` + rc line) | Robust and persistent, but modifies user dotfiles — some people will hate it |
| Wrapper command (`sh -c 'source …; exec $SHELL'`) | Clean, no dotfiles, slightly odd process tree |

Recommendation: **wrapper command by default, per-host override, and degrade
silently to a plain stream when integration is absent.** Store the per-host state
on `Host` so a machine that refused once isn't asked every connect. Blocks are an
enhancement — the terminal must be fully usable without them.

### Splits and windows

You asked for multi-window. This touches hard rule 5 ("tabs and panes are frontend
state, not OS windows"), so revise the rule rather than break it:

> **Revised:** Session state lives in Rust, keyed by session ID. Tab and pane
> *layout* is frontend state. OS windows are a desktop-only presentation layer
> over the same session registry.

Sessions already live in the Tauri layer keyed by ID, so this mostly works today.
It means panes can be dragged between windows, a window can close without killing
its sessions, and mobile simply never opens a second window — portability intact.

Add a layout tree (`split(h|v)`, resize, zoom pane) in the frontend. Keep the
existing single-column collapse under 768px.

---

## M8 — Projects and agents

### New first-class model object

```rust
struct Project {
    id: Uuid,
    name: String,
    location: ProjectLocation,        // Local { path } | Remote { host_id, path }
    default_agent: Option<AgentId>,
    last_opened: Option<DateTime<Utc>>,
}

struct AgentSpec {
    id: AgentId,
    name: String,                     // "Claude Code", "Codex", "aider"
    command: String,                  // launch command
    args: Vec<String>,
    env: Vec<(String, String)>,
    persistent: bool,                 // wrap in multiplexer (see below)
}
```

`Project` syncs through the vault exactly like `Host` does. Which means: define a
project once on your MacBook, and your Windows desktop can open the same project
on the same ThinkPad with one click.

**Open a project** = resolve location → connect (or reuse) session → `cd` → launch
the agent. One action, from the command palette, from anywhere.

Ship with built-in `AgentSpec` presets for the common CLIs and let users add their
own. Presets are just data; no special-casing in code.

### Persistent sessions — the wedge

For any agent with `persistent: true` on a remote host, run it inside a
multiplexer instead of a bare shell:

```
tmux new-session -A -s tethra-<project-id> -c <path> -- <agent command>
```

`new-session -A` attaches if it exists and creates if it doesn't, which makes
reattach and first-launch the same code path. Detect `tmux` → `zellij` → fall back
to a plain shell with a clear "this session won't survive disconnect" indicator.

What this buys, in order of how much it matters:

1. Lid close, network change, and VPN flap stop killing agent runs
2. **Reattach from a different device** — start on the MacBook, resume on Windows
3. A "running sessions" view: which agents are alive, on which hosts, how long

Item 2 is only possible because the vault already syncs. It's the demo.

**Do not build your own multiplexer.** Shelling out to `tmux` is unglamorous and
correct.

---

## M9 — Assist

Deliberately small. `Cmd/Ctrl+I` opens an inline prompt; Tethra sends the current
host's OS, working directory, and the last few blocks as context; the model returns
a command that lands **in the input, not in the shell**.

- Never auto-execute. Route through the existing `ApprovalGate` (`PROJECT.md` §9).
- Provider is pluggable from day one — Anthropic, OpenAI, and an OpenAI-compatible
  base URL covers local models on the ThinkPad via Ollama or vLLM. It's one trait
  with three impls; don't hard-code a vendor.
- **API keys are vault items**, encrypted like everything else, and they must
  respect the same `sync_secret` opt-in from M6.2.
- "Explain this failure" is the same call with block context attached — nearly
  free once blocks exist.

Anything beyond this is competing with the agents you're hosting. Don't.

---

## M10 — Fleet power features

Port forwarding, live `ProxyJump` routing, snippets, multi-host broadcast.

Demoted from M7 because these are Termius parity, not differentiation — with one
exception. Build **broadcast** as a `FleetExec` API that takes a host set and
returns structured per-host results, with the UI on top. Structured fan-out is a
genuinely useful primitive and it ages well; a broadcast text box does not.

---

## M11 — Mobile

The original framing — "SSH from your phone" — is a chore nobody wants. Typing
into a terminal on a touchscreen is miserable and always will be.

The M8 framing is much stronger: **check on agents that are already running.**
Reattach to a persistent session, read output, approve or stop it, send a short
reply. Almost no typing, genuinely useful, and it's the natural mobile shape of
everything M6.2 through M8 builds.

Core should still need zero changes. M6.2 restores the guard that keeps that true.

---

## Open question

The repo is still private at `v0.2.1`, and `PROJECT.md` describes Tethra as open
source. That decision gates real work — code signing and notarization, README and
LICENSE, onboarding for people who don't already know how it works, and the
support surface that comes with strangers filing issues.

None of it is required if this is three machines and you. All of it is required
before anyone else can install it without a Gatekeeper override. Worth deciding
before M8, because "open a project and launch an agent" is the feature that would
make other people want it.
