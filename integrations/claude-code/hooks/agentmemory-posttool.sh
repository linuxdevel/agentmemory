#!/bin/bash
# agentmemory-posttool.sh — PostToolUse hook
# Calls agentmemory REST API to observe tool outcomes
set -euo pipefail

REST_URL="${AGENTMEMORY_URL:-http://127.0.0.1:3111}"
INPUT=$(cat)

SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

[ -z "$SESSION_ID" ] && exit 0

# Build observation payload — truncate output to 8KB
PAYLOAD=$(echo "$INPUT" | jq -c --arg ts "$TIMESTAMP" --arg cwd "$CWD" '
{
  hookType: "post_tool_use",
  sessionId: .session_id,
  project: $cwd,
  cwd: $cwd,
  timestamp: $ts,
  data: {
    tool_name: .tool_name,
    tool_input: .tool_input,
    tool_output: ((.tool_output // "") | tostring | .[:8000])
  }
}')

curl -sf --max-time 3 \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  "$REST_URL/agentmemory/observe" >/dev/null 2>&1 || true

exit 0
