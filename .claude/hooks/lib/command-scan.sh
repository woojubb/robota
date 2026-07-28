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
  local cmd
  cmd=$(hook_json_string "$1" 'tool_input.command') || return 1
  # jq's `// ""` turns an absent or null field into a successful empty string, so a payload with no
  # command decoded "fine" and then matched nothing — a silent pass wearing the costume of a clean
  # scan. A Bash call without a command is not something this guard can judge.
  [[ -n "$cmd" ]] || return 1
  printf '%s' "$cmd"
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

# The NEW content an edit would write: Write's `content`, Edit's `new_string`, MultiEdit's
# `edits[].new_string` joined.
#
# Same ladder as every other field here — jq, then python3, then refuse. It was jq alone, so a
# machine without jq produced empty content and the forbidden-pattern check exited 0 on content it
# would otherwise have refused: the silent bypass this file exists to remove, surviving in the one
# hook that guards a different tool. Review caught it.
hook_edit_content_of() {
  local content
  if command -v jq >/dev/null 2>&1; then
    content=$(printf '%s' "$1" | jq -r '
      .tool_input.content
      // .tool_input.new_string
      // ([.tool_input.edits[]?.new_string] | join("\n"))
      // ""' 2>/dev/null) && { printf '%s' "$content"; return 0; }
  fi
  if command -v python3 >/dev/null 2>&1; then
    printf '%s' "$1" | python3 -c '
import json, sys
try:
    doc = json.load(sys.stdin)
except Exception:
    sys.exit(1)
ti = doc.get("tool_input") or {}
for key in ("content", "new_string"):
    if isinstance(ti.get(key), str):
        sys.stdout.write(ti[key])
        break
else:
    edits = ti.get("edits") or []
    parts = [e.get("new_string", "") for e in edits if isinstance(e, dict)]
    sys.stdout.write("\n".join(parts))
' 2>/dev/null && return 0
  fi
  return 1
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
# Commands that RUN a string argument. When one precedes a quoted string, nothing inside it is
# masked, because that text is a command and must be read as one.
#
# The shells are NAMED. `[^ \t;&|(\n/]*sh` matched any token ending in those two letters —
# `git stash push -m "…"` read `stash` as an interpreter and opened the message to verb
# scanning, refusing an ordinary command. An optional path prefix still allows `/bin/bash`. Any number of arguments
# may sit between the interpreter and its string — allowing exactly one meant `bash -x -c "…"`,
# `ssh -o Opt host "…"` and `python3 -u -c "…"` all fell out of the exception and were masked.
#
# `ssh`, `expect` and `tclsh` are on the list because a closed list is a list of the ways past the
# guard. `env`, `timeout`, `nohup`, `nice`, `flock`, `sudo`, `su` and `xargs` are deliberately NOT:
# they exec an argument vector rather than evaluating a string, so listing them would widen
# over-blocking for nothing. `timeout 5 bash -c "…"` stays covered — by the `bash -c` inside it.
#
# The boundary is real, and stated rather than implied: this is still an allowlist, so a quoted
# string run by something outside it is masked and its verbs go unseen. Inverting the default —
# examine every quoted string unless a known message flag precedes it — was considered and
# rejected: in this repository `rg "git push" docs/` and `grep -E "git push"` are ordinary
# commands, and reading their arguments as commands would refuse routine work many times a day.
# That is the self-blocking these hooks have already inflicted once. The trade runs this way
# because of the threat model: the commands guarded here are the agent's own, written plainly.
HOOK_INTERPRETER_RE='(^|[ \t;&|(\n`])(([^ \t;&|(\n]*/)?(sh|bash|zsh|dash|ksh|tcsh|csh|ash|fish|mksh|busybox|python[0-9.]*|node|deno|bun|perl|ruby|php|awk|expect|tclsh|ssh)[ \t]+([^ \t;&|(\n]+[ \t]+)*|eval[ \t]+)$'

HOOK_SCAN_AWK='
  { lines[NR] = $0 }
  END {
    # One string, so a quote opened on one line still masks the next. The sed this replaces worked a
    # line at a time and left multi-line arguments unmasked entirely.
    s = ""
    for (n = 1; n <= NR; n++) { s = s (n > 1 ? "\n" : "") lines[n] }
    len = length(s)

    q = ""
    keep = 0
    esc = 0
    for (i = 1; i <= len; i++) {
      c = substr(s, i, 1)

      # A backslash-escaped quote neither opens nor closes a string. Without this the tracker went
      # out of phase at the first escaped quote and every offset after it was wrong. Inside single
      # quotes a backslash is an ordinary character, which is why q is checked.
      if (esc) { esc = 0; m[i] = (q == "" || keep) ? c : "\001"; continue }
      if (c == "\\" && q != "\047") { esc = 1; m[i] = (q == "" || keep) ? c : "\001"; continue }

      if (q == "") {
        m[i] = c
        if (c == "\"" || c == "\047") {
          q = c
          openq = i
          keep = (substr(s, 1, i - 1) ~ IRE)

          # A quoted SINGLE WORD is a token of the command line, not a data payload. Quoting one
          # changes nothing about what runs, so `git "push" origin main`, `git reset "--hard"` and
          # `gh pr merge 1 --merge "--delete-branch"` must read exactly as their bare forms — and
          # quoting every token is ordinary defensive shell style, not an exotic evasion. Only a
          # quoted string containing whitespace is treated as a payload.
          if (!keep) {
            j = i + 1
            spaced = 0
            while (j <= len) {
              ch = substr(s, j, 1)
              if (ch == "\\" && q != "\047") { j += 2; continue }
              if (ch == q) { break }
              if (ch == " " || ch == "\t" || ch == "\n") { spaced = 1; break }
              j++
            }
            if (!spaced) { keep = 1 }
          }

          # The quote characters themselves become spaces around a KEPT region, so a matcher reads
          # `git "push"` exactly as `git  push `. Without this the region survived masking and still
          # matched nothing, because every verb pattern expects whitespace before the verb. Length is
          # preserved one for one, so the offsets the extractors depend on stay valid.
          if (keep) { m[openq] = " " }
        }
      } else if (c == q) {
        m[i] = keep ? " " : c
        q = ""
        keep = 0
      } else {
        m[i] = keep ? c : "\001"
      }
    }

    # Command substitution runs whatever the quoting around it, so its span is restored from the
    # original — the SPAN, not the whole enclosing string. Keeping the entire string meant a message
    # holding both a substitution and an unrelated mention of a guarded verb was read as that verb.
    for (i = 1; i <= len; i++) {
      if (substr(s, i, 2) == "$(") {
        depth = 0
        for (j = i + 1; j <= len; j++) {
          cj = substr(s, j, 1)
          if (cj == "(") { depth++ } else if (cj == ")") { depth--; if (depth == 0) { break } }
        }
        stop = (j <= len) ? j : len
        for (k = i; k <= stop; k++) { m[k] = substr(s, k, 1) }
        i = stop
      } else if (substr(s, i, 1) == "`") {
        for (j = i + 1; j <= len; j++) { if (substr(s, j, 1) == "`") { break } }
        stop = (j <= len) ? j : len
        for (k = i; k <= stop; k++) { m[k] = substr(s, k, 1) }
        i = stop
      }
    }

    mask = ""
    for (i = 1; i <= len; i++) { mask = mask m[i] }

    if (MODE == "mask") { print mask; exit }

    # Anchor in the mask, then search the ORIGINAL from that offset. Needed when the value sits
    # INSIDE a quoted argument — a `gh api` refs/heads URL nearly always does — where the mask
    # hides it. Reading the original from position zero instead is what let a decoy in a commit
    # message stand in for the real branch being deleted.
    if (MODE == "after") {
      if (!match(mask, ERE)) { exit }
      rest = substr(s, RSTART)
      if (!match(rest, VRE)) { exit }
      v = substr(rest, RSTART + RLENGTH)
      sub(/[ \t\n"\047].*$/, "", v)
      print v
      exit
    }

    # Locate in the MASK, where a quoted mention cannot match; read the value from the ORIGINAL at
    # the same offset, because the value itself is routinely quoted and masking it would leave the
    # guard with nothing.
    if (!match(mask, ERE)) { exit }
    p = RSTART + RLENGTH
    c = substr(s, p, 1)
    if (c == "\"" || c == "\047") {
      p++
      endq = index(substr(s, p), c)
      print (endq > 0 ? substr(s, p, endq - 1) : substr(s, p))
    } else {
      v = substr(s, p)
      sub(/[ \t\n"\047].*$/, "", v)
      print v
    }
  }
'

# Print the token that follows a match, located where quotes cannot lie. $2 is an ERE ending where
# the value begins.
hook_match_extract() {
  printf '%s\n' "$1" | awk -v MODE=extract -v IRE="$HOOK_INTERPRETER_RE" -v ERE="$2" -v VRE="" "$HOOK_SCAN_AWK"
}

# Like hook_match_extract, but the value is found by $3 searched in the ORIGINAL starting at the
# anchor $2's position in the mask. For values that legitimately live inside a quoted argument.
hook_match_extract_after() {
  printf '%s\n' "$1" | awk -v MODE=after -v IRE="$HOOK_INTERPRETER_RE" -v ERE="$2" -v VRE="$3" "$HOOK_SCAN_AWK"
}

# What a verb-detection matcher should read.
hook_verb_scan() {
  hook_executable_part "$1" | awk -v MODE=mask -v IRE="$HOOK_INTERPRETER_RE" -v ERE="" -v VRE="" "$HOOK_SCAN_AWK"
}

# The directory a command will act on, read from a real `git -C` and not from a quoted mention.
hook_git_c_path() {
  hook_match_extract "$1" '(^|[ \t;&|({\n"\047`])git[ \t]+((-c)[ \t]+[^ \t]+[ \t]+)*-C[ \t]+'
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
    # From the `gh api` call's own position, not from the start of the string. Taking the first
    # match anywhere meant `git commit -m "note /git/refs/heads/scratch" && gh api -X DELETE
    # .../heads/develop` reported scratch, so the protected-branch and merged-PR checks never saw
    # the branch actually being deleted.
    name=$(hook_match_extract_after "$1" '(^|[ \t;&|({\n"\047`])gh[ \t]+api([ \t]|$)' '/git/refs/heads/')
    [[ -n "$name" ]] && { printf '%s' "$name"; return 0; }
  fi

  # `git push <remote> --delete <branch>` and `git push <remote> :<branch>`.
  name=$(hook_match_extract "$1" '(^|[ \t;&|({\n"\047`])git[ \t]+push[ \t]+[^ \t]+[ \t]+(--delete[ \t]+|:)')
  [[ -n "$name" ]] && { printf '%s' "$name"; return 0; }

  # `git push --delete <remote> <branch>` — git accepts the flag before the remote, and the guard
  # never did. Pre-existing rather than new, but a delete this misses is a delete it permits.
  hook_match_extract "$1" '(^|[ \t;&|({\n"\047`])git[ \t]+push[ \t]+--delete[ \t]+[^ \t]+[ \t]+'
}
