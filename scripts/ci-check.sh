#!/usr/bin/env bash
# Mirror of .github/workflows/ci.yml lint-test (minus Docker SSH).
# Run before pushing main or cutting a version tag.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export RUSTFLAGS="${RUSTFLAGS:--Dwarnings}"
export CARGO_TERM_COLOR=always

# Prefer Node 22+ when available (matches CI).
if [[ -z "${CI_CHECK_NODE:-}" ]]; then
  for candidate in \
    "$HOME/.nvm/versions/node/v22.20.0/bin" \
    "$HOME/.nvm/versions/node/v22"*/bin \
    /opt/homebrew/opt/node@22/bin; do
    if [[ -x "${candidate}/node" ]]; then
      export PATH="${candidate}:$PATH"
      break
    fi
  done
fi

echo "==> cargo fmt --check"
cargo fmt --all -- --check

echo "==> cargo clippy"
cargo clippy --workspace --all-targets -- -D warnings

echo "==> export IPC bindings"
cargo test -p tethra export_bindings
git diff --exit-code -- apps/ui/src/lib/generated

echo "==> Tauri imports confined to ipc.ts"
matches="$(grep -RIn --include='*.ts' --include='*.tsx' '@tauri-apps/' apps/ui/src \
  | grep -v 'apps/ui/src/lib/ipc.ts' || true)"
if [[ -n "$matches" ]]; then
  echo "FAIL: Tauri imports must live only in apps/ui/src/lib/ipc.ts"
  echo "$matches"
  exit 1
fi

echo "==> mock IPC has zero Tauri imports"
if grep -n '@tauri-apps/' apps/ui/src/lib/ipc.mock.ts; then
  echo "FAIL: ipc.mock.ts must not import @tauri-apps/*"
  exit 1
fi

echo "==> frontend build (node $(node -v))"
if [[ ! -d apps/ui/node_modules ]]; then
  npm ci --prefix apps/ui
fi
npm run build --prefix apps/ui

echo "==> Tailwind utilities present"
if ! grep -qE '\.(flex|bg-surface)[{,]' apps/ui/dist/assets/*.css; then
  echo "FAIL: built CSS has no Tailwind utilities"
  exit 1
fi

echo "==> cargo test -p tethra"
cargo test -p tethra

echo "==> cargo test -p core --lib --bins"
cargo test -p core --lib --bins

echo "==> cargo test -p core --test ssh_integration"
cargo test -p core --test ssh_integration

echo "==> core must not depend on Tauri"
if cargo tree -p core --edges normal --prefix none | grep -qE '^(tauri|wry|tao)($| )'; then
  echo "FAIL: core depends on the Tauri stack"
  cargo tree -p core --edges normal | grep -E 'tauri|wry|tao' || true
  exit 1
fi

echo "OK: local CI checks passed"
