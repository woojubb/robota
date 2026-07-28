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

# The tool being invoked.
#
# Kept separate from `hook_command_of` on purpose. `tool_name` is a bare identifier — `Bash`,
# `Edit` — and can never contain a quote, so the grep read that is wrong for a command is exactly
# right for this field. That matters: routing `TOOL_NAME` through the JSON decoders would make a
# machine without jq AND without python3 produce an empty tool name, and every hook would then take
# its "not a Bash call" branch and exit 0 in silence. Three guards disabled, nothing said — the
# fail-open this file exists to eliminate, reintroduced by the fix for it. Review caught it.
hook_tool_name_of() {
  local name rest
  name=$(hook_json_string "$1" 'tool_name') && [[ -n "$name" ]] && { printf '%s' "$name"; return 0; }

  # Pure parameter expansion — no grep, no sed, no subprocess. The point of this fallback is a
  # machine missing jq AND python3, and a fallback that needs its own tools would fail there too,
  # which is how the first attempt turned a silent bypass into exit 127.
  rest="${1#*\"tool_name\"}"
  [[ "$rest" == "$1" ]] && return 1
  rest="${rest#*\"}"
  printf '%s' "${rest%%\"*}"
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
      # Only `<<-` lets the terminator be indented. Stripping indentation unconditionally means an
      # indented body line that happens to equal the terminator ends the body early, and the rest of
      # the body is then scanned as if it were commands.
      if (dashed) { sub(/^[ \t]+/, "", line) }
      if (line == term) { inbody = 0 }
      next
    }
    {
      # A herestring is not a heredoc. `<<< "x"` has no body and no terminator, but the pattern
      # below matches from the SECOND `<`, so everything after it was swallowed as body and never
      # came back — every later command in that call went unexamined. Neutralising `<<<` first is
      # length-preserving, so offsets into $0 stay valid.
      probe = $0
      gsub(/<<</, "\002\002\002", probe)
      if (match(probe, /<<-?[ \t]*[\047"]?[A-Za-z_][A-Za-z0-9_]*[\047"]?/)) {
        term = substr(probe, RSTART, RLENGTH)
        dashed = (substr(term, 3, 1) == "-")
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

# Quoted contents are masked one character for one — EXCEPT the string an interpreter is told to
# run, which is a command and is left intact.
#
# The exception is per-string, not per-command. Applying it to the whole command the moment any
# interpreter appeared produced both errors at once, and review found both: a `-C` inside
# `bash -c "..."` was masked away so the branch check judged the wrong repository, and an unrelated
# commit message on the same line stayed unmasked so an ordinary commit was read as a push. Deciding
# at the opening quote — by what immediately precedes it — is what makes each string answer for
# itself.
#
# One program serves both readers so they can never disagree about what the command says. MODE=mask
# returns the masked command for verb matching; MODE=gitc locates `git -C` in the mask, where a
# mention cannot match, and reads its value from the ORIGINAL at the same offset, because a path is
# routinely quoted and masking it would leave the guard with no path at all.
HOOK_INTERPRETER_RE='(^|[ \t;&|(\n])(((ba|z|da|k|c)?sh|python[0-9.]*|node|deno|bun|perl|ruby|php|awk|xargs|env)[ \t]+-[[:alnum:]]*[ceE]|eval)[ \t]+$'

HOOK_SCAN_AWK='
  { lines[NR] = $0 }
  END {
    # One string, so a quote opened on one line still masks the next. The sed this replaces worked a
    # line at a time and left multi-line arguments unmasked entirely.
    s = ""
    for (n = 1; n <= NR; n++) { s = s (n > 1 ? "\n" : "") lines[n] }

    mask = ""
    q = ""
    keep = 0
    esc = 0
    for (i = 1; i <= length(s); i++) {
      c = substr(s, i, 1)

      # A backslash-escaped quote neither opens nor closes a string. Without this the tracker went
      # out of phase at the first `\\"` and every offset after it was wrong — and this parser is now
      # the only thing three guards believe. Single quotes are the exception: inside them a
      # backslash is an ordinary character, which is why `q` is checked here.
      if (esc) {
        esc = 0
        mask = mask (q == "" ? c : (keep ? c : "\001"))
        continue
      }
      if (c == "\\" && q != "\047") {
        esc = 1
        mask = mask (q == "" ? c : (keep ? c : "\001"))
        continue
      }

      if (q == "") {
        mask = mask c
        if (c == "\"" || c == "\047") {
          q = c
          keep = (substr(s, 1, i - 1) ~ IRE)
          # A double-quoted string still expands `$(...)` and backticks, so its contents are run no
          # matter what surrounds them. Look ahead to the closing quote and keep such a region.
          if (!keep && c == "\"") {
            rest = substr(s, i + 1)
            endq = index(rest, "\"")
            inner = (endq > 0 ? substr(rest, 1, endq - 1) : rest)
            if (index(inner, "$(") > 0 || index(inner, "`") > 0) { keep = 1 }
          }
        }
      } else if (c == q) {
        mask = mask c
        q = ""
        keep = 0
      } else {
        mask = mask (keep ? c : "\001")
      }
    }

    if (MODE == "mask") { print mask; exit }

    # Locate in the MASK, where a quoted mention cannot match; read the value from the ORIGINAL at
    # the same offset, because the value itself is routinely quoted and masking it would leave the
    # guard with nothing. Every extraction that decides WHAT a guard acts on goes through here — the
    # `git -C` target, and the branch name a delete would remove. Writing each by hand is how the
    # delete checks kept reading quoted text as commands after every other check had stopped.
    if (!match(mask, ERE)) { exit }
    p = RSTART + RLENGTH
    c = substr(s, p, 1)
    if (c == "\"" || c == "\047") {
      p++
      endq = index(substr(s, p), c)
      print (endq > 0 ? substr(s, p, endq - 1) : substr(s, p))
    } else {
      v = substr(s, p)
      sub(/[ \t\n"\047].*$/, "", v)   # a value inside a quoted argument ends at the closing quote
      print v
    }
  }
'

# Print the token that follows a match, located where quotes cannot lie. $2 is an ERE ending where
# the value begins.
hook_match_extract() {
  printf '%s\n' "$1" | awk -v MODE=extract -v IRE="$HOOK_INTERPRETER_RE" -v ERE="$2" "$HOOK_SCAN_AWK"
}

# What a verb-detection matcher should read.
hook_verb_scan() {
  hook_executable_part "$1" | awk -v MODE=mask -v IRE="$HOOK_INTERPRETER_RE" -v ERE="" "$HOOK_SCAN_AWK"
}

# The directory a command will act on, read from a real `git -C` and not from a quoted mention.
hook_git_c_path() {
  hook_match_extract "$1" '(^|[ \t;&|({\n"\047])git[ \t]+((-c)[ \t]+[^ \t]+[ \t]+)*-C[ \t]+'
}

# The branch a remote-delete would remove, in either spelling the guard recognises.
#
# The VERB is judged in the mask, so a delete named inside a commit message is not a delete. The
# VALUE is then read from the original, because an argument is legitimately quoted — a `gh api`
# URL almost always is — and masking it would leave the guard unable to name what it is protecting.
# That split is the whole rule; writing it out by hand at each site is how these two checks stayed
# on unmasked text after every other check had moved off it.
hook_deleted_branch() {
  local verbs name
  verbs=$(hook_verb_scan "$1")

  if printf '%s' "$verbs" | grep -qE 'gh[[:space:]]+api[^|;&]*-X[[:space:]]+DELETE[^|;&]*'; then
    name=$(printf '%s' "$1" | grep -oE '/git/refs/heads/[A-Za-z0-9._/-]+' | head -1 |
      sed 's#.*/git/refs/heads/##')
    [[ -n "$name" ]] && { printf '%s' "$name"; return 0; }
  fi

  # `git push <remote> --delete <branch>` and `git push <remote> :<branch>`.
  name=$(hook_match_extract "$1" '(^|[ \t;&|({\n"\047])git[ \t]+push[ \t]+[^ \t]+[ \t]+(--delete[ \t]+|:)')
  [[ -n "$name" ]] && { printf '%s' "$name"; return 0; }

  # `git push --delete <remote> <branch>` — git accepts the flag before the remote, and the guard
  # never did. Pre-existing rather than new, but a delete this misses is a delete it permits.
  hook_match_extract "$1" '(^|[ \t;&|({\n"\047])git[ \t]+push[ \t]+--delete[ \t]+[^ \t]+[ \t]+'
}
