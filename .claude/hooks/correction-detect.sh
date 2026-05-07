#!/usr/bin/env bash
# UserPromptSubmit hook: collect likely user correction signals.

set -uo pipefail

INPUT=$(cat)
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
LOG_FILE="$PROJECT_DIR/.agents/evals/local-metrics/corrections.jsonl"

read_json() {
  local expression="$1"
  if [ -z "$INPUT" ]; then
    echo ""
    return
  fi
  printf '%s' "$INPUT" | jq -r "$expression // \"\"" 2>/dev/null || echo ""
}

PROMPT=$(read_json '.prompt // .user_prompt // .message')
if [ -z "$PROMPT" ]; then
  exit 0
fi

KEYWORD=$(printf '%s' "$PROMPT" | grep -Eio '아니|틀렸|그거 말고|다시|하지 마|하지마|잘못|no,|no\.|wrong|not that|try again|do not|don'\''t' | head -n 1 || true)
if [ -z "$KEYWORD" ]; then
  exit 0
fi

SESSION_ID=$(read_json '.session_id')
TRANSCRIPT_PATH=$(read_json '.transcript_path')
TRANSCRIPT_PATH="${TRANSCRIPT_PATH/#\~/$HOME}"
PREVIOUS_ASSISTANT_HASH=""

if [ -n "$TRANSCRIPT_PATH" ] && [ -f "$TRANSCRIPT_PATH" ]; then
  PREVIOUS_ASSISTANT_TEXT=$(jq -r '
    select((.type // .role // .message.role // "") == "assistant")
    | (.message.content // .content // .text // "")
    | if type == "string" then .
      elif type == "array" then map(
        if type == "string" then .
        elif type == "object" then (.text // .content // "")
        else "" end
      ) | join(" ")
      else "" end
  ' "$TRANSCRIPT_PATH" 2>/dev/null | tail -n 1)
  if [ -n "$PREVIOUS_ASSISTANT_TEXT" ]; then
    PREVIOUS_ASSISTANT_HASH=$(printf '%s' "$PREVIOUS_ASSISTANT_TEXT" | shasum -a 256 | awk '{print $1}')
  fi
fi

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
PROMPT_EXCERPT=$(printf '%s' "$PROMPT" | tr '\n' ' ' | cut -c 1-160)

mkdir -p "$(dirname "$LOG_FILE")"
jq -cn \
  --arg timestamp "$TIMESTAMP" \
  --arg session_id "$SESSION_ID" \
  --arg pattern "user-correction" \
  --arg keyword "$KEYWORD" \
  --arg previous_assistant_hash "$PREVIOUS_ASSISTANT_HASH" \
  --arg prompt_excerpt "$PROMPT_EXCERPT" \
  '{
    timestamp: $timestamp,
    session_id: $session_id,
    pattern: $pattern,
    keyword: $keyword,
    previous_assistant_hash: $previous_assistant_hash,
    prompt_excerpt: $prompt_excerpt
  }' >> "$LOG_FILE"

exit 0
