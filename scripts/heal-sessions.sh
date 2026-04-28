#!/usr/bin/env bash
# heal-sessions.sh — close any agentmemory sessions that have been idle past the threshold.
# Usage: ./scripts/heal-sessions.sh [--dry-run]
set -euo pipefail

REST_URL="${AGENTMEMORY_URL:-http://127.0.0.1:3111}"
SECRET="${AGENTMEMORY_SECRET:-}"
DRY_RUN_FLAG=""
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN_FLAG=', "dryRun": true'
fi

AUTH=()
if [ -n "$SECRET" ]; then
  AUTH=(-H "Authorization: Bearer $SECRET")
fi

curl -fsS -X POST \
  "${AUTH[@]}" \
  -H "Content-Type: application/json" \
  -d "{\"categories\": [\"sessions\"]${DRY_RUN_FLAG}}" \
  "${REST_URL}/agentmemory/heal"
echo