#!/bin/sh
set -eu
DATA_DIR="${TETHRA_SYNC_DATA:-/data}"
mkdir -p "$DATA_DIR"
# Anonymous/Azure mounts often arrive as root-owned; make them writable for uid 10001.
chown -R tethra:tethra "$DATA_DIR" 2>/dev/null || true
exec runuser -u tethra -- tethra-sync-server serve "$@"
