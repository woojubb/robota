# shellcheck shell=bash
#
# One parser for the PreToolUse Bash hooks, because four of them had four.
#
# Every hook here re-implemented the same two jobs by hand: pull the command out of the hook JSON,
# and decide which part of it is a command rather than text. Both were wrong, in different ways, in
# different files:
#
#   * `grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"'` stops at the FIRST double quote inside
#     the command. `git commit -m "x" && git push origin main` was read as `git commit -m ` — the
#     push, the thing the guard exists to see, was not in the string it examined. Copied verbatim
#     into four hooks. Filed as HARNESS-061 and raised twice on review before this.
#   * `SCAN="${COMMAND%%<<*}"` throws away everything from the first heredoc opener onward, so a
#     `git reset --hard` written after a CLOSED heredoc is invisible.
#   * Keeping the heredoc body does the opposite damage: prose in a commit message that describes
#     `git checkout -b` was read as the act of running it, which self-blocked an entire session.
#
# A guard that examines a truncated command is not a weaker guard, it is a guard checking something
# other than what will run — the failure mode `enforcement-architecture.md` names, and the one
# PROC-003 was opened for. So the parse gets a single owner and a test, and hooks ask it for what
# they need.
#
# Contract for callers:
#   - Source this file, then use the functions. All are safe under `set -euo pipefail`.
#   - `hook_command_of` returns non-zero when it cannot decode. Callers MUST treat that as a refusal
#     for the commands they govern, never as an empty command that matches nothing.
#   - Decoded output carries REAL newlines. Match with grep's own line semantics (`^` is a line
#     start); do not match the two-character `\n` sequence, which no longer appears.

# Decode a string field from the hook JSON.
#
# jq first, python3 second, refuse third. Both parse JSON properly, which is the entire point: the
# payload is JSON and every hand-rolled decoder in this directory has been wrong about it.
# `\uXXXX`, `\"`, `\\` and `\n` all come back as the characters they denote.
hook_json_string() {
  local json="$1" path="$2"
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$json" | jq -r ".${path} // \"\"" 2>/dev/null && return 0
  fi
  if command -v python3 >/dev/null 2>&1; then
    printf '%s' "$json" | python3 -c '
import json, sys
try:
    doc = json.load(sys.stdin)
except Exception:
    sys.exit(1)
node = doc
for key in sys.argv[1].split("."):
    if not isinstance(node, dict):
        node = None
        break
    node = node.get(key)
sys.stdout.write(node if isinstance(node, str) else "")
' "$path" 2>/dev/null && return 0
  fi
  return 1
}

# The Bash tool's command. Non-zero return means "could not decode" — refuse, do not proceed.
hook_command_of() {
  hook_json_string "$1" 'tool_input.command'
}

# The directory the tool reports it will run in. Absence is normal, so callers use `|| true`.
hook_cwd_of() {
  hook_json_string "$1" 'cwd'
}

# Remove heredoc BODIES from a command, keeping everything else — including whatever follows the
# terminator, which is the part `%%<<*` discarded.
#
# The body is data the shell feeds to a program; it is never executed, so a guard reading it is
# reading text and calling it a command. Everything outside the body IS a command, including the
# commands after the heredoc closes, so a guard not reading those is blind to them. Both halves
# matter and each was gotten wrong separately.
#
# Known limit, stated rather than hidden: only the first opener on a line is tracked, so
# `cmd <<A <<B` strips A's body and treats B's opener as ordinary text. Multiple heredocs on one
# line do not occur in commands this guards, and a wrong guess here would drop real commands.
hook_strip_heredocs() {
  awk '
    BEGIN { inbody = 0 }
    inbody {
      line = $0
      sub(/^[ \t]+/, "", line)     # <<- allows a tab-indented terminator
      if (line == term) { inbody = 0 }
      next
    }
    {
      if (match($0, /<<-?[ \t]*[\047"]?[A-Za-z_][A-Za-z0-9_]*[\047"]?/)) {
        term = substr($0, RSTART, RLENGTH)
        sub(/^<<-?[ \t]*/, "", term)
        gsub(/[\047"]/, "", term)
        inbody = 1
        $0 = substr($0, 1, RSTART - 1)   # keep the command, drop the opener and its tail
      }
      print
    }
  '
}

# Strip trailing shell comments so a `#` remark naming a verb cannot trip a matcher.
hook_strip_comments() {
  sed 's/[[:space:]]#[^"]*$//'
}

# What a guard should actually examine: the command with heredoc bodies and comments removed.
hook_executable_part() {
  printf '%s\n' "$1" | hook_strip_heredocs | hook_strip_comments
}
