#!/usr/bin/env bash
# UserPromptSubmit hook: collect likely user correction signals.

set -uo pipefail

# One reader for a payload field and one writer for a record, not one per hook.
# See lib/hook-facts.sh.
# shellcheck source=lib/hook-facts.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/hook-facts.sh"

INPUT=$(cat)
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
LOG_FILE="$PROJECT_DIR/.agents/evals/local-metrics/corrections.jsonl"

# This hook carried its own `read_json()` — jq, and NO python3 fallback — and then WROTE its record
# with `jq -cn` as well. Measured on a host with jq hidden: it recorded nothing, silently, while
# branch-guard beside it kept working. Repairing only the read would have left the metric just as
# empty, so both ends go through the shared ladder.
PROMPT=$(hook_prompt_of "$INPUT" || printf '')
if [ -z "$PROMPT" ]; then
  exit 0
fi

# LESSON-010: only REAL user turns are correction signals. Subagent/eval prompts (session ids
# like "agent_1") and events with no session id are agent-authored text — counting them
# inflated the one genuinely useful metric with false positives.
# A session id and a transcript path are TEXT, or they are absent — there is no third answer, and
# `hook_json_string` is the single owner of that rule: a field that is not a JSON string reads as "",
# on a host with jq and on a host without, byte for byte (INFRA-081, #1574). This used to call
# `hook_json_text`, which existed only because the rule was true in one file and not in the other;
# once it was true in both, that name was an alias and is gone. See lib/command-scan.sh.
SESSION_ID=$(hook_json_string "$INPUT" 'session_id' || printf '')
case "$SESSION_ID" in
  '' | agent*) exit 0 ;;
esac

# Nudge the lesson-to-harness skill ONLY on explicit rule-making intent ("make this a rule",
# "from now on always …", 규칙으로/규칙화). The old trigger fired on bare always/never/항상/반드시/
# 하지마 — common words in ordinary dev prompts — so the nudge was mostly noise (HARNESS-DIET-006).
# Repeated corrections or explicit principles belong in the repo harness (.agents/rules + AGENTS.md
# + enforcement), not chat or memory-only. Printed to stdout so it surfaces as agent context;
# correction logging below continues independently.
LESSON_SIGNAL=$(printf '%s' "$PROMPT" | grep -Eio '규칙으로|규칙화|교훈으로|앞으로는? (항상|반드시|절대)|make (it|this) a rule|from now on,? (always|never)|going forward,? (always|never)' | head -n 1 || true)
if [ -n "$LESSON_SIGNAL" ]; then
  echo "[lesson-to-harness] Preference/principle signal detected (\"$LESSON_SIGNAL\"). If this is a repeated correction or an explicit going-forward principle, invoke the lesson-to-harness skill to institutionalize it in the repo harness (.agents/rules + AGENTS.md + enforcement) — not memory-only."
fi

KEYWORD=$(printf '%s' "$PROMPT" | grep -Eio '아니|틀렸|그거 말고|다시|하지 마|하지마|잘못|no,|no\.|wrong|not that|try again|do not|don'\''t' | head -n 1 || true)
if [ -z "$KEYWORD" ]; then
  exit 0
fi

TRANSCRIPT_PATH=$(hook_json_string "$INPUT" 'transcript_path' || printf '')
TRANSCRIPT_PATH="${TRANSCRIPT_PATH/#\~/$HOME}"
PREVIOUS_ASSISTANT_HASH=""

# The transcript is a JSONL FILE, not the hook payload, and the query below is a jq program rather
# than a field read. Stated limit rather than hidden: without jq this correlation hash stays empty,
# which weakens a field of the record — it no longer silences the record itself, which is what the
# payload read did.
if [ -n "$TRANSCRIPT_PATH" ] && [ -f "$TRANSCRIPT_PATH" ] && command -v jq >/dev/null 2>&1; then
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
hook_json_object \
  s timestamp "$TIMESTAMP" \
  s session_id "$SESSION_ID" \
  s pattern "user-correction" \
  s keyword "$KEYWORD" \
  s previous_assistant_hash "$PREVIOUS_ASSISTANT_HASH" \
  s prompt_excerpt "$PROMPT_EXCERPT" >> "$LOG_FILE"

exit 0
