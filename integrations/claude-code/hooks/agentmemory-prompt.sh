#!/bin/bash
# agentmemory-prompt.sh — UserPromptSubmit hook
# Calls agentmemory REST API for session start + context enrichment
set -euo pipefail

REST_URL="${AGENTMEMORY_URL:-http://127.0.0.1:3111}"
INPUT=$(cat)

SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
PROMPT=$(echo "$INPUT" | jq -r '.prompt // empty')

[ -z "$SESSION_ID" ] && exit 0

STATE_DIR="/tmp/agentmemory-claude"
mkdir -p "$STATE_DIR"
STATE_FILE="$STATE_DIR/$SESSION_ID"

# Session start (once per session)
if [ ! -f "$STATE_FILE" ]; then
  curl -sf --max-time 5 \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg sid "$SESSION_ID" --arg cwd "$CWD" \
      '{sessionId: $sid, project: $cwd, cwd: $cwd}')" \
    "$REST_URL/agentmemory/session/start" >/dev/null 2>&1 || true
  touch "$STATE_FILE"
fi

[ -z "$PROMPT" ] && exit 0

# Context retrieval
CONTEXT=$(curl -sf --max-time 5 \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg sid "$SESSION_ID" --arg cwd "$CWD" --arg p "$PROMPT" \
    '{sessionId: $sid, project: $cwd, budget: 1500, prompt: $p}')" \
  "$REST_URL/agentmemory/context" 2>/dev/null | jq -r '.context // empty') || true

if [ -n "$CONTEXT" ]; then
  jq -n --arg ctx "$CONTEXT" '{systemMessage: $ctx}'
fi

exit 0
