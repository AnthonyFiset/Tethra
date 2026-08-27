#!/usr/bin/env bash
# Persistent-terminal QA: real sshd + real tmux in Docker.
# Run before shipping ANY terminal / tmux / shell-integration change.
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE="crates/core/tests/docker-compose.yml"

cleanup() { docker compose -f "$COMPOSE" down -v >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "==> starting sshd containers (openssh + openssh-tmux)"
docker compose -f "$COMPOSE" up -d --build

echo "==> terminal QA (real tmux: marks, invisibility, persistence, migration, latency)"
cargo test -p core --test terminal_qa -- --ignored --test-threads=1 --nocapture

echo "==> ssh integration (exec, pty, sftp, host keys)"
cargo test -p core --test ssh_integration -- --ignored --test-threads=1

echo "==> all real-SSH QA passed"
