# Contributing

Thanks for considering a contribution.

## Highest-value first PRs

Agent and Assist provider churn should not require a tagged app release.
Edit the bundled catalogs:

- [`crates/core/data/agents.json`](crates/core/data/agents.json) — agent presets,
  install hints, deprecation / successor links
- [`crates/core/data/assist_providers.json`](crates/core/data/assist_providers.json)
  — provider presets (base URL, transport, model discovery)

Keep entries data-only. Verify install commands against upstream docs before
opening the PR.

## Development

```bash
# Toolchain: Node 22+ (see .nvmrc), Rust stable
scripts/ci-check.sh          # full local gate
cd apps/tauri/src-tauri && npx --prefix ../../ui tauri dev
```

Hard rules (see [`PROJECT.md`](PROJECT.md)):

- `crates/core` must not depend on Tauri
- Secrets never cross IPC / never land in React state
- UI Tauri invokes only via [`apps/ui/src/lib/ipc.ts`](apps/ui/src/lib/ipc.ts)

## License

By contributing, you agree that your contributions are licensed under the
Apache License 2.0 (see [`LICENSE`](LICENSE)).
