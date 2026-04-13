#!/bin/bash
# agentmemory-pretool.sh — PreToolUse hook
# Calls agentmemory REST API to enrich tool context for Read/Write/Edit/Grep/Glob
set -euo pipefail

REST_URL="${AGENTMEMORY_URL:-http://127.0.0.1:3111}"
INPUT=$(cat)

SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

[ -z "$SESSION_ID" ] && exit 0

# Extract files from tool_input
FILES=$(echo "$INPUT" | jq -c '[
  .tool_input.file_path // empty,
  .tool_input.path // empty
] | map(select(. != "" and . != null)) | unique')

# Extract search terms for Grep/Glob
TERMS=$(echo "$INPUT" | jq -c '
  if (.tool_name == "Grep" or .tool_name == "Glob") and .tool_input.pattern then
    [.tool_input.pattern]
  else [] end')

# Only call if we have files
FILE_COUNT=$(echo "$FILES" | jq 'length')
[ "$FILE_COUNT" -eq 0 ] && exit 0

curl -sf --max-time 2 \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
    --arg sid "$SESSION_ID" \
    --argjson files "$FILES" \
    --argjson terms "$TERMS" \
    --arg tool "$TOOL_NAME" \
    '{sessionId: $sid, files: $files, terms: $terms, toolName: $tool}')" \
  "$REST_URL/agentmemory/enrich" >/dev/null 2>&1 || true

exit 0
