#!/usr/bin/env bash
# Point this clone at the committed hooks in .githooks/ (run once per clone).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
git config core.hooksPath .githooks
chmod +x .githooks/pre-push scripts/ci-check.sh
echo "OK: core.hooksPath=.githooks (pre-push will run scripts/ci-check.sh)"
