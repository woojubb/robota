#!/usr/bin/env bash
# PreToolUse hook: block try/catch-fallback in NEW content being written.
# Covers common-mistakes #9 (try/catch fallback) as a pre-write floor before
#
# fail-direction: permit — its subject is a PATTERN in content being written, not a command whose
# grammar it must cover. Treating unrecognised content as forbidden would refuse every file that does
# not match a known-bad shape, which is all of them. The miss it accepts is a fallback spelled a way
# the patterns do not describe; the refusal it avoids is every correct write in the repository.
# scan-no-fallback.mjs catches it in CI.
#
# The former any-type and console-usage branches were removed (HARNESS-DIET-006):
# both are already ESLint `error`s (@typescript-eslint/no-explicit-any, no-console)
# enforced at lint-staged/CI, and the regexes were false-positive-prone.
#
# Reads tool_input.content (Write) or tool_input.new_string (Edit) from stdin —
# NOT the existing file — so only newly introduced violations are caught.
#
# Escape mechanism: `// allow-fallback: <reason>` anywhere `scan-no-fallback.mjs` (the CI
# authority) reads it — the line above the catch, the catch line, or inside the block up to its
# closing brace. Same-line-only was #1664: prettier moves a comment after `{` to the next line
# unconditionally, so hook and formatter could not both be satisfied.
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

# --- Changing a verification hook is deliberate (INFRA-083) --------------------------------------
#
# The Bash guard covers COMMANDS. Write/Edit/MultiEdit change file content without running one, so
# `.husky/pre-commit` could be replaced outright. Claiming "zero exceptions" for hook destruction
# while that door stood open would be a claim, not a gate.
#
# PATH-based, not content-based, and the first attempt taught why. It asked whether the new content
# was empty, and review measured it wrong in BOTH directions: an ordinary partial deletion
# (`old_string: "# stale note\n"`, `new_string: ""`) was refused although the rest of the hook was
# intact, and `content: "exit 0"` passed while disabling the hook exactly as emptying it would.
# `hook_edit_content_of` returns the changed FRAGMENT, never the resulting file, so no emptiness test
# on it could have been right — and "the body still has a line in it" was never the property that
# matters anyway.
#
# So the property is deliberateness. A hook may be changed; it may not be changed by accident or in
# passing. `HOOK_EDIT_ACK=1` in the environment is the acknowledgement, in the same spirit as the
# other documented overrides — this one is not an escape from a check, it IS the check.
#
# BOTH hook directories, not one (#2405). `.husky/` holds the git-level hooks; `.claude/hooks/` holds
# every PreToolUse gate — merge, push, branch, and this guard itself. git-branch.md promised the
# acknowledgement for "a hook" without qualifying which, while this pattern asked for it only under
# `.husky/`, so the gates that matter most were the ones editable in passing.
case "$FILE_PATH" in
  */.husky/*|.husky/*|*/.claude/hooks/*|.claude/hooks/*)
    if [ "${HOOK_EDIT_ACK:-0}" != "1" ]; then
      echo "[check-forbidden-patterns] Blocked: '$FILE_PATH' is a verification hook." >&2
      echo "[check-forbidden-patterns] Changing one is deliberate work, not a passing edit — a hook" >&2
      echo "[check-forbidden-patterns] that quietly becomes 'exit 0' is the gate gone with nothing said." >&2
      echo "[check-forbidden-patterns] If the change is intended: HOOK_EDIT_ACK=1 (git-branch.md)" >&2
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
  # Read ahead 6 lines from CONTENT (not disk)
  block=$(echo "$CONTENT" | sed -n "$((line_num)),$((line_num + 6))p")
  # The marker may be on the catch line or INSIDE the block, and #1664 is why the same-line demand
  # alone cannot stand: prettier unconditionally moves a comment that follows `{` onto the next
  # line — not a width decision — so the two requirements were individually satisfiable and jointly
  # not, for any file the repository also formats. `scan-no-fallback.mjs`, the CI authority for
  # this rule, accepts every placement the codebase uses — the line ABOVE the catch
  # (leading-comment convention), the catch line, anywhere in the body, and the closing-brace
  # line — so the marker scope here matches: one line back, then forward to the block's real
  # closing brace (a generous cap, since a hook reads a bounded window where CI parses the file).
  # The body ENDS at that brace: a shorter catch must not borrow a marker from whatever unrelated
  # code follows it — a marker the CI authority, which matches braces, still refuses.
  #
  # STATED LIMIT, the same one both readers accept differently: this count is textual, so a
  # `{`/`}` inside a string literal in the body skews the depth and can end the marker scope a
  # line early or late. CI's parser ignores those; telling them apart here needs a parser too.
  # The cost lands fail-closed — a marked fallback over-refused, never an unmarked one excused
  # beyond the closing brace's line.
  marker_start=$((line_num > 1 ? line_num - 1 : 1))
  marker_block=$(echo "$CONTENT" | sed -n "$((marker_start)),$((line_num + 40))p")
  # Braces are counted with string/comment stripping — a `{` inside a quoted literal or a `//`
  # comment (line or block, across lines) is prose, not structure, and counting it kept `depth` from ever closing, so the scope
  # grew past the real block and could absorb an unrelated marker beyond it. Template literals
  # are tracked ACROSS lines: inside one, text is prose until the closing backtick, and a bracket
  # expression strips whole so a brace inside a regex character class is not structure. The
  # residue a parser would still catch — a backtick inside a regex literal, a brace in a regex
  # OUTSIDE a character class, nested template interpolation re-opening code — is bounded by the
  # 40-line cap.
  marker_scope=$(echo "$marker_block" | awk -v lead="$((line_num - marker_start))" '
    NR <= lead { print; next }   # the line above the catch: scope, but not brace arithmetic
    {
      line = $0
      gsub(/\\./, "", line)                # escapes first, so \" does not end a string early
      # A template literal is tracked ACROSS lines: inside one, everything up to the closing
      # backtick is prose; a line that opens one without closing it strips its tail and arms the
      # state. Same-line pairs and quoted strings strip as before.
      if (intpl) {
        if (line ~ /`/) { sub(/^[^`]*`/, "", line); intpl = 0 } else { line = "" }
      }
      if (incmt) {
        if (line ~ /\*\//) { sub(/^.*\*\//, "", line); incmt = 0 } else { line = "" }
      }
      gsub(/`[^`]*`/, "", line)
      gsub(/"[^"]*"/, "", line)
      gsub(/\047[^\047]*\047/, "", line)
      gsub(/\/\*[^*]*([^*]|\*+[^*\/])*\*+\//, "", line)
      sub(/\/\/.*$/, "", line)
      # A bracket expression is stripped whole: a brace inside a regex character class
      # (/[{]/ and kin) is prose to the block structure, and balanced [ ] content in code
      # removes both sides of any brace pair it contains, so the depth is unchanged either way.
      gsub(/\[[^\]]*\]/, "", line)
      if (line ~ /`/) { sub(/`.*$/, "", line); intpl = 1 }
      if (line ~ /\/\*/) { sub(/\/\*.*$/, "", line); incmt = 1 }
      n = gsub(/{/, "{", line); m = gsub(/}/, "}", line)
    }
    NR == lead + 1 { depth = n - m + 1 }   # the leading `}` closes the try, not this block
    NR > lead + 1  { depth += n - m }
    { opened += n; print }
    # Truncate only once the block has OPENED and closed. A `{` on the line after the catch
    # (pre-formatter content is what this hook reads) would otherwise cut the scope at the
    # signature line and refuse a correctly marked body.
    opened > 0 && depth <= 0 { exit }')
  echo "$marker_scope" | grep -q '//[[:space:]]*allow-fallback:' && continue
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
  echo "Escape: // allow-fallback: <reason> — the line above the catch, the catch line, or inside the block" >&2
  echo "" >&2
  exit 2
fi

exit 0
