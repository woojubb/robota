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
#
# ONE RULE, NOT ONE PER INSTALLED TOOL (INFRA-081, #1574). The two arms used to answer the same
# question differently, and the difference reached a VERDICT. Measured end-to-end on `branch-guard.sh`
# against a scratch repository, same payload both times, only `PATH` differing:
#
#   {"tool_name":"Bash","cwd":"<scratch>","tool_input":{"command":{"a":"git push origin main"}}}
#     with jq      exit 0   (jq -r printed the pretty-printed OBJECT, whose `git push` sits inside
#                            quotes, so the tokenizer masked it as data and no verb was found)
#     without jq   exit 2   (the python3 arm writes "" for a non-string, and an empty command is a
#                            refusal)
#
# One host permitted and the other refused, and neither answer was reached by a decision. Two more
# divergences were measured in the same arm and are closed here with it: `jq -r ".a.b"` ERRORS when
# `a` is not an object (so a jq-only host returned "could not decode" where a python3 host returned
# ""), and `jq -r` appends a newline the python3 arm does not write.
#
# THE ANSWER IS "" — a field that is not a string is not that field — for three reasons, and the
# alternative (a reader that returns non-zero on a non-string) was rejected for the third:
#
#   1. It is the rule `hook-facts.sh` had already measured and adopted for the text fields #1566
#      could reach, in a second reader it wrote beside this one because it could not reach THIS one.
#      Two spellings of one rule is what INFRA-077 spent a PR removing; that second reader is gone
#      now, and its six callers ask this function directly.
#   2. `hook-facts.sh` states the reader/caller split explicitly: a READER collapses absent and empty
#      into "", and the CALLER names what empty means for it. A refusing reader would break that for
#      one function out of the set.
#   3. The VERDICT is fail-closed either way, and that is the property that matters. Every caller
#      here already converts empty into a refusal or a fallback — `hook_command_of` returns non-zero
#      on an empty command, `hook_tool_name_of` falls through to its no-tools parse — so both arms
#      now exit 2 on the payload above. Measured, both directions.
#
# The path is passed as `--arg`, not interpolated into the filter: a field name is data, and the
# reduce below is total, so no shape of path or payload makes this arm error where the other returns.

# ONE spelling of git's value-taking global options — the single source every hook derives from
# (branch-guard's GITPFX, its alias-substitution gate and verb latch via git_global_takes_value(),
# and hook_git_c_path below). It lives in this LIBRARY because a sourced function cannot rely on a
# definition its sourcing hook makes later — and a second hand-kept copy is the drift this list
# exists to end (#1666 review). SANS_C is DERIVED, for the one reader whose target is -C itself.
GIT_VALUE_GLOBALS_SANS_C='-c|--work-tree|--git-dir|--namespace|--exec-path|--super-prefix|--config-env'
GIT_VALUE_GLOBALS="-C|${GIT_VALUE_GLOBALS_SANS_C}"

hook_json_string() {
  local json="$1" path="$2"
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$json" | jq -j --arg p "$path" '
      reduce ($p | split(".")[]) as $k (.; if type == "object" then .[$k] else null end)
      | if type == "string" then . else "" end
    ' 2>/dev/null && return 0
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
#
# The arms are held to the SAME rule as `hook_json_string` above, and for the same reason
# (INFRA-081): a field that is not a string is not that field. Fixing the divergence one function up
# and leaving it here is how this directory keeps producing "corrected in one place, live in the
# sibling". Four shapes were measured disagreeing before this, each reachable from an ordinary
# payload: a numeric `content` (jq printed the number, python3 skipped to `new_string`), a
# `tool_input` that is not an object (jq ERRORED, python3 raised, both then answered differently
# depending on which tools were present), an `edits` list that is not a list, and an edit whose
# `new_string` is not a string (python3 raised inside `join` and the whole read became "could not
# decode"). Both arms now walk the same three steps and stop at the first STRING.
hook_edit_content_of() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$1" | jq -j '
      (if type == "object" then .tool_input else null end) as $ti
      | if ($ti | type) != "object" then ""
        elif ($ti.content | type) == "string" then $ti.content
        elif ($ti.new_string | type) == "string" then $ti.new_string
        else [ ($ti.edits | if type == "array" then .[] else empty end)
               | if type == "object"
                 then (.new_string | if type == "string" then . else "" end)
                 else empty end ]
             | join("\n")
        end
    ' 2>/dev/null && return 0
  fi
  if command -v python3 >/dev/null 2>&1; then
    printf '%s' "$1" | python3 -c '
import json, sys
try:
    doc = json.load(sys.stdin)
except Exception:
    sys.exit(1)
ti = doc.get("tool_input") if isinstance(doc, dict) else None
if not isinstance(ti, dict):
    ti = {}
out = None
for key in ("content", "new_string"):
    if isinstance(ti.get(key), str):
        out = ti[key]
        break
if out is None:
    edits = ti.get("edits")
    if not isinstance(edits, list):
        edits = []
    parts = []
    for edit in edits:
        if isinstance(edit, dict):
            value = edit.get("new_string")
            parts.append(value if isinstance(value, str) else "")
    out = "\n".join(parts)
sys.stdout.write(out)
' 2>/dev/null && return 0
  fi
  return 1
}

# The directory the tool reports it will run in. Absence is normal, so callers use `|| true`.
hook_cwd_of() {
  hook_json_string "$1" 'cwd'
}

# ONE READING OF A COMMAND, NOT TWO (INFRA-075, #1572).
#
# Three functions stood here: `hook_strip_heredocs`, `hook_strip_comments`, and the
# `hook_executable_part` that piped one into the other. They were the reading this file had BEFORE
# #1565 gave it a tokenizer, and they survived that PR because retiring them is a caller-side change
# and the hooks were owned by other work in flight. So the library offered two answers to "what does
# this command do", three guards held both at once, and each grep site picked whichever variable was
# in scope.
#
# The gap was not academic. Measured against real bash over the 202-shape differential corpus, with a
# recording `git` stub on PATH:
#
#   hook_verb_scan        agreed with bash on 199 of 202
#   hook_executable_part  agreed with bash on 111 of 202  (3 bypasses, 88 refusals of correct work)
#
# and it reached VERDICTS, which is the part #1565 did not measure. `hook_strip_heredocs` looks for
# a heredoc opener with a regex that does not know about quoting, so a `<<EOF` written INSIDE a
# quoted string opened a body that never closed and every command after it was deleted from the
# string the guards then examined. Three hooks, each with a bare control that is refused correctly:
#
#   worktree-cwd-guard  git -C <MAIN> reset --hard                                   -> exit 2
#                       echo "see <<EOF for details" ; git -C <MAIN> reset --hard    -> exit 0
#   pre-push-check      git -C <unreviewed> push                                     -> exit 2
#                       echo "see <<EOF for details" ; git -C <unreviewed> push      -> exit 0
#   branch-guard        git push origin --delete develop                             -> exit 2
#                       echo "see <<EOF" ; git push origin --delete develop          -> exit 0
#   branch-guard        git checkout -b BAD_NAME                                     -> exit 2
#                       echo "see <<EOF" ; git checkout -b BAD_NAME                  -> exit 0
#
# The tokenizer below already answers what those two passes were approximating — a heredoc body and
# a comment both come back as \001 in its mask, and it knows the grammar they were guessing at. So
# every caller reads the RAW command now and `hook_match_*` masks it properly, and the third
# quote-state machine in this file is gone with them.

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
# scanning, refusing an ordinary command. An optional path prefix still allows `/bin/bash`.
#
# Any number of arguments may sit between the interpreter and its CODE FLAG, but none of them may
# itself be quoted: after `python3 -c "x=1"` the NEXT quoted argument is a positional one the
# interpreter does not run, and treating it as code refused ordinary commands. Allowing exactly one
# argument meant `bash -x -c "…"`, `ssh -o Opt host "…"` and `python3 -u -c "…"` all fell out of the
# exception and were masked.
#
# "and its CODE FLAG" is the INFRA-084 correction, and this paragraph said "and its string" until
# review pointed out it still described the pre-fix model — the over-permissive one this change
# exists to remove, sitting a few lines above the regex that no longer implements it.
#
# `ssh` and `awk` are the POSITIONAL members of that list, because a closed list is a list of the
# ways past the guard. `expect` moved to its `-c` and `tclsh` left the list entirely — it has no
# inline-code flag at all, so it is not an interpreter for this purpose (see the regex below for
# what was measured). This sentence named all three as positional until review found it describing
# a list the code no longer builds. `env`, `timeout`, `nohup`, `nice`, `flock`, `sudo`, `su` and `xargs` are deliberately NOT:
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
#
# INFRA-084: a CODE FLAG is required, and that requirement is the whole point. Any number of
# arguments could sit before the quoted string, so `node script.mjs --notes "…"` matched and the
# script's DATA was read as commands — an ordinary argument mentioning `git push` was judged as a
# push. The rule this file already stated ("the interpreter's first quoted argument is the code it
# runs") was true of `node -e "…"` and false of everything else, and nothing said so.
#
# `ssh` and `eval` keep the older shape: their code argument carries no flag — it is positional.
#
# The flag set is PER INTERPRETER, because the interpreters disagree about what a flag means and one
# flat list cannot be right for all of them. The first version was flat — `-[a-zA-Z]*[ec]|--eval|
# --command|--exec|eval|run` — and review measured what that missed. RAN, and each of these hid the
# command inside it from every guard:
#
#   php -r "system('git push --force')"      `-r` is php's inline-code flag; it ends in neither e nor c
#   node -p "…execSync('git push --force')"  `-p`/`--print` evaluates exactly as `-e` does
#   perl -E "system 'git push --force'"      `-E` is perl's `-e` with features on; `[ec]` is lower-case
#
# `node -p` and `perl -E` were confirmed by RUNNING them; `php -r` is documented and php is not
# installed on this host, which the case says rather than pretending otherwise.
#
# The pre-INFRA-084 regex required no flag at all, so it caught all three — this narrowing was a
# regression in the opposite direction from the one it fixed, and the tests added with it had no
# case for any of the three. That is the shape to watch for: a rule narrowed to fix over-blocking
# takes the under-blocking with it unless the narrowing is measured against real invocations.
#
# Why per-interpreter and not one wider list: `-E` is CODE for perl and CHARACTER ENCODING for
# ruby, and `-r` is CODE for php and REQUIRE-A-LIBRARY for ruby. A union list would read a `ruby -E
# utf-8` argument as code and refuse ordinary work — the self-blocking INFRA-084 exists to undo.
HOOK_INTERP_BOUNDARY='(^|[ \t;&|(\n`])'
HOOK_INTERP_PATH='([^ \t;&|(\n]*/)?'
# Any number of non-quoted arguments may sit between the interpreter and its code flag — but NOT a
# script filename, and review measured why.
#
# Every one of these interpreters stops parsing its own options at the first non-option argument;
# everything after that belongs to the script. RAN:
#
#   node <script>.mjs -e 'console.log("EVAL_RAN")'   ->  SCRIPT_RAN: -e console.log("EVAL_RAN")
#
# `-e` was the SCRIPT's flag, not node's, and matching it read an ordinary argument as code — the
# over-blocking INFRA-084 exists to remove, reintroduced by its own fix.
#
# A token containing `.` or `/` is treated as that boundary. It is a heuristic and the trade is
# stated rather than hidden: a value-taking flag whose value looks like a path
# (`node --require ./setup.js -e "…"`) stops the match, so that code is masked as data — an
# under-match, which is the direction this file usually refuses. It is accepted here because the
# alternative measured worse: requiring every preceding token to start with `-` breaks
# `python3 -W ignore -c "…"`, an ordinary invocation, and a guard that refuses ordinary work is the
# failure this whole change is about.
HOOK_INTERP_ARGS='([^ \t;&|(\n"\047./]+[ \t]+)*'
# What may sit between a code flag and the code, and review found the first spelling too narrow.
# It was `[ \t]+` — a REQUIRED space — so a fused invocation never matched and its code was masked
# as data. Both of these RUN, measured:
#
#   python3 -c"import os;os.system('git push --force')"   PY_FUSED_RAN
#   node --eval="git push --force"                        NODE_FUSED_RAN
#
# A short flag may abut its value with nothing between them; a long one takes `=`. So: optional
# space, optional `=`, optional space. Zero-width is safe because each alternative below ends AT the
# flag — `-config` does not end in `c`, and `--evalX` does not end in `--eval`.
HOOK_INTERP_SEP='[ \t]*=?[ \t]*'
# A bundle may only contain that interpreter's BOOLEAN flags, and review measured why `[a-zA-Z]*`
# could not stay. A flag that takes its value FUSED to it ends in whatever letter its value ends in:
#
#   ruby -rdate "some note about git push --force"     BLOCKED, and nothing here is code
#
# `-rdate` is `-r date` — require the `date` library — and `-[a-zA-Z]*e` read it as `-e` because the
# value happens to end in `e`. An ordinary data string was then verb-scanned as a ruby program,
# which is the over-blocking INFRA-084 exists to remove, reappearing inside its own fix. `node
# -rdate` had it too.
#
# So each interpreter names the letters that carry no value. Anything else fused to a `-` is a flag
# WITH a value and cannot be the code flag. Value-taking flags written as separate tokens are
# unaffected — `ruby -rjson -e "…"` still matches, because `HOOK_INTERP_ARGS` consumes `-rjson` and
# the code flag stands alone.
#
# Written as what a bundle may NOT contain, not as what it may. Review found the first version listing
# the boolean flags of each interpreter and measured the gap that leaves: `bash -T` (functrace) and
# `python3 -P` (safe-path) are ordinary boolean flags that were simply missing, so `bash -Tc "git push
# --force"` matched nothing, fell through to the generic quoted-argument branch, and the push was
# masked as data. That is the UNDER-block direction, and it is the worse one — an allowlist of flags
# has to be complete to be safe, and no hand-written list of another program's options stays complete.
#
# Inverted, the incompleteness lands on the safe side: a letter nobody listed is treated as a boolean
# flag, the bundle matches, and the argument is scanned as code. The lists below are therefore the
# flags that TAKE A VALUE, which is a much shorter and much more stable set — a value fused to its
# flag is what made `-rdate` look like `-e` in the first place.
#
# `-` is excluded from every class so a bundle cannot run past its own token into the next flag.
HOOK_INTERP_SH_BOOL='[^ \t;&|(\n"\047oO-]*'
HOOK_INTERP_PY_BOOL='[^ \t;&|(\n"\047WXQm-]*'
HOOK_INTERP_RB_BOOL='[^ \t;&|(\n"\047rIECFKx-]*'
HOOK_INTERP_PL_BOOL='[^ \t;&|(\n"\047ImMFCi-]*'
HOOK_INTERPRETER_RE="${HOOK_INTERP_BOUNDARY}("
# A shell: `-c`, in a bundle or alone. NOT `--command` — measured, `bash --command` is "invalid
# option" and `python3 --command` is "unknown option". A flag the tool does not have is a claim this
# file makes and the tool refuses, which is the same class as everything else on this list.
# The shell alternative is NAMED, because two lists need it and review found the second one
# carrying a hand-written copy: `HOOK_SHELL_INTERPRETER_RE` below still had `-[a-zA-Z]*c` after this
# one was narrowed, and the tokenizer tries that list FIRST — so `bash -qc "…"` matched there and the
# narrowing was dead for every shell. Sharing the parts was not enough; the ALTERNATIVE has to be the
# same string, or "composed from the same parts" is a claim about the parts nobody made about the whole.
HOOK_INTERP_SHELL_ALT="${HOOK_INTERP_PATH}(sh|bash|zsh|dash|ksh|tcsh|csh|ash|fish|mksh|busybox)[ \t]+${HOOK_INTERP_ARGS}-${HOOK_INTERP_SH_BOOL}c${HOOK_INTERP_SEP}"
HOOK_INTERPRETER_RE="${HOOK_INTERPRETER_RE}${HOOK_INTERP_SHELL_ALT}"
# python: `-c`. `-m` names a MODULE, not code.
HOOK_INTERPRETER_RE="${HOOK_INTERPRETER_RE}|${HOOK_INTERP_PATH}python[0-9.]*[ \t]+${HOOK_INTERP_ARGS}-${HOOK_INTERP_PY_BOOL}c${HOOK_INTERP_SEP}"
# ruby: `-e` only. `-E` is the encoding flag and `-r` requires a LIBRARY — both would over-block.
HOOK_INTERPRETER_RE="${HOOK_INTERPRETER_RE}|${HOOK_INTERP_PATH}ruby[ \t]+${HOOK_INTERP_ARGS}-${HOOK_INTERP_RB_BOOL}e${HOOK_INTERP_SEP}"
# node / bun: `-e`/`--eval` and `-p`/`--print`, which evaluates its argument and prints the result.
# Both long forms confirmed by RUNNING them.
#
# No bundle: node has no single-letter flag bundling at all, so the short forms are exact. `-[a-zA-Z]*[ep]`
# was here and read `node -rdate "…"` — require the `date` module — as an eval of its argument.
HOOK_INTERPRETER_RE="${HOOK_INTERPRETER_RE}|${HOOK_INTERP_PATH}(node|bun)[ \t]+${HOOK_INTERP_ARGS}(-[ep]|--eval|--print)${HOOK_INTERP_SEP}"
# `deno eval <code>` / `bun eval <code>` take the code positionally.
#
# `eval` is a SUBCOMMAND, so it is the FIRST token after the binary — no `HOOK_INTERP_ARGS` in front
# of it, and review is why. With arguments allowed before it, `deno run cli.ts eval "…"` matched and
# a data argument was read as code. A flag may be interspersed; a subcommand may not.
#
# `run` is NOT here at all: `deno run` and `bun run` take a script FILE or a package.json script
# NAME, never inline code, and keeping it read a quoted argument as code.
HOOK_INTERPRETER_RE="${HOOK_INTERPRETER_RE}|${HOOK_INTERP_PATH}(deno|bun)[ \t]+eval[ \t]+"
# perl: `-e` and `-E`, in a bundle (`-ne`, `-lE`) or alone. NOT `--eval` — measured, perl answers
# "Unrecognized switch: --eval".
HOOK_INTERPRETER_RE="${HOOK_INTERPRETER_RE}|${HOOK_INTERP_PATH}perl[ \t]+${HOOK_INTERP_ARGS}-${HOOK_INTERP_PL_BOOL}[eE]${HOOK_INTERP_SEP}"
# php: `-r` runs the argument; `-B`/`-R`/`-E` run it before/per-line/after input. `-F` takes a FILE.
# `--run` is php's documented long form of `-r`; php is not installed on this host, so that one is
# from the documentation and is marked as such rather than claimed as measured. php does not bundle
# single-letter flags, so these are exact.
HOOK_INTERPRETER_RE="${HOOK_INTERPRETER_RE}|${HOOK_INTERP_PATH}php[ \t]+${HOOK_INTERP_ARGS}(-[rRBE]|--run)${HOOK_INTERP_SEP}"
# expect: `-c` runs commands; a bare positional argument is a script FILE. Single-dash options only,
# and no bundling, so `-c` is exact.
HOOK_INTERPRETER_RE="${HOOK_INTERPRETER_RE}|${HOOK_INTERP_PATH}expect[ \t]+${HOOK_INTERP_ARGS}-c${HOOK_INTERP_SEP}"
# Positional: the code argument carries no flag at all, whatever precedes it.
#
# `tclsh` and `expect` were here with `ssh` and `awk`, and review was right that they do not share
# that grammar — they share `perl`/`php`'s, which this change had just fixed one commit earlier.
# MEASURED: `tclsh 'puts X'` answers `couldn't read file "puts X"`, the same shape as the perl
# reading that started INFRA-084. `tclsh` has no inline-code flag at all, so it is not an
# interpreter for this purpose and is gone from the list entirely; `expect` moved up to its `-c`.
#
# `ssh` and `awk` stay: their trailing quoted string genuinely IS the remote command / the program,
# with no flag, regardless of what precedes it.
HOOK_INTERPRETER_RE="${HOOK_INTERPRETER_RE}|${HOOK_INTERP_PATH}(ssh|awk)[ \t]+${HOOK_INTERP_ARGS}"
# The shell builtin `eval`, which runs its argument. It matches the WORD anywhere, not only in
# command position — so `deno run cli.ts eval "…"` is read as code even though that `eval` is an
# argument. MEASURED, and stated rather than left for the next reader: `somecmd arg eval "…"`
# matches too, and `notaneval` does not, which is how the source was identified.
#
# Left as is. Narrowing it needs a notion of command position the tokenizer does not expose, and the
# over-match fails in the SAFE direction — a data argument read as code costs a false refusal the
# author sees, where the opposite costs a bypass nobody sees.
HOOK_INTERPRETER_RE="${HOOK_INTERPRETER_RE}|eval[ \t]+)\$"

# The subset whose string argument is parsed AS SHELL. `python3 -c`, `node -e`, `perl -e` and
# `awk` run a command too, but not a shell one, so reading their argument with shell quoting
# rules would be an approximation of a DIFFERENT grammar — the exact mistake this file is a
# record of. They stay on the list above, kept verbatim; only these are descended into.
#
# THE SAME ALTERNATIVE as the list above — `${HOOK_INTERP_SHELL_ALT}`, one string, not a second
# spelling of it. It was a literal copy carrying its own `--command` and its own required space, and
# after those were fixed it drifted again: the copy kept `-[a-zA-Z]*c` through the bundle narrowing
# and, because the tokenizer tries THIS list first, the narrowing never applied to a shell at all.
# Two corrections, one cause. "Composed from the same parts" says nothing about the whole.
HOOK_SHELL_INTERPRETER_RE="${HOOK_INTERP_BOUNDARY}("
HOOK_SHELL_INTERPRETER_RE="${HOOK_SHELL_INTERPRETER_RE}${HOOK_INTERP_SHELL_ALT}"
HOOK_SHELL_INTERPRETER_RE="${HOOK_SHELL_INTERPRETER_RE}|${HOOK_INTERP_PATH}ssh[ \t]+${HOOK_INTERP_ARGS}"
HOOK_SHELL_INTERPRETER_RE="${HOOK_SHELL_INTERPRETER_RE}|eval[ \t]+)\$"

# A tokenizer for the shell grammar, for the one question the guards ask: which characters of this
# command will the shell EXECUTE, and which are data it will merely pass along?
#
# Why a tokenizer and not one more pass over the string.
#
# This file used to answer that with two linear passes: mask quoted regions, then restore
# command-substitution spans. Both passes are regular, and shell quoting is not: `"$(printf 'x')"`
# nests a single-quoted payload inside a substitution inside a double-quoted string, and deciding
# what is data at the innermost level needs a stack. The restore pass had none, so it copied the
# whole span back from the original, quoted payload included, and
#
#     out=$(printf 'x git commit -m y' | bash h.sh); echo done
#
# was refused as a commit (INFRA-075). Indexing where each quote OPENED closed that spelling and
# opened its mirror: with the inner quotes now held masked, a genuine `a=$(echo "$(git commit)")`
# stopped being seen at all — a real invocation invisible to every guard, which is a bypass, not a
# nuisance. Measured on the differential corpus at the commit before this tokenizer existed: 177
# of 197 shapes agreed with bash. Five of the twenty that did not were BYPASSES — bash ran the
# push and no guard could see it — and the rest were refusals of correct work. With the grammar
# read properly: 194 of 197, and every remaining disagreement is the one class named below.
#
# Four days of that class: `branch-guard.sh` rewritten 26 times, seven distinct instances, every one
# found by a person hitting a new spelling and twice by a fix refusing the branch it lived on. The
# repair is not a third pass. A substitution's content is itself a command and must be read by the
# same rules that read the outer command — that is recursion, and the program below expresses it
# as an explicit context stack, so the nesting depth is not bounded by the number of passes.
#
# What it models: single quotes, double quotes, ANSI-C `$'…'`, locale `$"…"`, backslash escapes and
# the backslash-newline continuation, `#` comments, heredocs (`<<`, `<<-`, quoted and unquoted
# delimiters) and herestrings, redirections, subshells, `${…}`, `$((…))`, `$(…)` and backtick
# substitutions NESTED TO ANY DEPTH, and the string an interpreter is told to run.
#
# What it deliberately does NOT model, stated rather than discovered later: COMMAND POSITION. `echo
# git push` names a verb the shell never runs as a command, and this tokenizer still shows it. To
# hide it, the mask would have to drop every word that is not the first of a simple command — and
# then `sudo git push`, `xargs git push`, `env git push`, `timeout 5 git push`, `command git push`
# and every other exec-style wrapper not on some list would go unseen. That trade runs the wrong
# way: an unmodelled wrapper is a silent BYPASS, while an argument read as a command is a refusal
# that announces itself. The shapes this leaves unread are pinned as disagreements in
# `scripts/harness/__tests__/hook-reading-matches-bash.test.mjs`, not hidden.
#
# The output is length-preserving, one character in for one character out, because `hook_match_*`
# locates a verb in the mask and then reads its argument from the ORIGINAL at the same offset.
# Executed text comes back as itself; data becomes \001; a quote that delimits a region the shell
# will run becomes a space, so `git "push"` reads exactly as `git  push `.

# The program defines awk FUNCTIONS only, and is concatenated ahead of the END block below, which
# calls `tk_mask`. It is a separate variable because a parser and a set of field accessors are
# different jobs, and because every awk invocation here needs the same one.
#
# No literal backtick and no literal apostrophe appears below. Both are load-bearing characters of
# the grammar being parsed AND terminators of the single-quoted shell string carrying the program;
# writing one directly is what left this file unparseable once, which blocks every guarded command
# in the session. They are spelled \140 and \047.
HOOK_TOKENIZER_AWK='
  # A `#` opens a comment only where a word can begin.
  function tk_wordstart(s, i) {
    return (i == 1 || substr(s, i - 1, 1) ~ /[ \t\n;&|(]/)
  }

  # Characters that may end a heredoc delimiter word.
  function tk_delimchar(c) {
    return (c ~ /[A-Za-z0-9_.\/-]/)
  }

  # Fill m[1..length(s)] with the reading of s.
  #
  # Two interpreter lookbehinds, because the grammar this file knows is the SHELL grammar. SRE names
  # the interpreters that parse their string argument AS SHELL — the shells themselves, `eval`, and
  # `ssh` (a remote shell reads it) — and the tokenizer descends into those, which is what tells
  # `bash -c "echo \047git commit\047"` from `bash -c "git commit"`. IRE names every interpreter,
  # shell or not; a string run by `python3 -c` or `perl -e` is a command but NOT a shell command, so
  # applying shell quoting to it would be a second approximation dressed as a parse. Those are kept
  # verbatim, which over-reads (a mention inside python source still shows) — the direction that
  # refuses work rather than the one that lets a `python3 -c "os.system(\047git push\047)"` through.
  # The interpreter word an IRE match names, basename-only.
  #
  # The LAST match in the prefix, not the first: a shell interpreter wrapping a python one has two,
  # and the one that owns the quote about to open is the nearest to it. `match()` returns the first,
  # so the search walks forward until no further match remains.
  #
  # NOTE: this awk program is a single-quoted shell string. An apostrophe in a comment CLOSES it and
  # the file then fails to source at all. Write around them.
  function tk_interp_name(pre, IRE,   best, rest, n, a, w) {
    best = ""
    rest = pre
    while (match(rest, IRE)) {
      best = substr(rest, RSTART, RLENGTH)
      rest = substr(rest, RSTART + 1)
    }
    if (best == "") { return "" }
    sub(/^[^A-Za-z0-9_\/.]+/, "", best)
    n = split(best, a, /[ \t]+/)
    w = (n > 0) ? a[1] : ""
    sub(/^.*\//, "", w)
    return w
  }

  # INFRA-123: the payload REGIONS are recorded as they open and close, into the globals
  # `TK_PN` / `TK_PS` / `TK_PL` / `TK_PI`. The masker already has to decide that a quoted string is
  # an interpreter payload — that is what `kind[sp] = "TOK"` means — and then throws the boundary
  # away, which is why nothing downstream can say whose language a line is written in. Recording it
  # costs two assignments at the open and one at the close.
  function tk_mask(s, m, IRE, SRE,
                   len, i, j, w, c, c2, c3, nx, k, q, spaced, ch,
                   sp, kind, fend, fdep, fterm, fdash, fquo, pstart, pinterp,
                   hn, hterm, hdash, hquo, dash, quoted, term, dc, eol, e, line, cand) {
    len = length(s)

    # Pre-fill with the original. Anything the loop somehow fails to visit therefore stays VISIBLE:
    # a guard that over-reads refuses work and is argued with, a guard that under-reads is a hole
    # nobody notices.
    for (i = 1; i <= len; i++) { m[i] = substr(s, i, 1) }

    sp = 1
    kind[1] = "CMD"; fend[1] = ""; fdep[1] = 0
    hn = 0
    i = 1

    while (i <= len) {
      c = substr(s, i, 1)
      c2 = substr(s, i, 2)
      c3 = substr(s, i, 3)
      k = kind[sp]

      # ---- single quotes: no expansion of any kind happens inside ----
      if (k == "SQ") {
        if (c == "\047") { m[i] = "\047"; sp--; i++; continue }
        m[i] = "\001"; i++; continue
      }

      # ---- $\047…\047 : ANSI-C quoting. Escapes are consumed, nothing expands. ----
      if (k == "ANSI") {
        if (c == "\\") { m[i] = "\001"; if (i + 1 <= len) { m[i + 1] = "\001" }; i += 2; continue }
        if (c == "\047") { m[i] = "\047"; sp--; i++; continue }
        m[i] = "\001"; i++; continue
      }

      # ---- a quoted region an interpreter runs, and a quoted single word, are read verbatim ----
      # A single word in quotes is a TOKEN of the command line, not a payload: `git "push"` runs the
      # same push as `git push`, and quoting every token is ordinary defensive style.
      if (k == "TOK") {
        if (c == "\\" && fend[sp] != "\047") {
          m[i] = c; if (i + 1 <= len) { m[i + 1] = substr(s, i + 1, 1) }; i += 2; continue
        }
        if (c == fend[sp]) {
          # INFRA-123: this is where an interpreter payload ENDS, so this is where its extent is
          # known. The other `fend[sp] == c` site one screen down closes a region that is about to be
          # opened, not one being read — recording there produced zero payloads, which is how the
          # difference was found.
          if (pstart[sp] != "" && pinterp[sp] != "") {
            TK_PN++
            TK_PS[TK_PN] = pstart[sp]
            TK_PL[TK_PN] = i - pstart[sp]
            TK_PI[TK_PN] = pinterp[sp]
            pstart[sp] = ""
          }
          m[i] = " "; sp--; i++; continue
        }
        m[i] = c; i++; continue
      }

      # ---- heredoc body ----
      if (k == "HD") {
        # The terminator is recognised at the start of a physical line. The check is stateless — it
        # asks where we ARE rather than carrying a flag — so a substitution that spans a newline
        # inside the body cannot leave the frame believing it is mid-line forever.
        if (i == 1 || substr(s, i - 1, 1) == "\n") {
          e = index(substr(s, i), "\n")
          eol = (e > 0) ? i + e - 1 : len + 1
          line = substr(s, i, eol - i)
          cand = line
          # Only `<<-` allows an indented terminator, and only TABS are stripped. Stripping spaces
          # too would end a body early at an indented line that happens to read like the delimiter,
          # and the rest of that body would then be scanned as commands.
          if (fdash[sp]) { sub(/^\t+/, "", cand) }
          if (cand == fterm[sp]) {
            for (j = i; j < eol; j++) { m[j] = "\001" }
            if (eol <= len) { m[eol] = "\n" }
            i = eol + 1
            sp--
            continue
          }
        }
        if (c == "\n") { m[i] = "\n"; i++; continue }
        # An UNQUOTED delimiter leaves the body expanded, so a substitution written in it genuinely
        # runs. `<<\047EOF\047` and `<<"EOF"` are literal and stay data.
        if (!fquo[sp]) {
          if (c3 == "$((") { m[i] = "$"; m[i+1] = "("; m[i+2] = "("
            sp++; kind[sp] = "ARITH"; fend[sp] = ""; fdep[sp] = 0; i += 3; continue }
          if (c2 == "$(") { m[i] = "$"; m[i+1] = "("
            sp++; kind[sp] = "CMD"; fend[sp] = ")"; fdep[sp] = 0; i += 2; continue }
          if (c2 == "${") { m[i] = "$"; m[i+1] = "{"
            sp++; kind[sp] = "PARAM"; fend[sp] = ""; fdep[sp] = 0; i += 2; continue }
          if (c == "\140") { m[i] = "\140"
            sp++; kind[sp] = "CMD"; fend[sp] = "\140"; fdep[sp] = 0; i++; continue }
          if (c == "\\") { m[i] = "\001"; if (i + 1 <= len) { m[i + 1] = "\001" }; i += 2; continue }
        }
        m[i] = "\001"; i++; continue
      }

      # ---- ${…} : data, but a default value may itself be a substitution ----
      if (k == "PARAM") {
        if (c == "\\") { m[i] = "\001"; if (i + 1 <= len) { m[i + 1] = "\001" }; i += 2; continue }
        if (c3 == "$((") { m[i] = "$"; m[i+1] = "("; m[i+2] = "("
          sp++; kind[sp] = "ARITH"; fend[sp] = ""; fdep[sp] = 0; i += 3; continue }
        if (c2 == "$(") { m[i] = "$"; m[i+1] = "("
          sp++; kind[sp] = "CMD"; fend[sp] = ")"; fdep[sp] = 0; i += 2; continue }
        if (c == "\140") { m[i] = "\140"
          sp++; kind[sp] = "CMD"; fend[sp] = "\140"; fdep[sp] = 0; i++; continue }
        if (c == "{") { fdep[sp]++; m[i] = "\001"; i++; continue }
        if (c == "}") {
          if (fdep[sp] > 0) { fdep[sp]--; m[i] = "\001"; i++; continue }
          m[i] = "\001"; sp--; i++; continue
        }
        m[i] = "\001"; i++; continue
      }

      # ---- $((…)) : arithmetic, not a command, but substitutions inside it are ----
      if (k == "ARITH") {
        if (c == "\\") { m[i] = "\001"; if (i + 1 <= len) { m[i + 1] = "\001" }; i += 2; continue }
        # Arithmetic nests in arithmetic, and this was the ONE context that did not test for it
        # before falling through to the two-character substitution test. `$(( $(( … )) ))` was
        # therefore read as a command substitution whose content is a command, so the inner
        # expression came back as visible command text. It fails in the refusing direction rather
        # than the permitting one, but it is the same defect the rest of this file is a record of:
        # a rule held in every context except one sibling.
        if (c3 == "$((") { m[i] = "$"; m[i+1] = "("; m[i+2] = "("
          sp++; kind[sp] = "ARITH"; fend[sp] = ""; fdep[sp] = 0; i += 3; continue }
        if (c2 == "$(") { m[i] = "$"; m[i+1] = "("
          sp++; kind[sp] = "CMD"; fend[sp] = ")"; fdep[sp] = 0; i += 2; continue }
        if (c == "\140") { m[i] = "\140"
          sp++; kind[sp] = "CMD"; fend[sp] = "\140"; fdep[sp] = 0; i++; continue }
        if (c == "(") { fdep[sp]++; m[i] = "\001"; i++; continue }
        if (c == ")") {
          if (fdep[sp] > 0) { fdep[sp]--; m[i] = "\001"; i++; continue }
          m[i] = "\001"; if (i + 1 <= len) { m[i + 1] = "\001" }; sp--; i += 2; continue
        }
        m[i] = "\001"; i++; continue
      }

      # ---- double quotes: data, EXCEPT the expansions the shell performs inside them ----
      if (k == "DQ") {
        if (c == "\\") { m[i] = "\001"; if (i + 1 <= len) { m[i + 1] = "\001" }; i += 2; continue }
        if (c3 == "$((") { m[i] = "$"; m[i+1] = "("; m[i+2] = "("
          sp++; kind[sp] = "ARITH"; fend[sp] = ""; fdep[sp] = 0; i += 3; continue }
        # The substitution runs whatever the quoting around it, so its content is read as the
        # command it is — and read by these same rules, which is what makes the nesting unbounded.
        if (c2 == "$(") { m[i] = "$"; m[i+1] = "("
          sp++; kind[sp] = "CMD"; fend[sp] = ")"; fdep[sp] = 0; i += 2; continue }
        if (c2 == "${") { m[i] = "$"; m[i+1] = "{"
          sp++; kind[sp] = "PARAM"; fend[sp] = ""; fdep[sp] = 0; i += 2; continue }
        if (c == "\140") { m[i] = "\140"
          sp++; kind[sp] = "CMD"; fend[sp] = "\140"; fdep[sp] = 0; i++; continue }
        if (c == "\"") { m[i] = "\""; sp--; i++; continue }
        m[i] = "\001"; i++; continue
      }

      # ---- command context ----
      if (c == "\\") {
        nx = substr(s, i + 1, 1)
        # A backslash before a newline is a LINE CONTINUATION: the shell joins the two lines and
        # both characters vanish. Leaving them in place split `git \<newline>  commit` into two
        # words no verb pattern could match, and the invocation went unseen.
        if (nx == "\n") { m[i] = " "; m[i + 1] = " "; i += 2; continue }
        m[i] = c; if (i + 1 <= len) { m[i + 1] = nx }; i += 2; continue
      }

      if (c == "#" && tk_wordstart(s, i)) {
        while (i <= len && substr(s, i, 1) != "\n") { m[i] = "\001"; i++ }
        continue
      }

      if (c == "\n") {
        m[i] = "\n"; i++
        # The bodies of every heredoc opened on the line that just ended follow, in the order the
        # openers appeared, so the LAST one goes on the stack first.
        if (hn > 0) {
          for (w = hn; w >= 1; w--) {
            sp++; kind[sp] = "HD"; fend[sp] = ""; fdep[sp] = 0
            fterm[sp] = hterm[w]; fdash[sp] = hdash[w]; fquo[sp] = hquo[w]
          }
          hn = 0
        }
        continue
      }

      # A herestring has no body and no terminator, and its operand is an ordinary word. Consuming
      # all three characters at once is the point: skipping only the first left the SECOND and third
      # looking like a heredoc opener, whose delimiter word is command text and is kept — so
      # `cat <<< \047git commit\047` read its quoted operand as a command. The same defect the
      # original `%%<<*` truncation had, re-entered through the fix for it.
      if (c3 == "<<<") { m[i] = "<"; m[i+1] = "<"; m[i+2] = "<"; i += 3; continue }

      if (c2 == "<<") {
        j = i + 2
        dash = 0
        if (substr(s, j, 1) == "-") { dash = 1; j++ }
        while (j <= len && (substr(s, j, 1) == " " || substr(s, j, 1) == "\t")) { j++ }
        quoted = 0; term = ""
        dc = substr(s, j, 1)
        if (dc == "\047" || dc == "\"") {
          quoted = 1; j++
          while (j <= len && substr(s, j, 1) != dc) { term = term substr(s, j, 1); j++ }
          j++
        } else if (dc == "\\") {
          quoted = 1; j++
          while (j <= len && tk_delimchar(substr(s, j, 1))) { term = term substr(s, j, 1); j++ }
        } else {
          while (j <= len && tk_delimchar(substr(s, j, 1))) { term = term substr(s, j, 1); j++ }
        }
        if (term != "") {
          hn++; hterm[hn] = term; hdash[hn] = dash; hquo[hn] = quoted
          for (w = i; w < j && w <= len; w++) { m[w] = substr(s, w, 1) }
          i = j
          continue
        }
      }

      if (c3 == "$((") { m[i] = "$"; m[i+1] = "("; m[i+2] = "("
        sp++; kind[sp] = "ARITH"; fend[sp] = ""; fdep[sp] = 0; i += 3; continue }
      if (c2 == "$(") { m[i] = "$"; m[i+1] = "("
        sp++; kind[sp] = "CMD"; fend[sp] = ")"; fdep[sp] = 0; i += 2; continue }
      if (c2 == "${") { m[i] = "$"; m[i+1] = "{"
        sp++; kind[sp] = "PARAM"; fend[sp] = ""; fdep[sp] = 0; i += 2; continue }
      if (c2 == "$\047") { m[i] = "$"; m[i+1] = "\047"
        sp++; kind[sp] = "ANSI"; fend[sp] = ""; fdep[sp] = 0; i += 2; continue }
      if (c2 == "$\"") { m[i] = "$"; m[i+1] = "\""
        sp++; kind[sp] = "DQ"; fend[sp] = ""; fdep[sp] = 0; i += 2; continue }

      if (c == "\140") {
        if (fend[sp] == "\140") { m[i] = "\140"; sp--; i++; continue }
        m[i] = "\140"; sp++; kind[sp] = "CMD"; fend[sp] = "\140"; fdep[sp] = 0; i++; continue
      }

      if (c == "(") { m[i] = c; fdep[sp]++; i++; continue }
      if (c == ")") {
        if (fdep[sp] > 0) { fdep[sp]--; m[i] = c; i++; continue }
        if (fend[sp] == ")") { m[i] = c; sp--; i++; continue }
        m[i] = c; i++; continue
      }

      if (c == "\"" || c == "\047") {
        # Closing the string an interpreter was told to run.
        if (fend[sp] == c) { m[i] = " "; sp--; i++; continue }
        q = c
        # The decision is made at the OPENING quote, by what immediately precedes it, so each string
        # answers for itself: applying an interpreter exemption to a whole command line masked away
        # a real `-C` and left an unrelated commit message readable as a push, both at once.
        if (substr(s, 1, i - 1) ~ SRE) {
          m[i] = " "; sp++; kind[sp] = "CMD"; fend[sp] = q; fdep[sp] = 0; i++; continue
        }
        if (substr(s, 1, i - 1) ~ IRE) {
          m[i] = " "; sp++; kind[sp] = "TOK"; fend[sp] = q; fdep[sp] = 0
          # INFRA-123: the extent of this payload is everything after the quote, up to the one that
          # closes it. Recorded here because this is the only place that knows the string is CODE and
          # whose language it is.
          pstart[sp] = i + 1
          pinterp[sp] = tk_interp_name(substr(s, 1, i - 1), IRE)
          i++; continue
        }
        spaced = 0
        j = i + 1
        while (j <= len) {
          ch = substr(s, j, 1)
          if (ch == "\\" && q != "\047") { j += 2; continue }
          if (ch == q) { break }
          if (ch == " " || ch == "\t" || ch == "\n") { spaced = 1; break }
          j++
        }
        if (!spaced) {
          m[i] = " "; sp++; kind[sp] = "TOK"; fend[sp] = q; fdep[sp] = 0; i++; continue
        }
        m[i] = q; sp++; kind[sp] = (q == "\047") ? "SQ" : "DQ"; fend[sp] = ""; fdep[sp] = 0
        i++; continue
      }

      m[i] = c; i++
    }
  }
'

HOOK_SCAN_AWK='
  { lines[NR] = $0 }
  END {
    # One string, so a quote opened on one line still masks the next. The sed this replaces worked a
    # line at a time and left multi-line arguments unmasked entirely.
    s = ""
    for (n = 1; n <= NR; n++) { s = s (n > 1 ? "\n" : "") lines[n] }
    len = length(s)

    # The whole reading, delegated to the grammar. What used to sit here was a quote-state pass
    # followed by a substitution-restore pass, and no arrangement of two linear passes can say
    # what a quote inside a substitution inside a quote means. See the tokenizer above.
    tk_mask(s, m, IRE, SRE)

    mask = ""
    for (i = 1; i <= len; i++) { mask = mask m[i] }

    # ---- the STATEMENTS of this command ----
    #
    # A Bash tool call is a SEQUENCE of statements and each guarded action belongs to exactly one of
    # them. `branch-guard.sh` used to answer for all of them at once — booleans over the whole
    # command, and a single NEW_BRANCH / START_POINT / DELETE_BRANCH_NAME taken from the FIRST match
    # anywhere, because `match()` returns the first match only. Any action then escaped judgement
    # behind any well-formed sibling; measured, with no override token involved:
    #   git checkout -b feat/x develop ; git checkout -b feat/y main  -> exit 0 (wrong base unjudged)
    #   git checkout -b feat/ok ; git checkout -b BAD_NAME            -> exit 0 (bad name unjudged)
    #
    # The boundary is looked for in the MASK, never in the original: a `;` inside a quoted argument
    # or a heredoc body is \001 there and cannot split a statement that is not one. A NEWLINE is a
    # separator too — leaving it out is how the next spelling of this defect would arrive, and it is
    # safe here for the same reason, because every mode below reads the FULL-CONTEXT mask through a
    # window rather than re-masking a slice.
    if (MODE == "ranges") {
      start = 1
      for (i = 1; i <= len; i++) {
        c = substr(mask, i, 1)
        # `&` in a REDIRECTION is not a separator. `2>&1`, `1>&2` and `>&2` are among the most
        # common things anyone writes, and splitting on that `&` cut the statement in two — every
        # caller then judged a truncated fragment, in one measured case one carrying an unclosed
        # `$(`. A redirecting `&` is preceded by `>` or `<`, optionally with a digit between.
        # (INFRA-085, found while chasing a #1588 review finding whose stated cause was elsewhere.)
        if (c == "&") {
          # `2>&1` and `>&2` put the ampersand AFTER the arrow; `&>` and `&>>` put it BEFORE. Reading
          # only the character in front caught the first pair and missed the second, and bash accepts
          # a redirection BETWEEN arguments — so `git commit -m "x" &> /dev/null --no-verify` split
          # into a fragment holding the verb and one holding the flag, and the gate saw neither.
          # (INFRA-085, second half, from a #1588 review.)
          if (i > 1) {
            p = substr(mask, i - 1, 1)
            if (p == ">" || p == "<") continue
          }
          if (i < len && substr(mask, i + 1, 1) == ">") continue
        }
        # `>|` is the CLOBBERING REDIRECTION, one operator, not an arrow beside a pipe. Splitting
        # there put the operator in one statement and its target in the next, so a per-statement
        # caller asking what this command writes to got nothing from either half — and
        # `branch-guard.sh` therefore could not see `echo x >| .husky/pre-push` as overwriting a
        # hook. Exactly the shape of the `&` case above, found the same way: by driving the
        # redirection reader per statement instead of over the whole command. (INFRA-111)
        if (c == "|" && i > 1 && substr(mask, i - 1, 1) == ">") continue
        if (c == ";" || c == "&" || c == "|" || c == "\n") {
          if (i > start) { print start " " (i - start) }
          start = i + 1
        }
      }
      if (len >= start) { print start " " (len - start + 1) }
      exit
    }

    # ---- the WINDOW ----
    #
    # Applied to the mask and the original TOGETHER, so the offsets stay aligned. That alignment is
    # what lets a caller ask about ONE statement without losing the context that decided what is
    # data: the command was masked whole, and only the READING is narrowed.
    ws = (WSTART == "" ? 1 : WSTART + 0)
    if (ws < 1) { ws = 1 }
    wl = (WLEN == "" ? len - ws + 1 : WLEN + 0)
    if (wl < 0) { wl = 0 }
    if (ws + wl - 1 > len) { wl = len - ws + 1 }
    s = substr(s, ws, wl)
    mask = substr(mask, ws, wl)

    if (MODE == "mask") { print mask; exit }

    # ---- the EMBEDDED PAYLOADS, one `INTERPRETER START LENGTH` line each ----
    #
    # INFRA-123. Every reader in this file EXPANDS an interpreter payload — that is what makes
    # `python3 -c "…"` readable at all — and then nothing downstream can say where the payload began
    # or whose language it is. So a rule scoped to one language has no subject: measured on this
    # tree, python lives in **zero** tracked `.py` files and **zero** python-shebang files, against
    # 14 files containing `python3 -c`, every one of them `.sh`, `.mjs`, `.md` or `.yml`. A
    # file-scoped rule would enforce nothing while the rule table said it did; an unscoped one
    # reports `import glob from "glob"` in JavaScript, which is refusing the safe sibling.
    #
    # The unit with a language is the PAYLOAD, and this is the reader for it. Three earlier cuts
    # tried to reach it from the command instead — a whole-command conjunction, a nearest-interpreter
    # walk with a hand-written reset list, and a separator reset — and each refused a correct
    # command, because after expansion the payload’s own `;`, `|` and `&` are indistinguishable from
    # the shell’s.
    #
    # STATED LIMIT: a HEREDOC body is not reported here. The masker treats it as quoted content and
    # never opens a payload for it, so its interpreter is knowable but its extent is not recorded by
    # this pass. In a COMMITTED FILE a heredoc body is ordinary file text, which is the half the scan
    # side reads; at the command it stays the blindness every guard in this directory has.
    if (MODE == "payloads") {
      for (i = 1; i <= TK_PN; i++) { print TK_PI[i] " " TK_PS[i] " " TK_PL[i] }
      exit
    }

    # ---- what this command WRITES to, one target path per line ----
    #
    # Added by INFRA-111. Two guards asked this question and each answered it with its own regex over
    # redirection spellings, so each had its own holes and the two sets were DIFFERENT: the bulk-edit
    # guard missed `>&`, `branch-guard` missed `>&` and `>|`, and every round of hand-enumeration
    # certified itself exhaustive and was wrong the next round. The grammar was already here — the
    # `ranges` branch above has to know where a redirection is, to keep its `&` from splitting a
    # statement — and kept it private.
    #
    # The operator set was MEASURED against bash rather than enumerated, and the measurement moved
    # two rows of the item that filed this:
    #
    #   > >> >| &> &>> 2> >& >&NAME <>      create or write the named file
    #   2>& NAME                            bash: ambiguous redirect — writes NOTHING
    #   >>& NAME                            bash: syntax error — writes nothing
    #   2>&1  >&2  1>&2  >&-                duplicate or close a descriptor; no file
    #
    # So two spellings the filing item listed as holes are commands bash itself refuses. They are
    # still REPORTED here, because the reader decides by shape and a fd-qualified `>&` is not worth a
    # second rule to permit something that cannot run: over-reporting a command bash rejects costs a
    # refusal of nothing, while under-reporting one it accepts is a bypass.
    #
    # `<>` opens for reading AND writing, and was in neither guard regex. Verified by running it:
    # `echo x <> FILE` creates FILE.
    #
    # A target is skipped only when the `&` form names a DESCRIPTOR — all digits, `-`, or digits with
    # a trailing `-`. Everything else after an arrow is a path.
    #
    # STATED LIMIT: the target is read from the ORIGINAL at the mask offset, the same split every
    # other reader here uses, so a quoted target is returned unquoted and a spliced one joined. A
    # target built by a SUBSTITUTION (`> "$(mktemp)"`) comes back as the substitution text, not as
    # what it will expand to — no reader in this file expands, and a caller matching a protected
    # prefix against it will simply not match.
    if (MODE == "redirs") {
      i = 1
      while (i <= len) {
        if (substr(mask, i, 1) != ">") { i++; continue }
        k = i + 1
        if (substr(mask, k, 1) == ">") { k++ }
        dup = 0
        if (substr(mask, k, 1) == "&") { dup = 1; k++ }
        else if (substr(mask, k, 1) == "|") { k++ }

        # Whitespace between the operator and its target, where the shell really sees whitespace.
        while (k <= len && substr(mask, k, 1) ~ /[ \t]/ && substr(s, k, 1) ~ /[ \t]/) { k++ }

        word = ""
        started = 0
        while (k <= len) {
          mc = substr(mask, k, 1)
          rc = substr(s, k, 1)
          if ((mc == " " || mc == "\t" || mc == "\n") && rc ~ /[ \t\n]/) { break }
          if (mc == ";" || mc == "&" || mc == "|" || mc == ">" || mc == "<" || mc == ")") { break }
          started = 1
          # A quote DELIMITER contributes no character, and it has TWO spellings in the mask. The
          # tokenizer turns it into a space when it read the region as a single-word token, and
          # leaves the quote character ITSELF when the region contains whitespace. Only the first was
          # skipped, so a target quoted around a space came back wearing its quotes —
          # `"node_modules/a b"` — and the anchored store pattern no caller could match it. Measured
          # across ten arrow spellings, every one permitted a write bash performs.
          if (mc == " " || mc == "\"" || mc == "\047") { k++; continue }
          # The `$` of `$'…'` / `$"…"` introduces the delimiter and is not part of the name either.
          if (mc == "$" && (substr(mask, k + 1, 1) == "\"" || substr(mask, k + 1, 1) == "\047")) {
            k++
            continue
          }
          # An unquoted backslash splices the next character.
          if (mc == "\\" && rc == "\\") { k++; continue }
          # Masked content is data, and here the data IS the name — read it from the original.
          word = word rc
          k++
        }
        if (started && word != "" && !(dup && word ~ /^[0-9]*-?$/)) { print word }
        i = (k > i ? k : i + 1)
      }
      exit
    }

    # ---- the WORDS the shell builds, one per line ----
    #
    # Added because four guards had grown their own sed/awk passes to answer "is this flag an
    # argument of this command", and every one of them was wrong in a different way: `-v` unescaped
    # a backslash into a vertical tab, a blind splice-removal desynchronised the quoting and hid a
    # live flag behind an unterminated string, a greedy match anchored on a nested verb, an option
    # skipper swallowed `-x` as a flag. Each was a SECOND reading of a command written beside the one
    # this file exists to be.
    #
    # The splice is collapsed HERE, where the quoting is already known, rather than by a text pass
    # that has to guess: `--no-''verify` and `--no-\verify` are one word to the shell and are one
    # word here. A character the mask hides stays hidden, so a quoted argument does not become an
    # option — which is what keeps a commit message that merely NAMES a flag from reading as one.
    # `allwords` is the same split with the substitutions INCLUDED, each opening and closing
    # delimiter acting as a word break. It answers a different question, and the difference is not a
    # preference:
    #
    #   words     — "what flags did THIS command receive?"  A substitution is a different command,
    #               and reading its `-n` as this one is a false positive.
    #   allwords  — "does anything anywhere in this statement do X?"  A substitution RUNS, so a
    #               destructive verb inside one is as real as a leading one. Measured:
    #               `echo "$(chmod -x .husky/pre-push)"` disarmed a hook and was permitted, because
    #               the only reading that could have seen it excluded substitutions by design.
    #
    # A statement range does NOT split at a substitution, so asking the range question does not
    # answer this one — checked, `echo "$(chmod …)"` is a single statement. (#1588 review)
    if (MODE == "words" || MODE == "allwords") {
      word = ""
      started = 0
      sub_depth = 0
      bt_open = 0
      incsubs = (MODE == "allwords")
      for (i = 1; i <= length(s); i++) {
        mc = substr(mask, i, 1)
        rc = substr(s, i, 1)
        if (incsubs) {
          if (mc == "$" || mc == "(" || mc == ")" || mc == "\140" || mc == "{" || mc == "}") {
            if (started) { print word; word = ""; started = 0 }
            continue
          }
        }
        # A substitution RUNS, so its content is a command in its own right and NOT part of this
        # word. It is skipped by DEPTH rather than by dropping the punctuation characters, because
        # dropping them let the words inside a substitution leak out as words of the outer command:
        # `git commit -m "$(git log -n 1)"` handed a bare `-n` to a matcher looking for the flag that
        # skips hooks, and refused an ordinary commit. A guard that wants to judge what runs inside
        # asks about THAT statement — which is what the statement ranges are for. Dropping the
        # characters also swallowed a bare `}` closing a function, leaving a real statement with no
        # words at all. (#1588)
        #
        # The depth test comes FIRST, before anything else looks at this character. A space inside a
        # substitution belongs to the inner command and is not a separator of the outer one — testing
        # it after the whitespace break split `echo "$(git log -n 1)"` into four words, which is the
        # very leak this tracking exists to stop.
        #
        # NOTE: this awk program is a single-quoted shell string. An apostrophe in a comment here
        # CLOSES it, and the file then fails to source at all — which is how this comment lost its
        # possessives. Write around them.
        if (sub_depth > 0) {
          started = 1
          if (mc == "(") { sub_depth++ }
          else if (mc == ")") { sub_depth-- }
          continue
        }
        if (bt_open) { started = 1; if (mc == "\140") { bt_open = 0 } ; continue }
        # A separator ends the word only where the shell sees one. The mask shows a space at a
        # QUOTE DELIMITER too, and that is not a separator — `--no-''verify` is one word to bash.
        # So a space is a break only when the raw character is really whitespace.
        if ((mc == " " || mc == "\t" || mc == "\n") && rc ~ /[ \t\n]/) {
          if (started) { print word; word = ""; started = 0 }
          continue
        }
        started = 1
        # A quote delimiter itself contributes nothing but does not break the word.
        if (mc == " ") { continue }
        # Masked content is data. It keeps the word STARTED, so `-m "some message"` stays one word.
        if (mc == "\001") { continue }
        # Where a COMMAND substitution opens. See the depth test above for why its content is skipped.
        #
        # `${...}` and `$((...))` are deliberately NOT opened here, and the reason is that the masker
        # has already dealt with them: an unquoted `${HOME}` comes back as `${` plus five mask bytes,
        # the CLOSING BRACE AMONG THEM. Counting braces therefore opened a region that could never
        # close, and every remaining word of the statement was swallowed — measured on
        # `git commit ${EXTRA} --no-verify -m x`, which this guard then permitted in silence. The
        # exact bypass this change exists to close, reopened by the change itself. (#1588 review)
        #
        # `$((` is arithmetic, not a command, so it is excluded by lookahead rather than by hoping
        # the parens balance: its closing pair is masked in the same way.
        if (mc == "\140") { bt_open = 1; continue }
        if (mc == "$" && substr(mask, i + 1, 1) == "(" && substr(mask, i + 2, 1) != "(") {
          sub_depth = 1
          i++
          continue
        }
        # An unquoted backslash splices the next character: the shell drops it and joins.
        if (mc == "\\" && rc == "\\") { continue }
        word = word rc
      }
      if (started) { print word }
      exit
    }

    # Where an unquoted VALUE ends. Whitespace and quotes were the whole list, so a value read
    # out of a substitution came back wearing the paren that closed it: a nested
    # `git push origin --delete develop` named the branch `develop)`, which matches no protected
    # name, so the guard fell past the protected-branch check to the merged-PR one and refused a
    # branch that does not exist. It still refused — but for the wrong reason and about the wrong
    # branch, which is one name away from refusing nothing. Only visible once the tokenizer made
    # substitution contents reachable at all; before that the value was masked and never read.
    TERM = "[ \t\n\"\047)\140].*$"

    # Anchor in the mask, then search the ORIGINAL from that offset. Needed when the value sits
    # INSIDE a quoted argument — a `gh api` refs/heads URL nearly always does — where the mask
    # hides it. Reading the original from position zero instead is what let a decoy in a commit
    # message stand in for the real branch being deleted.
    if (MODE == "after") {
      if (!match(mask, ERE)) { exit }
      rest = substr(s, RSTART)
      if (!match(rest, VRE)) { exit }
      v = substr(rest, RSTART + RLENGTH)
      sub(TERM, "", v)
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
      sub(TERM, "", v)
      print v
    }
  }
'

# THE WINDOW, shared by every reader below (INFRA-079, #1563).
#
# Each of these takes an optional trailing (START, LENGTH) naming ONE statement of the command, as
# produced by `hook_statement_ranges`. Omitted, the reader answers about the whole command, which is
# what every pre-#1563 caller asked for. Given, it answers about that statement alone — while still
# masking the command WHOLE, so the reading of what is data never changes because a caller narrowed
# its question.
#
# The window is not a second parser and not a second reading: it is the same mask, read through a
# smaller opening. That is deliberate. A per-statement judgement built by re-masking each slice
# would be a THIRD reading of a command, in the file whose subject is that there must be one.

# The STATEMENTS of a command, one `START LENGTH` line each, in the order they will run.
hook_statement_ranges() {
  printf '%s\n' "$1" | awk -v MODE=ranges -v IRE="$HOOK_INTERPRETER_RE" -v SRE="$HOOK_SHELL_INTERPRETER_RE" -v ERE="" -v VRE="" -v WSTART="" -v WLEN="" "$HOOK_TOKENIZER_AWK$HOOK_SCAN_AWK"
}

# Print the token that follows a match, located where quotes cannot lie. $2 is an ERE ending where
# the value begins. $3/$4 optionally narrow the reading to one statement.
hook_match_extract() {
  printf '%s\n' "$1" | awk -v MODE=extract -v IRE="$HOOK_INTERPRETER_RE" -v SRE="$HOOK_SHELL_INTERPRETER_RE" -v ERE="$2" -v VRE="" -v WSTART="${3:-}" -v WLEN="${4:-}" "$HOOK_TOKENIZER_AWK$HOOK_SCAN_AWK"
}

# Like hook_match_extract, but the value is found by $3 searched in the ORIGINAL starting at the
# anchor $2's position in the mask. For values that legitimately live inside a quoted argument.
# $4/$5 optionally narrow the reading to one statement.
hook_match_extract_after() {
  printf '%s\n' "$1" | awk -v MODE=after -v IRE="$HOOK_INTERPRETER_RE" -v SRE="$HOOK_SHELL_INTERPRETER_RE" -v ERE="$2" -v VRE="$3" -v WSTART="${4:-}" -v WLEN="${5:-}" "$HOOK_TOKENIZER_AWK$HOOK_SCAN_AWK"
}

# What a verb-detection matcher should read — and, since #1572, the ONLY reading of a command this
# file offers.
#
# The RAW command goes in. Heredoc bodies and comments used to be cut out by two line-oriented passes
# BEFORE masking, which meant the masker was handed a string whose structure had already been altered
# by a reader that did not know the grammar. The tokenizer knows both, and reading them together is
# what lets a comment inside a substitution end at its own newline rather than at the substitution's
# closing paren. Those passes are gone; see the note where they stood.
hook_verb_scan() {
  printf '%s\n' "$1" | awk -v MODE=mask -v IRE="$HOOK_INTERPRETER_RE" -v SRE="$HOOK_SHELL_INTERPRETER_RE" -v ERE="" -v VRE="" -v WSTART="${2:-}" -v WLEN="${3:-}" "$HOOK_TOKENIZER_AWK$HOOK_SCAN_AWK"
}

# The WORDS a statement is built from, one per line, with splices collapsed and quoted content
# hidden. $2/$3 narrow the reading to one statement, as everywhere else.
#
# This is what a guard should ask when it wants to know whether a flag was PASSED, rather than
# whether its letters appear somewhere. See the `words` branch for why it lives here.
hook_statement_words() {
  printf '%s\n' "$1" | awk -v MODE=words -v IRE="$HOOK_INTERPRETER_RE" -v SRE="$HOOK_SHELL_INTERPRETER_RE" -v ERE="" -v VRE="" -v WSTART="${2:-}" -v WLEN="${3:-}" "$HOOK_TOKENIZER_AWK$HOOK_SCAN_AWK"
}

# The interpreter payloads embedded in this command: `INTERPRETER START LENGTH`, one per line.
#
# `START`/`LENGTH` index into the command exactly as `hook_statement_ranges` does, so a caller can
# narrow any other reader to a payload — or, for a rule that is about the payload TEXT, cut it out
# with the same offsets. The interpreter is the basename of the command word that owns the payload
# (`python3`, `node`, `ruby`); map it to a language with `scripts/harness/script-language.mjs`, which
# owns that table (INFRA-115).
#
# Ask this before applying a language-scoped rule to a command. See the `payloads` branch for the
# measurement, and for the heredoc limit.
hook_interpreter_payloads() {
  printf '%s\n' "$1" | awk -v MODE=payloads -v IRE="$HOOK_INTERPRETER_RE" -v SRE="$HOOK_SHELL_INTERPRETER_RE" -v ERE="" -v VRE="" -v WSTART="${2:-}" -v WLEN="${3:-}" "$HOOK_TOKENIZER_AWK$HOOK_SCAN_AWK"
}

# The paths this command REDIRECTS INTO, one per line, in the order they appear.
#
# Ask this when the question is "does this command write to somewhere I protect". Do NOT ask
# `hook_statement_words` and look for `>` — that was the shape both guards had, and a word split
# cannot tell `>&2` from `>&node_modules/x`. $2/$3 narrow the reading to one statement, as
# everywhere else. See the `redirs` branch for the operator set and the measurement behind it.
hook_redirect_targets() {
  printf '%s\n' "$1" | awk -v MODE=redirs -v IRE="$HOOK_INTERPRETER_RE" -v SRE="$HOOK_SHELL_INTERPRETER_RE" -v ERE="" -v VRE="" -v WSTART="${2:-}" -v WLEN="${3:-}" "$HOOK_TOKENIZER_AWK$HOOK_SCAN_AWK"
}

# The same split with SUBSTITUTION CONTENTS included, each delimiter a word break. Ask this when the
# question is "does anything in this statement do X" rather than "what did THIS command receive" —
# a substitution runs, so a destructive verb inside one is as real as a leading one. See the
# `allwords` branch for the measurement that made the distinction necessary.
hook_statement_all_words() {
  printf '%s\n' "$1" | awk -v MODE=allwords -v IRE="$HOOK_INTERPRETER_RE" -v SRE="$HOOK_SHELL_INTERPRETER_RE" -v ERE="" -v VRE="" -v WSTART="${2:-}" -v WLEN="${3:-}" "$HOOK_TOKENIZER_AWK$HOOK_SCAN_AWK"
}

# Token classes here exclude the newline as well as space and tab. That matters in `branch-guard.sh`,
# where a name token ran greedily across a line break and read the next line's first word as a base —
# measured, and fixed there with a test. Here it is CONSISTENCY, not a fix: every multi-line form was
# tried against these expressions and none extracts anything different, because each requires
# `[ \t]+` right after a token and a newline never satisfies that. Recorded as unproven rather than
# dressed in a test that would pass either way.
# The directory a command will act on, read from a real `git -C` and not from a quoted mention.
# The prefix skip accepts EVERY value-taking global in both spellings, or a `--git-dir=X` (or a
# space-valued `--work-tree /x`) standing before the `-C` hid it from every consumer of this
# extractor and the command was judged against the wrong repository. STATED LIMIT: `--git-dir`
# itself also names a repository and is NOT extracted here — this reads `-C` only, and a caller
# that must honour `--git-dir` as identity needs its own reader.
#
# A value-LESS boolean global (`--no-pager`, `--bare`, `-p`) may also stand before the `-C`
# (`git --no-pager -C /repo status`); the prefix skips those too via a bare `-[^ \t\n]+` flag, the
# same tolerance GITPFX/_GOPT carry in branch-guard. Value-globals stay matched WITH their value so
# leftmost-longest does not read a space-form value as the flag. (#1666 review)
hook_git_c_path() {
  hook_match_extract "$1" '(^|[ \t;&|({\n"\047`])git[ \t]+((('"$GIT_VALUE_GLOBALS_SANS_C"')(=[^ \t\n]+|[ \t]+[^ \t\n]+)|-[^ \t\nC][^ \t\n]*)[ \t]+)*-C[ \t]+' "${2:-}" "${3:-}"
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
  verbs=$(hook_verb_scan "$1" "${2:-}" "${3:-}")

  if printf '%s' "$verbs" | grep -qE 'gh[[:space:]]+api[^|;&]*-X[[:space:]]+DELETE[^|;&]*'; then
    # From the `gh api` call's own position, not from the start of the string. Taking the first
    # match anywhere meant `git commit -m "note /git/refs/heads/scratch" && gh api -X DELETE
    # .../heads/develop` reported scratch, so the protected-branch and merged-PR checks never saw
    # the branch actually being deleted.
    name=$(hook_match_extract_after "$1" '(^|[ \t;&|({\n"\047`])gh[ \t]+api([ \t]|$)' '/git/refs/heads/' "${2:-}" "${3:-}")
    [[ -n "$name" ]] && { printf '%s' "$name"; return 0; }
  fi

  # `git push <remote> --delete <branch>` and `git push <remote> :<branch>`.
  name=$(hook_match_extract "$1" '(^|[ \t;&|({\n"\047`])git[ \t]+push[ \t]+[^ \t\n]+[ \t]+(--delete[ \t]+|:)' "${2:-}" "${3:-}")
  [[ -n "$name" ]] && { printf '%s' "$name"; return 0; }

  # `git push --delete <remote> <branch>` — git accepts the flag before the remote, and the guard
  # never did. Pre-existing rather than new, but a delete this misses is a delete it permits.
  hook_match_extract "$1" '(^|[ \t;&|({\n"\047`])git[ \t]+push[ \t]+--delete[ \t]+[^ \t\n]+[ \t]+' "${2:-}" "${3:-}"
}
