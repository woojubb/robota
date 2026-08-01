#!/usr/bin/env bash
# PreToolUse hook: block try/catch-fallback in NEW content being written.
# Covers common-mistakes #9 (try/catch fallback) as a pre-write floor before
# scan-no-fallback.mjs catches it in CI.
#
# The former any-type and console-usage branches were removed (HARNESS-DIET-006):
# both are already ESLint `error`s (@typescript-eslint/no-explicit-any, no-console)
# enforced at lint-staged/CI, and the regexes were false-positive-prone.
#
# Reads tool_input.content (Write) or tool_input.new_string (Edit) from stdin —
# NOT the existing file — so only newly introduced violations are caught.
#
# Escape mechanism (per-line):
#   } catch (e) {             // allow-fallback: <reason>
#
# Exit codes: 0 = pass, 2 = hard block

set -uo pipefail

INPUT=$(cat)

# hook-facts.sh sources command-scan.sh, so one line brings in both the payload parser and the
# single owner of the payload's file_path. See lib/hook-facts.sh.
# shellcheck source=lib/hook-facts.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/hook-facts.sh"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
LOG_FILE="$PROJECT_DIR/.agents/evals/local-metrics/blocks.jsonl"

# An EMPTY payload is not "a tool that carries no file path" — it is no payload at all, and the two
# were indistinguishable below: the field read returns empty for both, so a broken host meant every
# edit went through unchecked. A judging hook must tell "I verified this is OK" from "I could not
# verify", and this was the one input where it could not.
if [ -z "${INPUT//[[:space:]]/}" ]; then
  echo "[check-forbidden-patterns] Blocked: the hook payload was empty, so the edit cannot be" >&2
  echo "[check-forbidden-patterns] checked. Nothing was verified; this is not a pass." >&2
  exit 2
fi

# ── scope filter ──────────────────────────────────────────────────────────────
# The first field read is the first place a missing decoder could pass silently — and it did:
# without jq this came back empty and the hook exited 0 before reaching any check. An absent path
# is normal (many tools carry none) and still exits 0; only an UNREADABLE payload refuses.
if ! FILE_PATH=$(hook_file_path_of "$INPUT"); then
  echo "[check-forbidden-patterns] Blocked: the hook payload could not be decoded, so the edit" >&2
  echo "[check-forbidden-patterns] cannot be checked. Install jq or python3." >&2
  exit 2
fi

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# --- A verification hook cannot be gutted through the Edit tool (INFRA-083) ---------------------
#
# The Bash guard in branch-guard.sh covers COMMANDS. It cannot cover this: Write/Edit/MultiEdit
# change file content without running a command at all, so `.husky/pre-commit` could simply be
# replaced with an empty body. Claiming "zero exceptions" for hook destruction while that door stood
# open would be a claim rather than a gate — and the Bash side deliberately allows editors precisely
# because forbidding them there produces false positives and does not close this. (#1588 review)
#
# What is refused is EMPTYING, not editing. A hook that gains content is ordinary maintenance — this
# very session added a cross-worktree lock to `.husky/pre-commit` — so the test asserts that passes.
case "$FILE_PATH" in
  */.husky/*|.husky/*)
    # `hook_edit_content_of` is this file's OWN reader, used unchanged. It already handles all three
    # shapes — Write's `content`, Edit's `new_string`, MultiEdit's `edits[].new_string` — and the
    # comment below it records that MultiEdit once bypassed this guard entirely by carrying its
    # replacements in an array. A second extraction here would be a third reading of one fact, which
    # is the defect this session spent seven review rounds on elsewhere.
    if ! HUSKY_NEW=$(hook_edit_content_of "$INPUT"); then
      echo "[check-forbidden-patterns] Blocked: the edit content could not be decoded, so a hook" >&2
      echo "[check-forbidden-patterns] change cannot be judged." >&2
      exit 2
    fi
    # A body with no runnable line left — empty, or nothing but a shebang and blanks — is a removal
    # wearing an edit's clothes.
    HUSKY_BODY=$(printf '%s' "$HUSKY_NEW" | sed -E '/^[[:space:]]*#!/d; /^[[:space:]]*$/d')
    if [ -z "$HUSKY_BODY" ]; then
      echo "[check-forbidden-patterns] Blocked: this would leave a git hook with nothing to run." >&2
      echo "[check-forbidden-patterns] Emptying a hook disables the gate rather than satisfying it." >&2
      echo "[check-forbidden-patterns] If a check is wrong, unrunnable, or fires on correct work," >&2
      echo "[check-forbidden-patterns] change the CHECK. (git-branch.md, INFRA-083)" >&2
      exit 2
    fi
    exit 0
    ;;
esac

# Only check production TypeScript under packages/*/src.
#
# Matched on the path's SHAPE, not on a `"$CLAUDE_PROJECT_DIR"` prefix. A worktree lives at
# `<project>/.claude/worktrees/<agent>/packages/…`, which never carries the `<project>/packages/…`
# prefix the old patterns required — so for a worktree-parallel agent, which is how work is normally
# done here, this guard was off for every write it exists to check. Measured 2026-07-28: identical
# offending content blocked in the main checkout, waved through in a worktree. A relative
# `file_path`, and an unset CLAUDE_PROJECT_DIR (making the prefix a bare `.`), were blind the same way.
case "$FILE_PATH" in
  */packages/*/src/*.ts|packages/*/src/*.ts|\
  */packages/*/src/*.tsx|packages/*/src/*.tsx) ;;
  *) exit 0 ;;
esac

# Skip test files
case "$FILE_PATH" in
  */__tests__/*|*.test.ts|*.test.tsx|*.spec.ts|*.spec.tsx) exit 0 ;;
esac

# ── extract NEW content from stdin (not disk) ─────────────────────────────────
# Write → tool_input.content | Edit → tool_input.new_string | MultiEdit → tool_input.edits[].new_string
#
# MultiEdit was measured bypassing this guard entirely on 2026-07-28: it carries its replacements in
# an `edits` array, so neither field above existed, CONTENT came back empty and the hook exited 0 on
# content it would have refused from Edit. It was also absent from the hook's matcher in
# settings.json, so the same content was unguarded twice over — once by registration, once by shape.
#
# NotebookEdit is deliberately NOT handled: it carries `notebook_path`/`new_source` and never a
# TypeScript `file_path`, so the packages/*/src scope filter above can never match it.
if ! CONTENT=$(hook_edit_content_of "$INPUT"); then
  echo "[check-forbidden-patterns] Blocked: the edit content could not be decoded, so it cannot be" >&2
  echo "[check-forbidden-patterns] checked. Install jq or python3." >&2
  exit 2
fi

if [ -z "$CONTENT" ]; then
  exit 0
fi

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
RELATIVE_PATH="${FILE_PATH#$PROJECT_DIR/}"
# The scope filter above was widened to accept any prefix so worktree paths would be checked; this
# strip was not, so a path under `.claude/worktrees/<agent>/` does not begin with $PROJECT_DIR and
# survived whole — the log and the refusal then printed an absolute path, in exactly the scenario
# the widening was for. Fall back to cutting at the workspace segment the filter matched on.
if [[ "$RELATIVE_PATH" == /* ]]; then
  case "$FILE_PATH" in
    */packages/*) RELATIVE_PATH="packages/${FILE_PATH#*/packages/}" ;;
    */apps/*) RELATIVE_PATH="apps/${FILE_PATH#*/apps/}" ;;
  esac
fi
# A session id and a transcript path are TEXT, or they are absent — there is no third answer, and
# `hook_json_string` is the single owner of that rule: a field that is not a JSON string reads as "",
# on a host with jq and on a host without, byte for byte (INFRA-081, #1574). This used to call
# `hook_json_text`, which existed only because the rule was true in one file and not in the other;
# once it was true in both, that name was an alias and is gone. See lib/command-scan.sh.
SESSION_ID=$(hook_json_string "$INPUT" 'session_id' || true)
BLOCKED=false
BLOCK_MESSAGES=""

append_block() {
  local pattern="$1"
  local line_num="$2"
  local line_content="$3"
  mkdir -p "$(dirname "$LOG_FILE")"
  # The fourth `jq -cn` writer in this directory, and the one where losing the record is worst: this
  # hook REFUSES the edit either way, so on a host without jq the refusal happened and the evidence
  # for it did not. A block nobody can count is a block nobody can review. Same ladder as every other
  # reader and writer here — jq, then python3, then refuse. See lib/hook-facts.sh.
  hook_json_object \
    s timestamp "$TIMESTAMP" \
    s session_id "$SESSION_ID" \
    s pattern "$pattern" \
    s file "$RELATIVE_PATH" \
    n line "$line_num" \
    b escape_attempted false >> "$LOG_FILE"
  BLOCK_MESSAGES="$BLOCK_MESSAGES\n  line $line_num: $line_content"
  BLOCKED=true
}

# ── #9: try/catch fallback ────────────────────────────────────────────────────
# Flag catch blocks where the body has no rethrow/reject/error propagation
while IFS= read -r match; do
  [ -z "$match" ] && continue
  line_num=$(echo "$match" | cut -d: -f1)
  line_content=$(echo "$match" | cut -d: -f2-)
  echo "$line_content" | grep -q '//[[:space:]]*allow-fallback:' && continue
  # Read ahead 6 lines from CONTENT (not disk)
  block=$(echo "$CONTENT" | sed -n "$((line_num)),$((line_num + 6))p")
  if ! echo "$block" | grep -qE '\bthrow\b|\bPromise\.reject\b|return.*[Ee]rr'; then
    append_block "try-catch-fallback" "$line_num" "$line_content"
  fi
# NOTE: the brace must be escaped (\{) — GNU grep -E rejects a bare `{` inside a group
# ("unmatched ( or \("), which made this branch silently dead before HARNESS-DIET-006.
done < <(echo "$CONTENT" | grep -nE '^\s*}\s*catch\s*(\(|\{)' 2>/dev/null || true)

# ── report ────────────────────────────────────────────────────────────────────
if [ "$BLOCKED" = true ]; then
  echo "" >&2
  echo "❌ [check-forbidden-patterns] Blocked — forbidden pattern(s) in $RELATIVE_PATH:" >&2
  echo -e "$BLOCK_MESSAGES" >&2
  echo "" >&2
  echo "Rules:" >&2
  echo "  try-catch-fallback → common-mistakes #9: no fallback; terminal failures stay terminal" >&2
  echo "" >&2
  echo "Escape (same line): // allow-fallback: <reason>" >&2
  echo "" >&2
  exit 2
fi

exit 0
