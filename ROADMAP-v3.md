# Tethra roadmap — v3

_Written at `v0.2.5`. **Canonical** plan going forward. Supersedes the M10/M11
rows in [`ROADMAP-v2.md`](ROADMAP-v2.md). Also update [`PROJECT.md`](PROJECT.md) §12,
[`STATUS.md`](STATUS.md), and [`HANDOFF.md`](HANDOFF.md)._
_Mobile is explicitly deferred to the end at your direction._

---

## Research findings that change the plan

### 1. The agent CLI landscape is consolidating violently

In the first half of 2026 alone:

- **Gemini CLI was shut down** (June 18) — not deprecated. The open-source repo
  stopped serving requests, replaced by the closed-source **Antigravity CLI**
  (`agy`), free tier cut roughly 50x.
- **Cursor** — SpaceX announced a $60B acquisition (June 16), expected to close
  Q3 2026. Cursor CLI runs independently until then.
- **OpenCode** — passed 165k stars, moved to `anomalyco/opencode`, and **lost
  Claude Pro/Max subscription login** after a dispute with Anthropic. A raw API
  key still works.
- **Windsurf** → acquired by OpenAI, became Devin Desktop. **Amazon Q Developer**
  → sunsetting.

> ⚠️ **Verify before shipping presets.** Sources published within weeks of each
> other disagree about whether Gemini CLI is alive. Some comparison articles still
> list it as current. Check each CLI's actual repo/docs at build time rather than
> trusting any single roundup — including this one.

**The architectural consequence is the important part:** if `AgentSpec` presets
are compiled into the binary, each of those events is a release. There are at
least four per half-year. Presets must be **data, not code** (see §A).

### 2. Every provider you want is one abstraction

You asked for OpenRouter "and all those endpoints." You don't need N integrations
— you need one, done well. <cite>OpenRouter exposes the OpenAI Chat Completions API,
so changing the base URL and key is the entire integration</cite>; it fronts 400+
models across 70+ providers with `provider/model` slugs.

The same shape covers local models: LM Studio at `http://127.0.0.1:1234/v1`,
Ollama, vLLM, Together, Groq, DeepSeek, Fireworks. Your M9 work already has an
OpenAI-compatible provider. **The remaining work is presets and UX, not protocol.**

Keep native Anthropic and OpenAI transports (they have non-compatible features
worth having). Everything else is one code path with a different base URL.

### 3. Don't migrate off Radix

You're on Radix. Radix was acquired by WorkOS and development slowed; Base UI
(from MUI, built by several original Radix engineers) hit v1.0 in December 2025
and became shadcn's default for new projects in July 2026.

**This is not a signal to migrate.** shadcn's own changelog is explicit: Radix is
not deprecated, every component ships for both, and their guidance is that if your
app works, keep shipping — they still run Radix in production themselves. A
migration is ~50 component files and an `asChild` → `render` sweep, for a few KB.
Spend that time on the dashboard instead. Reconsider only if you hit a specific
Radix bug (Combobox and multi-select are the known weak spots).

### 4. xterm.js has known failure modes under agent TUIs

A project with your exact use case (Tauri app hosting AI CLIs) evaluated
alternatives and documented xterm.js's problems: **scroll jumping with TUI apps,
Kitty keyboard protocol bugs, IME composition issues.** Their verdict on the
alternatives was worse — the Ghostty-WASM renderer had memory corruption where
`free()` after an emoji crashes every subsequent terminal, which is disqualifying
for a multi-tab app, and maintenance had stalled.

**Stay on xterm.js.** But treat scroll-jump under agent TUIs as a known bug with
your name on it, not a mystery. Track upstream; consider `@xterm/addon-serialize`
for reattach state restore.

---

## §A — The principle: catalogs are data

Two new synced, versioned catalogs. Neither is compiled in.

```rust
struct Catalog<T> {
    schema_version: u32,
    revision: u64,
    updated_at: DateTime<Utc>,
    entries: Vec<T>,
}
```

**Delivery, in priority order:** bundled snapshot (works offline, day one) →
fetched from your sync server alongside the update mirror → user overrides in the
vault, which always win.

You already have `tethra-sync-server` mirroring release assets. Serving
`GET /catalogs/agents` and `GET /catalogs/providers` is a few dozen lines and
means Antigravity replacing Gemini CLI is a JSON edit on the ThinkPad, not a
tagged release, a CI run, and an update prompt on three machines.

If the repo goes public later, the catalog becomes a PR target — the single
highest-value contribution surface a project like this has.

---

## M10 — Launcher and workspace (the UI you asked for)

The Termius-shaped part: a dashboard you land on, and a sidebar that only exists
once you're working.

### M10.1 — Two app modes

```
Launcher  ──open host / project / session──▶  Workspace
   ▲                                              │
   └──────────── Cmd/Ctrl+Escape ─────────────────┘
```

**Launcher** — full-window, no sidebar, generous spacing:

- **Resume** (first, above everything) — running tmux sessions across all hosts,
  with agent name, host, uptime, and last activity. This is your wedge; it goes
  at the top of the app.
- **Projects** — cards with location, default agent, last opened
- **Hosts** — grid or list toggle, `Host.color` as the card accent, tags,
  connection state, quick actions (Terminal / Files / Agent)
- **Quick connect** — one-off `user@host` that doesn't touch the vault

**Workspace** — the current UI. Sidebar appears here only, showing Running,
Hosts, Projects, and the session tree for what's open.

Empty state matters: launcher with zero hosts should offer *Import `~/.ssh/config`*
as the primary action. You already built the importer; it's the best first-run
moment you have.

### M10.2 — Mode transition rules

These are the details that make it feel designed rather than bolted on:

- Closing the **last** tab returns to Launcher. Closing a non-last tab does not.
- Launcher never kills sessions — it's a view change, not a disconnect. Running
  sessions stay visible in the Resume row.
- `Cmd/Ctrl+K` works in both modes and can cross the boundary (invoking a host
  from the Launcher palette enters Workspace).
- Under 768px, Launcher is the default and the sidebar is a drawer. Preserved
  from the existing breakpoint rule.

### M10.3 — Libraries

Add only these:

| Need | Library | Why |
|---|---|---|
| Host/project lists | `@tanstack/react-table` | Headless sort/filter/group; you own the markup. Don't hand-roll |
| Long lists | `@tanstack/react-virtual` | Only if you cross ~200 hosts. Skip until then |
| Mode transitions | `motion` (Framer Motion successor) | Layout animations; respect `prefers-reduced-motion` |

**Do not add** a dashboard template kit (Tremor, TailAdmin, MUI). Tremor is built
for analytics KPI cards and will fight a terminal aesthetic. You have a design
system already.

---

## M11 — Provider and agent catalogs

### M11.1 — Provider catalog

One `ProviderPreset` type, most entries differing only by `base_url`:

```rust
struct ProviderPreset {
    id: String,                    // "openrouter", "groq", "lmstudio"
    display_name: String,
    transport: Transport,          // Anthropic | OpenAI | OpenAiCompatible
    base_url: String,
    models_endpoint: Option<String>,   // GET /models for live discovery
    api_key_url: Option<String>,       // deep link to where you get a key
    key_prefix_hint: Option<String>,   // "sk-or-" — validate on paste
    requires_key: bool,                // false for local servers
    default_model: Option<String>,
    headers: Vec<(String, String)>,    // OpenRouter wants referer/title
}
```

**Ship with:** Anthropic, OpenAI, **OpenRouter**, Google, xAI, DeepSeek, Groq,
Together, Fireworks, Mistral, Cerebras, **Ollama**, **LM Studio**, vLLM, and a
blank *Custom OpenAI-compatible* entry.

**The "paste key and go" UX** you asked for, concretely:

1. Pick provider → paste key → **Test** button fires `GET /models`
2. Green dot on success, red dot with the actual error on failure
3. Model picker **populates from the live response** — no hand-typed model names
   that go stale
4. Keys are vault items, honoring the `sync_secret` opt-in from M6.2
5. Local providers (Ollama, LM Studio) skip the key field entirely and just probe

That `GET /models` round-trip is what makes it feel finished. Nearly every
OpenAI-compatible endpoint supports it.

### M11.2 — Agent catalog

```rust
struct AgentPreset {
    id: String,
    display_name: String,
    command: String,
    args: Vec<String>,
    install: HashMap<Platform, InstallMethod>,   // npm/brew/curl per OS
    detect: DetectSpec,                          // `--version` + regex
    persistent_default: bool,                    // tmux-wrap?
    byok_env: Vec<String>,                       // ANTHROPIC_API_KEY, …
    supports_openai_compat: bool,                // can point at OpenRouter?
    docs_url: String,
    status: PresetStatus,                        // Active | Deprecated { successor }
}
```

**Seed set (verify each at build time):** Claude Code, Codex CLI, Antigravity CLI
(`agy`), Cursor CLI, OpenCode, Aider, Goose, Cline CLI, OpenHands, Amp, Kilo CLI,
Qwen Code, plus **Custom command**.

The `status` field is what earns its keep. When Gemini CLI dies, you mark it
`Deprecated { successor: "antigravity" }` and existing projects show a migration
hint instead of silently failing to launch. Given the observed rate of
consolidation, this will fire more than once a year.

**`byok_env` matters more than it looks.** Most of these CLIs accept an
OpenAI-compatible base URL. That means a single OpenRouter key configured once in
Tethra can be injected into Claude Code, OpenCode, Aider, and Cline as env vars at
launch. Configure the key in one place, use it across every agent, on every host.
Nothing else does this — Warp is local-only and Termius has no agent story.

### M11.3 — Project creation flow

Project → location (local or host + path) → **agent picker from the catalog**,
showing installed vs available with a one-click install → provider/key binding →
persistent toggle. You already have the tools probe and install dialog from M8;
this is the same machinery driven by catalog data instead of hardcoded specs.

---

## M12 — Terminal feel (the Warp part)

Now that the shell is right, make the terminal itself feel modern.

- **Block affordances.** OSC 133 is already parsed (M7). Surface it: hover a block
  to get copy-command / copy-output / rerun / share. Failed blocks get a subtle
  left rule in the error color. This is the single most recognizable Warp trait
  and you already have the data.
- **Fix scroll-jump under agent TUIs.** Known xterm.js issue, hits exactly your
  use case. Pin down whether it's alt-screen related and work around it.
- **Font stack.** Ship a good mono default rather than inheriting the system's —
  JetBrains Mono, Berkeley Mono, or Maple Mono. Ligature toggle. This is
  disproportionate to its cost in perceived quality.
- **Theme sync.** Terminal ANSI palette and app chrome derive from one token set,
  so a theme change moves both. Import iTerm2/Alacritty schemes if cheap.
- **Reattach restore.** `@xterm/addon-serialize` to restore scrollback on
  reattach, so resuming an agent session on another device shows history rather
  than an empty screen. Directly serves the wedge.
- **Session recording** (optional, high demo value) — asciinema-format capture of
  an agent run, replayable and shareable.

---

## M13 — Fleet power features

Unchanged from v2, still demoted: port forwarding, live `ProxyJump`, snippets, and
`FleetExec` as the durable structured-broadcast primitive with UI on top.

Promote this above M12 **only** if `ProxyJump` is currently blocking you from
reaching machines you actually need.

---

## M14 — Mobile

Deferred at your direction until the desktop app is polished. The framing from
v2 still holds and gets stronger with every milestone above: not "SSH from your
phone," but *check on agents already running.* The Resume row from M10.1 is
already the mobile home screen; you just render it smaller.

The one thing to keep alive meanwhile: the `cargo check -p core --target
aarch64-apple-ios` guard restored in M6.2. Without it, `core` rots and M14 stops
being a port. It costs nothing to keep green.

---

## Build order

1. **M10.1–10.2** — Launcher/Workspace split. Biggest perceived change, touches
   no protocol, and every later feature needs somewhere to live.
2. **M11.1** — Provider catalog + test-key UX. Small, self-contained, immediately
   useful to you.
3. **M11.2–11.3** — Agent catalog + project flow. The differentiator.
4. **M12** — Terminal feel. Best done once blocks have a stable home.
5. **M13** — Fleet, unless jump hosts are blocking today.

---

## Two decisions worth making now

**The repo is still private** while the copy says open source. It gates code
signing, and unsigned installers mean Gatekeeper and SmartScreen warnings for
anyone else. It also gates the catalog-as-PR-target benefit in §A. Not urgent for
three machines and you — but M11 is the milestone that makes strangers want it.

**Catalog hosting.** If catalogs ship from your ThinkPad, only your devices get
updates. If they ship from a public URL (GitHub raw, a gist, a tiny static host),
anyone running Tethra gets Antigravity support the day you add the entry. Costs
nothing extra and it's the difference between a personal tool and a product.
