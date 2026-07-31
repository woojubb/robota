# shellcheck shell=bash
#
# One owner for each FACT a hook computes, because four hooks had four and the copies disagreed.
#
# `lib/command-scan.sh` next door owns the question "what does this payload SAY" — the command, the
# tool name, which part of it is a command rather than text. This file owns the question after it:
# "what does the ENVIRONMENT say" — which file is being written, which repository the command acts
# on, which branch that repository is on, and how git must be invoked for those answers to be about
# the repository the command actually runs in.
#
# An audit of this directory on 2026-08-01 ran every hook against scratch repositories and measured
# five facts computed by separate code in two or more hooks, with the copies giving DIFFERENT
# ANSWERS. Each disagreement was reachable from an ordinary command:
#
#   * `post-tool-format` and `memory-mirror-reminder` read `tool_input.file_path` with
#     `grep -o '"file_path"…"[^"]*"'`, which stops at the first ESCAPED quote. A file named
#     `we"ird.ts` was read as `we\`, the `-f` test then failed, and the file was silently never
#     formatted — the hook exits 0 either way, which is why nothing noticed.
#   * `correction-detect`, `revert-detect` and `spec-first-gate` each carried an identical
#     `read_json()` that calls jq and has NO python3 fallback, while the Bash guards fall back. On a
#     host without jq, half this directory went silently off while the other half kept working.
#   * Four repository resolutions under two rules. The validating one validated with a BARE `git -C`,
#     and an exported `GIT_DIR` makes `git -C <any existing dir> rev-parse --is-inside-work-tree`
#     exit 0 — so the guard adopted a directory that is not a repository as the repository it judged.
#   * `git branch --show-current` exits 0 with EMPTY output on a detached HEAD, so every
#     `$(… || echo unknown)` here is dead code and every detached session logged `"branch": ""`.
#   * `git_project()` scrubbed the git environment in two hooks, byte-identical, while ~20 bare
#     `git -C` call sites did not. With `GIT_DIR` exported, `git -C <scratch> branch --show-current`
#     reports the OUTER repository's branch — so a guard read one repository and judged another's
#     command, and a commit on `main` walked past the guard that exists to refuse it.
#
# TWO DIVERGENCES ARE DELIBERATE and survive here as NAMED MODES rather than being flattened, each
# with the reason it exists. They are named at `hook_effective_repo`.
#
# Contract for callers:
#   - Source this file; it sources `command-scan.sh`, so one source line is enough.
#   - All functions are safe under `set -euo pipefail`.
#   - A function that returns non-zero means "could not be read". A GUARD must treat that as a
#     refusal, never as an empty value that matches nothing.

# shellcheck source=command-scan.sh
source "$(dirname "${BASH_SOURCE[0]}")/command-scan.sh"

# --- git, with the ambient repository pointers removed -------------------------------------------

# `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE` and `GIT_PREFIX` OUTRANK `-C`. Any of them present in
# the environment makes git answer about the repository they name and ignore the directory the
# caller asked about, so a hook using bare `git -C` is not asking a weaker question — it is asking a
# question about a different repository. Measured: with `GIT_DIR` exported at a second checkout,
# `git -C <main clone> branch --show-current` returns the SECOND checkout's branch, which is enough
# to walk a `git commit` on `main` straight past branch-guard.
#
# These variables are exported by ordinary things — git hooks, `git rebase -x`, tooling that shells
# out mid-operation — so this is not an exotic state. Every git call a hook makes goes through here.
hook_git() {
  env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_PREFIX git "$@"
}

# `hook_git` against a named directory. The one call shape hooks should use.
hook_git_in() {
  local dir="${1:-}"
  shift || return 1
  hook_git -C "$dir" "$@"
}

# Is this directory inside a git work tree? Judged with the scrub, which is the whole point: the
# unscrubbed form answers "yes" for any directory that merely EXISTS whenever GIT_DIR is exported.
hook_is_work_tree() {
  [[ -n "${1:-}" ]] || return 1
  hook_git_in "$1" rev-parse --is-inside-work-tree >/dev/null 2>&1
}

# --- which repository the command acts on --------------------------------------------------------

# hook_effective_repo MODE GIT_C_PATH HOOK_CWD PROJECT_DIR
#
# One resolution, three NAMED modes. The modes are not an accident being preserved; each answers a
# different question, and unifying them would remove a fail-safe or reintroduce a false block. The
# cases in `scripts/harness/__tests__/hook-facts.test.mjs` pin all three, so a future unification
# breaks loudly instead of quietly.
#
#   validated       `git -C` > hook `cwd` > project dir, each candidate accepted only if it is
#                   really inside a work tree, falling back to the project dir (then `.`).
#                   Used by branch-guard and pre-push-check, which must name SOME repository because
#                   their verdict is about the branch it is on.
#
#   first-nonempty  `git -C` > hook `cwd` > project dir, taken as written, and EMPTY when none is
#                   given. DELIBERATE, and worktree-cwd-guard's fail-safe: that guard blocks only
#                   when it can POSITIVELY confirm the command lands in the main checkout, so naming
#                   an unresolvable `-C` target and then declining to block is the correct outcome.
#                   Validating instead would silently retarget the guard at the session repository
#                   and block a destructive command aimed somewhere else — and the `.` fallback the
#                   validated mode ends with once resolved to the HOOK'S OWN checkout and blocked
#                   there, which is why this mode has none.
#
#   session         hook `cwd` > project dir, with `git -C` DELIBERATELY IGNORED. Used by
#                   branch-guard's branch-base check: a branch is created where the session is, and
#                   in a compound command the `-C` usually belongs to some other invocation
#                   (`git checkout -b feat/x && git -C <other> status`). Honouring it there judged
#                   <other> and blocked a legitimate creation. Stated limit: `git -C <other>
#                   checkout -b` is judged against the session repository, which over-permits a rare
#                   form instead of refusing a common one.
hook_effective_repo() {
  local mode="${1:-}" git_c="${2:-}" hook_cwd="${3:-}" project_dir="${4:-}" dir

  case "$mode" in
    validated)
      dir="${project_dir:-.}"
      if hook_is_work_tree "$hook_cwd"; then dir="$hook_cwd"; fi
      if hook_is_work_tree "$git_c"; then dir="$git_c"; fi
      ;;
    first-nonempty)
      dir=""
      if [[ -n "$git_c" ]]; then
        dir="$git_c"
      elif [[ -n "$hook_cwd" ]]; then
        dir="$hook_cwd"
      elif [[ -n "$project_dir" ]]; then
        dir="$project_dir"
      fi
      ;;
    session)
      dir="${project_dir:-.}"
      if hook_is_work_tree "$hook_cwd"; then dir="$hook_cwd"; fi
      ;;
    *)
      return 1
      ;;
  esac

  printf '%s' "$dir"
}

# --- the current branch --------------------------------------------------------------------------

# hook_current_branch DIR DEFAULT
#
# The default is applied to the VALUE, not to the exit code. `git branch --show-current` exits 0 and
# prints NOTHING on a detached HEAD, so `$(git branch --show-current || echo unknown)` — written
# three ways in three hooks — never once reached its `||` arm and every detached session got "".
#
# The default is the CALLER'S to name because callers need different ones: an eval log wants a word
# a reader can see ("unknown"), while branch-guard and pre-push-check KEY ON EMPTINESS to recognise
# a detached HEAD and must be able to ask for "".
hook_current_branch() {
  local dir="${1:-}" fallback="${2:-}" name
  name=$(hook_git_in "$dir" branch --show-current 2>/dev/null || printf '')
  printf '%s' "${name:-$fallback}"
}

# --- payload fields ------------------------------------------------------------------------------

# The file a Write/Edit will write. Non-zero means the payload could not be decoded at all.
#
# Routed through the JSON decoders rather than grep for the reason at the top of this file: a path
# is allowed to contain a quote or a backslash, JSON escapes both, and a `[^"]*` grep stops at the
# escape and hands back a path that does not exist.
#
# Through `hook_json_text`, so this reader and `hook_prompt_of` answer the same question the same
# way. Measured on `{"tool_input": {"file_path": 123}}` before INFRA-081: `hook_json_string` returned
# `123` where jq was installed and "" where it was not, so the rule would otherwise have been
# one-per-function instead of one rule. A path is text or it is not a path. Since #1574 both readers
# ARE one function, and this line records which rule won rather than which function to call.
hook_file_path_of() {
  hook_json_text "$1" 'tool_input.file_path'
}

# A field, but ONLY when it holds a JSON string. Anything else reads as absent.
#
# THIS IS NOW `hook_json_string`, AND THE NAME IS ALL THAT REMAINS OF THE DIFFERENCE (INFRA-081,
# #1574).
#
# It was written here because `hook_json_string` did not promise the type test and its two arms
# DISAGREED without it. Measured on `{"message": {"role": "user", "content": "hello"}}`, which is the
# ordinary transcript shape and not an exotic one: with jq installed, `jq -r ".message // \"\""`
# printed the object's pretty-printed JSON; with jq absent, the python3 arm wrote "" because the node
# is not a `str`. #1566 could not fix that where it lived, because `command-scan.sh` was owned by
# concurrent work, so it wrote a second reader with the right rule and stated the limit.
#
# #1574 fixed the original and adopted THIS rule for it: a field that is not a string is not that
# field, on both arms, byte for byte. Keeping a second implementation of a rule that now has one
# owner would be the defect this whole directory has spent a week removing — so the body is gone and
# the NAME stays, because four hooks call it and their reason for calling it is unchanged: a
# structured node is not prompt TEXT, and returning the JSON blob would have `correction-detect` grep
# it for correction keywords and log it as `prompt_excerpt`, and `spec-first-gate` scan it for
# implementation intent.
hook_json_text() {
  hook_json_string "$1" "$2"
}

# The user's prompt text, under whichever of the three keys the event carries it.
#
# THE FIRST KEY THAT CARRIES TEXT — not the first key that is present. That is a DECISION, and it
# differs from the `.prompt // .user_prompt // .message` this replaced: jq's `//` yields its left
# operand whenever that operand is neither `null` nor `false`, and an empty string is truthy in jq.
# So the one payload that tells the two rules apart is
#
#     {"prompt": "", "user_prompt": "hello"}
#
# on which the old expression returned "" and this returns "hello".
#
# Fall-through is kept, for a reason a reader can check rather than take on trust:
#
#   * `hook_json_string` CANNOT express jq's distinction. Measured on BOTH arms, it returns "" with
#     exit 0 for an absent key and for a present-but-empty one alike. Reproducing `//` exactly would
#     mean adding a presence-distinguishing reader whose only consumer is a payload shape no host
#     emits — the three keys are three SPELLINGS of one fact, so a real event carries one of them.
#   * Of the two rules, "the first key that carries text" is the one that never goes blind on text
#     that is plainly present in the payload. Going silently blind is the failure this whole change
#     exists to remove, so where the rules differ, that is the tie-breaker.
#
# The rule the readers here share, stated once: a READER collapses absent and empty into "", and the
# CALLER names what empty means for it. That is the same shape as `hook_current_branch`'s
# caller-named default, and as `hook_command_of`/`hook_tool_name_of` treating an empty value as a
# refusal. This caller's answer is "an empty key is not the prompt; keep looking".
hook_prompt_of() {
  local key value
  for key in prompt user_prompt message; do
    if ! value=$(hook_json_text "$1" "$key"); then
      return 1
    fi
    if [[ -n "$value" ]]; then
      printf '%s' "$value"
      return 0
    fi
  done
  printf ''
}

# --- writing a JSON record -----------------------------------------------------------------------

# hook_json_object [s|n|b KEY VALUE]...
#
# Emits one compact JSON object. `s` is a string, `n` a number, `b` a boolean (`true`/`false`).
#
# The same ladder the readers use — jq, then python3, then refuse — and for the same reason. Three
# hooks read their payload with jq and also WROTE their record with `jq -cn`, so on a host without
# jq they did not merely mis-read the event: they recorded nothing at all, silently, while the rest
# of the directory kept working. Fixing the read alone would have left the metric just as empty.
#
# A number that is not a number is refused rather than coerced: a record is only worth writing if it
# says something true, and the callers here already normalise their counts.
hook_json_object() {
  local -a jq_args=() py_args=()
  local filter="{" first=1 kind key value

  while [[ $# -ge 3 ]]; do
    kind="$1"
    key="$2"
    value="$3"
    shift 3
    case "$kind" in
      n)
        [[ "$value" =~ ^-?[0-9]+$ ]] || return 1
        jq_args+=(--argjson "$key" "$value")
        ;;
      b)
        # Refused rather than coerced, for the same reason a number is: a record is worth writing
        # only if it says something true, and "anything that is not the word false is true" is how a
        # typo becomes a fact in a log.
        [[ "$value" == "true" || "$value" == "false" ]] || return 1
        jq_args+=(--argjson "$key" "$value")
        ;;
      s)
        jq_args+=(--arg "$key" "$value")
        ;;
      *)
        return 1
        ;;
    esac
    if [[ "$first" -eq 0 ]]; then filter+=","; fi
    first=0
    filter+="\"$key\":\$$key"
    py_args+=("$kind" "$key" "$value")
  done

  # A leftover argument means the caller's triples do not line up, and a record built from a
  # misaligned list would be wrong rather than absent.
  [[ $# -eq 0 && "$first" -eq 0 ]] || return 1
  filter+="}"

  if command -v jq >/dev/null 2>&1; then
    jq -cn "${jq_args[@]}" "$filter" 2>/dev/null && return 0
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 -c '
import json, sys
argv = sys.argv[1:]
out = {}
for i in range(0, len(argv), 3):
    kind, key, value = argv[i], argv[i + 1], argv[i + 2]
    if kind == "n":
        out[key] = int(value)
    elif kind == "b":
        out[key] = value == "true"
    else:
        out[key] = value
sys.stdout.write(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n")
' "${py_args[@]}" 2>/dev/null && return 0
  fi
  return 1
}
