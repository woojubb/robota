#!/bin/bash
# branch-guard hook
# Blocks git commit on protected branches (main, master, develop).
#
# fail-direction: refuse — this hook classifies git verbs, and git's grammar is wider than any list
# of spellings. An allowlist of flag tokens here leaked three bypasses in one change, each silent.
# So an unrecognised shape of a guarded verb is treated as THAT VERB and judged; what is excluded is
# enumerated instead, and a missing exclusion produces a refusal on ordinary work — visible, arguable,
# and overridable — rather than a hole nobody learns about.
# Blocks git push on main/master only (develop push after merge is allowed).
# Runs as a PreToolUse hook on Bash tool calls.
#
# Dependencies: git, grep, sed (POSIX standard — no jq required)

set -euo pipefail

INPUT=$(cat)

# One parser, not four. `command-scan.sh` explains what each hand-rolled copy got wrong; the short
# version is that the old `grep -o '"command"…"[^"]*"' ` stopped at the first quote inside the
# command, so everything after `-m "…"` — including the verb being guarded — was never examined.
# hook-facts.sh sources command-scan.sh, so one line brings in both the payload parser and the
# single owner of the repository, branch and scrubbed-git facts. See lib/hook-facts.sh.
# shellcheck source=lib/hook-facts.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/hook-facts.sh"
# shellcheck source=lib/bounded-gh.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/bounded-gh.sh"

# Extract tool_name without jq — match "tool_name":"Bash"
# Fail closed on an unreadable tool name. Left bare, a non-zero return aborts the assignment
# under `set -e` and the hook exits 1 with nothing said — which the hook protocol treats as
# non-blocking. Silent exit and "it is fine" are the two states this file refuses to conflate.
if ! TOOL_NAME=$(hook_tool_name_of "$INPUT"); then
  echo "[branch-guard] Blocked: the hook payload names no tool, so nothing can be judged." >&2
  exit 2
fi

if [[ "$TOOL_NAME" != "Bash" ]]; then
  exit 0
fi

# Extract command from tool_input.command
if ! COMMAND=$(hook_command_of "$INPUT"); then
  echo "[branch-guard] Blocked: the tool command could not be decoded, so it cannot be judged." >&2
  echo "[branch-guard] Install jq or python3 so this guard can read what it is judging." >&2
  exit 2
fi

# ONE reading, by the grammar (INFRA-075, #1572). This hook used to hold two: the tokenizer's, and
# one from two line-oriented passes that did no quote masking at all — and every EXTRACTION read the
# second one: the branch name, the start point, the deleted branch, the `-C` target. Measured on a
# scratch repository, each with the bare form refused:
#   git push origin --delete develop                        -> exit 2
#   echo "see <<EOF" ; git push origin --delete develop     -> exit 0
#   git checkout -b BAD_NAME                                -> exit 2
#   echo "see <<EOF" ; git checkout -b BAD_NAME             -> exit 0
# The quoted `<<EOF` opened a heredoc the old reading never saw close, so everything after it was
# deleted from the string the extractions read; they came back empty, and a check with no subject
# does not refuse. Verb detection reads this command with quoted ARGUMENTS blanked; the extractors
# mask it themselves and read the value from the ORIGINAL at the same offset, because branch names
# and `-C` paths are routinely quoted.
#
# The hook `cwd` is a property of the PAYLOAD, not of any statement in it, so it is read once here.
# Everything that IS a property of a statement is read inside the loop below. (INFRA-079, #1563)
HOOK_CWD=$(hook_cwd_of "$INPUT" || true)

# An override is given TO a command, so it must PREFIX one — and it excuses THAT statement, nothing
# else. `ALLOW=1 git …`, optionally behind other assignments, and nowhere else. (INFRA-076)
#
# Read off the MASKED statement, so an override named inside a heredoc body or a quoted argument is
# text and text cannot switch this guard off — `git commit -m "note: BRANCH_GUARD_ALLOW_DELETE=1 was
# tried" && git push origin --delete develop` did exactly that, disarming the check that exists
# because develop was once deleted by accident.
#
# Four earlier readings of this one question are worth naming, because each repair was correct and
# each left the next hole: env-only (the documented inline form did nothing), raw text (a mention
# switched it off), a token anywhere (`git commit -m X ALLOW=1 && git push …`), and prefixing SOME
# git call (`ALLOW=1 git status; git push origin main` — a skeleton key). #1559 added a counting
# invariant over the whole command on top of those, because the ACTION detection was still a set of
# booleans over the whole command and one global flag then answered for every guarded statement.
#
# The counting invariant is gone with the thing that needed it. When the subject is the statement,
# "every guarded statement carries its own override" is not a rule to enforce — it is what asking
# each statement separately MEANS. (INFRA-079, #1563)
#
# This process's ENVIRONMENT still counts. `BRANCH_GUARD_ALLOW_X=1` exported by a wrapper is a
# deliberate session-wide exception and several tests and worktree launchers rely on it; the inline
# form is the one git-branch.md documents. Both, not one.
stmt_override() {
  local token="$1"
  [[ "${!token:-0}" == "1" ]] && return 0
  printf '%s' "$STMT_MASK" |
    grep -qE "^[[:space:]]*([[:alnum:]_]+=[^[:space:]]+[[:space:]]+)*$token=1[[:space:]]"
}

# A quote and a backtick are boundaries too: a KEPT region — `bash -c "git push"`, or a backtick
# subshell — puts one immediately before the verb, and without them the region survived masking and
# still matched nothing. Quoted payloads are masked before this runs, so this cannot resurrect the
# false positive it sits beside.
# ONE spelling of git's value-taking global options. Four hand-kept copies of this list existed
# (GITPFX, the head finder's case, the alias-substitution prefix, the verb latch), and the copies
# are how GITPFX went stale at (-C|-c) while the rest had moved on — every reader below derives
# from GIT_VALUE_GLOBALS or asks git_global_takes_value(), which is built from it. The variable
# itself is DEFINED in lib/command-scan.sh (sourced above): the library's own reader
# (hook_git_c_path) needs the same list, and a copy here was the fifth hand-kept spelling.
# (#1666 review)
# EVERY value-taking global, in both spellings (`--git-dir .git` and `--git-dir=.git`) — the
# (-C|-c)-only tolerance made `git --git-dir=.git commit` invisible to every action regex built on
# this prefix, aliased or typed out, and the alias substitution (#1666 review) made that gap
# reachable in one visible command. Each iteration consumes the option AND its value, as exactly
# one of the two spellings — the earlier optional trailing token could swallow the word AFTER a
# `=`-glued global (the alias, or the verb), which misread a subcommand's own `-C` as the global
# directory switch. A global git will not accept without a value (bare `--exec-path` prints and
# exits) is not a command prefix, so demanding the value is the accurate reading. (#1666 review)
#
# A VALUE-LESS boolean global (`--no-pager`, `--bare`, `--paginate`/`-p`, `--literal-pathspecs`)
# between `git` and the verb is tolerated too — a bare `-\S+` alternative, the same catch-all the
# branch-NAME extraction regexes below already use. Without it `git --no-pager commit` matched no
# action regex and skipped the protected-branch check entirely, and the alias substitution made
# that reachable through an alias body as well. Value-globals stay matched WITH their value (the
# first alternative), so leftmost-longest consumes `--git-dir x` as one option+value rather than
# reading `x` as the verb; the verb itself is never `-\S+`, so it cannot be borrowed. (#1666 review)
GITPFX='(^|[;&|({"'"'"'`]|[[:space:]])[[:space:]]*(\S+=\S+\s+)*git\s+((('"$GIT_VALUE_GLOBALS"')(=\S+|\s+\S+)|-\S+)\s+)*'
# Trailing boundary: anything that is not a word character or `-`. `\b` alone let `git merge-base`
# read as a merge and `git commit-tree` as a commit — false positives that, now that the leading
# match is loose, would block ordinary read-only work on a protected branch. It also covers the verb
# ending a line (`git commit\ngit push`), which a bare `(\s|$)` misses.
GITEND='([^-[:alnum:]_]|$)'
# Tolerate flags between the subcommand and the create flag (e.g. `git checkout -q -b x`, which
# previously slipped past the create-guard entirely). `-B`/`-C` are the force-create spellings and
# create a branch just as much as `-b`/`-c` do.
#
# ONE expression per action, read by BOTH the detector below and the override check above it.
# Review of #1559 found the override carrying its own hand-written copies, forked in both
# directions at once: no trailing boundary, so `git merge-base` excused a real `git merge`; and no
# room for an intervening flag, so the documented `git checkout -q -b x` stopped registering. A
# second spelling of "what counts as this action" is a second answer waiting to disagree, and here
# it disagreed the moment it was written.
RE_COMMIT="${GITPFX}commit${GITEND}"
RE_PUSH="${GITPFX}push${GITEND}"
RE_MERGE="${GITPFX}merge${GITEND}"
# `git branch <name> [<start-point>]` creates a branch as truly as the two spellings above, and was
# not detected — so `git branch x main && git checkout x` reached neither the base check nor the name
# check, a branch cut from `main` and named outside the convention, in two commands the guard read as
# "not a creation" (INFRA-070). The rule said only two spellings, which is the shape that leaves a
# guard true on paper and reachable around in practice.
#
# The flag list is an ALLOWLIST, and that direction is the whole safety of it. `git branch` with no
# argument lists; `-a`, `-r`, `-v`, `--list`, `--merged`, `--contains`, `--show-current` list;
# `-d`/`-D` delete; `-m`/`-M` rename. Treating any of those as a creation would turn ordinary
# inspection into a refusal — property 4, the failure that gets a guard turned off. Only flags that
# still leave the command a creation are admitted, and the next token must not itself be a flag.
# ANY flag, by SHAPE — not a list of the ones we thought of. Third bypass in this one change, and
# each was the allowlist missing a spelling: `--track -c` (a flag it did not list), then
# `--track=direct` (the `=` form), then `-qf` (bundled shorts). A list of tokens cannot describe
# git's flag grammar, and every gap in it is a SILENT pass — the failure direction that costs the
# most, because nothing announces it.
#
# So the shape is matched instead, and the semantics are decided by a DENYLIST below. That inverts
# the failure: a flag nobody anticipated now reads as a creation and gets JUDGED, so a mistake here
# is a refusal someone sees and overrides, rather than a bypass nobody ever learns about. "Unknown
# is not zero" is this repository's rule for exactly this choice.
# `[^[:space:]]`, not `[^ \t]`. Inside a POSIX bracket expression `\t` is the two characters
# BACKSLASH and t, so `[^ \t]` excludes the letter t — and `--track=direct` stopped matching at
# `direc`, leaving the very bypass this line was written to close. Caught by probing the four
# reported shapes rather than by reading the regex.
RE_BRANCH_FLAG='(--[a-zA-Z][a-zA-Z0-9-]*(=[^[:space:]]*)?|-[a-zA-Z]+)'

# The flags that make `git branch` something OTHER than a creation. This is the denylist the shape
# matching above hands off to, and it is deliberately the only list left: a name missing from HERE
# produces a refusal on correct work — loud, overridable, and fixed the next day — while a name
# missing from an allowlist produced a silent bypass three times in this change alone.
#
# Two kinds, both taking a following argument that would otherwise read as a new branch name:
#   - operating on an EXISTING branch: -d -D --delete -m -M --move --edit-description
#     --set-upstream-to --unset-upstream -u
#   - LISTING with a value: --list --contains --no-contains --merged --no-merged --points-at
#     --sort --format --column
# Bundled, like the create side. `-[adDmMruv]` matched a single letter only, so `git branch -av
# feature/x` and `-rv origin/main` were read as creations and refused — the third time in this change
# that a matcher was written for one spelling of a flag while git accepts several. The create matcher
# and the copy matcher both take bundles; a denylist that does not is the same defect wearing the
# other direction, and its cost is a refusal on ordinary listing.
#
# The listing flags are HERE too, and the comment that used to say they need no entry was wrong in
# the way this file keeps being wrong: it asserted a property of git's grammar without reading it.
# `git branch [-r|-a] [--list] [<pattern>...]` takes a PATTERN, so `git branch -r origin/main` put a
# ref where a new branch's name goes and was refused — measured, on ordinary listing. A denylist that
# forgets an entry refuses correct work, which is the cost this direction accepts; paying it means
# adding the entry, not narrowing the direction.
RE_BRANCH_NOT_CREATE="${GITPFX}branch\s+(${RE_BRANCH_FLAG}\s+)*(-[a-zA-Z]*[adDmMruv][a-zA-Z]*|--all|--remotes|--verbose|--show-current|--delete|--move|--edit-description|--set-upstream-to|--unset-upstream|--list|--contains|--no-contains|--merged|--no-merged|--points-at|--sort|--format|--column)([= ]|\s|$)"
RE_BRANCH_CREATE_FLAGS="$RE_BRANCH_FLAG"
# `git branch -c|-C|--copy|--force-copy` creates a branch too, and is handled SEPARATELY because its
# arguments are in the other order: `-c <new>` names the branch in the first position, `-c <old>
# <new>` in the SECOND, with the base first. Every other spelling here puts the name first and the
# base second. Parsing both arities through the same positional extraction is a place to get a
# verdict silently backwards — judging the new branch's name against the source branch, or its base
# against itself — and this guard has twice shipped a parser defect that refused the creation of the
# branch its own fix lived on.
#
# So the copy forms are REFUSED rather than parsed. Copying a branch is not a spelling any workflow
# here prescribes (`git-branch.md` prescribes `git fetch origin && git checkout -b <type>/<slug>
# origin/develop`), the message says which form to use instead, and the same override that excuses a
# deliberate exception everywhere else excuses this one. A clear refusal on a form nobody uses beats
# a confident wrong answer on it.
#
# ONE spelling of the flag list, interpolated into both. Re-typing it here was the first version, and
# it re-created the fork this file's own header warns about — with the copy matcher admitting a
# SHORTER list than the creation matcher, `git branch --track -c old new` matched NEITHER: not a copy
# (its list lacked `--track`) and not a creation (that one requires the next token to be a non-flag,
# and `-c` is a flag). Detected as neither, it passed through the guard entirely. A second spelling of
# what counts as this action is a second answer waiting to disagree, and here it disagreed by opening
# the exact bypass this item exists to close, inside the fix for it.
# `-[a-zA-Z]*[cC][a-zA-Z]*`, not `-[cC]`. A short flag glued onto the copy — `-qc`, `-cq`, `-fc` —
# never reached this matcher, because `-[cC]${GITEND}` demands a boundary the next letter is not. The
# statement then fell through to the CREATION path, which reads a name and a base out of positions the
# copy forms reverse: measured, `git branch -qc a b` was refused, but for the wrong argument. A wrong
# answer given confidently is what refusing copies instead of parsing them exists to avoid.
#
# Only `c`/`C` mean copy among git-branch's short flags (`a r v d D m M f q t u l` are the rest), so a
# bundle containing one IS a copy. The long forms need no bundling: `--` flags do not glue.
RE_BRANCH_COPY="${GITPFX}branch\s+(${RE_BRANCH_CREATE_FLAGS}\s+)*(-[a-zA-Z]*[cC][a-zA-Z]*|--copy|--force-copy)${GITEND}"
# Each alternative carries its OWN ending. Hanging one `${GITEND}` off the whole group was the first
# attempt and it silently dropped the boundary from the two existing spellings — `-bogus` would have
# read as `-b`. The `branch` alternative ends by consuming the first character of the name, which is
# a boundary of its own kind; the other two still end on a non-word character.
RE_CREATE="${GITPFX}(checkout\s+(-\S+\s+)*-[bB]${GITEND}|switch\s+(-\S+\s+)*-[cC]${GITEND}|branch\s+(${RE_BRANCH_CREATE_FLAGS}\s+)*[^-[:space:]])"

RE_GH_API="(^|[;&|({\"'\`]|[[:space:]])[[:space:]]*gh[[:space:]]+api${GITEND}"

# Nothing is resolved here any more. An override belongs to a statement and is asked of that
# statement, at the point the statement's own action is judged. (INFRA-079, #1563)

# --- one judgement per STATEMENT ----------------------------------------------------------------
#
# A Bash tool call is a SEQUENCE of statements, and each guarded action — commit, push, merge,
# branch-create, remote-delete — belongs to exactly one of them. This file used to collapse that
# sequence twice: the detection booleans were computed over the WHOLE command, and NEW_BRANCH /
# START_POINT / DELETE_BRANCH_NAME were single values taken from the FIRST match anywhere, because
# `hook_match_extract` uses awk `match()`. One aggregate verdict then answered for N actions, so any
# action escaped judgement behind any sibling that was well-formed. Measured on a scratch
# repository, with a bare control refused correctly and NO override token in either command:
#
#   git checkout -b feat/y main                                     -> exit 2
#   git checkout -b feat/x develop ; git checkout -b feat/y main    -> exit 0   (wrong base unjudged)
#   git checkout -b BAD_NAME                                        -> exit 2
#   git checkout -b feat/ok ; git checkout -b BAD_NAME              -> exit 0   (bad name unjudged)
#
# `worktree-cwd-guard.sh` already had the right shape and says why: each repair to the OVERRIDE
# reading was correct and each left the next hole, "because the question was being asked about the
# wrong subject". So the subject is the statement, for every decision and not only for the override.
#
# The statements come from `hook_statement_ranges`, which finds separators in the MASK — a `;` inside
# a quoted argument or a heredoc body is data and splits nothing — and every reader below is given
# that statement's (START, LENGTH). The command is still masked WHOLE and only the READING is
# narrowed, so narrowing the question cannot change what counts as data.
#
# The ranges are read from a here-string, never from a PIPE: a `while` on the right of a pipe runs in
# a SUBSHELL, where the `exit 2` of a refusal would end the subshell and the hook would carry on and
# exit 0 — a refusal that refuses nothing. `worktree-cwd-guard.sh` records the same trap.
UNMERGED_CHECKED=false

# A command that decodes but yields NO statements is not a command with nothing to judge; it means
# the split did not run — awk missing, the program unparseable, the tokenizer aborting. Left
# unchecked the loop below simply would not execute and the hook would exit 0, which is the exact
# shape this directory keeps meeting: "I could not look" wearing the costume of "I looked and it was
# fine". Measured against origin/develop with awk hidden from PATH: `git push origin main` ON `main`
# left the guard at exit 127, which the hook protocol treats as NON-blocking, so the push was
# allowed. Every reachable command has at least one statement, so an empty list is a broken guard.
# ── INFRA-085: a git alias is the verb it expands to ────────────────────────────────────────────
# Every verb check below keys off the literal subcommand, and #1589 measured what that leaves open:
# with `alias.ci commit`, `git ci -n -m x` and `HUSKY=0 git ci -m x` both sailed past checks that
# ask "is the verb commit". An agent that has learned a flag is refused has an obvious next move,
# and `git config alias.ci commit` is refused by nothing.
#
# Resolved ONCE per invocation (the issue's own cost analysis: one subprocess per hook run, not per
# statement), from the SESSION's repository — aliases are per-repository state and the statement
# loop below re-resolves directories per statement, but an alias set differing between a session's
# own worktrees is not a real configuration. Read through the scrub like every other git question.
#
# STATED GAP: a shell alias (`!…`) is opaque here — its expansion is arbitrary shell, not a git
# verb, and classifying it would mean parsing shell inside git config. It stays invisible to the
# verb checks exactly as before this change.
GIT_ALIASES_SESSION=""
_ALIAS_DIR=$(hook_effective_repo session "" "$HOOK_CWD" "${CLAUDE_PROJECT_DIR:-}" 2>/dev/null || printf '')
if [[ -n "$_ALIAS_DIR" ]]; then
  GIT_ALIASES_SESSION=$(hook_git_in "$_ALIAS_DIR" config --get-regexp '^alias\.' 2>/dev/null | sed 's/^alias\.//' || true)
fi
# The statement loop swaps this per statement (a `git -C` statement reads that repo's aliases).
GIT_ALIASES="$GIT_ALIASES_SESSION"

# The expansion for one alias name, or failure. Shell (`!`) aliases fail — see the stated gap.
# STATED LIMIT: the value is word-split by IFS, not shell-tokenized, so a QUOTED argument inside
# an alias value (`commit -m "quick fix"`) yields pseudo-words carrying literal quote characters.
# A kill switch hidden inside such a value fails toward a wrong-shaped word that can over-match a
# flag test — a refusal someone sees — never toward a silent pass; telling them apart needs the
# shell-aware extraction filed as HARNESS-061.
git_alias_expansion() {
  local line name
  [[ -n "$GIT_ALIASES" ]] || return 1
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    name="${line%% *}"
    [[ "$name" == "$1" ]] || continue
    [[ "${line#* }" == "$line" ]] && return 1
    [[ "${line#* }" == '!'* ]] && return 1
    printf '%s' "${line#* }"
    return 0
  done <<< "$GIT_ALIASES"
  return 1
}

# ONE list of git's value-taking global options, asked as a question. It was hardcoded in three
# places (the head finder, the chain rebuild, the verb latch), and three copies of one fact is the
# defect this file keeps writing down about itself. (#1666 review)
git_global_takes_value() {
  [[ "$1" =~ ^(${GIT_VALUE_GLOBALS})$ ]]
}

# ONE list of `git commit`'s value-taking LONG options — the words after which the next token is a
# message/file/template, not a flag. The statement latch and the alias-expansion latch both need
# it, and two hand-kept copies had already forked (the alias copy gained `--template`, the
# statement copy had not) — the exact "second spelling waiting to disagree" this file keeps
# fixing. Asked through commit_opt_takes_value(): a `|` from a variable is NOT `case` alternation
# (only a literal source `|` is), so this must be a regex test, like git_global_takes_value.
# (#1666 review)
COMMIT_VALUE_LONG_OPTS='--message|--file|--reuse-message|--reedit-message|--template'
commit_opt_takes_value() {
  [[ "$1" =~ ^(${COMMIT_VALUE_LONG_OPTS})$ ]]
}

# ONE reading of a `git commit` SHORT-flag cluster, shared by both latches so the kill-switch
# letters cannot be updated in only one copy. Prints two words: whether `-n` (no-verify) appears
# BEFORE any value-taking letter, and whether the cluster's LAST letter takes a value (so the next
# token is that value, not a flag). The caller applies the `-n` result only for a commit. (#1666)
commit_cluster_flags() {
  local cluster="${1#-}" kill=false value=false
  while [[ -n "$cluster" ]]; do
    case "${cluster:0:1}" in
      n) kill=true; break ;;
      m | F | C | c) break ;;
    esac
    cluster="${cluster:1}"
  done
  case "$1" in *[mFCc]) value=true ;; esac
  printf '%s %s' "$kill" "$value"
}

# The head of an expansion: the word the next hop resolves, found the way the verb latch finds a
# verb — a value-taking global consumes its value, any other flag is skipped, the first remaining
# word is the head. Reading the LITERAL first word reproduced, inside the alias, the exact bug the
# latch already fixed at the top level: `-c commit.gpgsign=false commit` read as verb `-c`, and
# every check keyed on `commit` went silent. (#1666 review)
git_expansion_head() {
  local w expect=false
  # Word-splitting WITHOUT pathname expansion: git tokenizes alias values itself and never globs,
  # so a value containing `*`/`?`/`[` (a push-all refspec, a pathspec) must not be replaced by
  # whatever files happen to sit in the CWD. This function runs in a command-substitution
  # subshell, so the flag change stays local. (#1666 review)
  set -f
  for w in $1; do
    if [[ "$expect" == "true" ]]; then expect=false; continue; fi
    if git_global_takes_value "$w"; then
      expect=true
      continue
    fi
    case "$w" in
      -*) continue ;;
    esac
    # The same defense the statement latch carries: the global list cannot be complete (git
    # gains flags), and a token shaped like a path or dotted value is the VALUE of an option
    # this list has not heard of, not a subcommand. (#1666 review)
    case "$w" in
      */* | .* | *.*) continue ;;
    esac
    printf '%s' "$w"
    return 0
  done
  return 1
}

# The FULL expansion of an alias chain, flattened, bounded at 10 hops. `alias.a1 ci` on top of
# `alias.ci commit` is a commit as truly as its tail is, and single-level reading left the head
# entirely unclassified — no refusal, no message. Each hop replaces the expansion's head word with
# what it resolves to, keeping the flags on either side; the bound is a cycle guard.
#
# Exit codes: 0 with the flattened text (chain resolved to a real verb, or no head to resolve);
# 1 if `$1` is not an alias at all; 2 if the chain did NOT terminate within the bound — the head
# is STILL an alias after 10 hops. Handing that half-flattened head back would set GIT_VERB to an
# alias name matching none of commit|push|rm|mv, so every gated check silently never fires: an
# 11-deep chain topped with `commit -n` would pass where the literal is blocked. The bound is a
# cycle guard, not a licence to bypass, so non-termination refuses — the file's fail-direction
# (an unresolved shape is judged, never waved through). (#1666 review)
git_alias_expansion_chain() {
  local exp next head depth=0 rest pre w expect
  exp=$(git_alias_expansion "$1") || return 1
  while (( depth++ < 10 )); do
    head=$(git_expansion_head "$exp") || break
    next=$(git_alias_expansion "$head") || break
    # Rebuild: everything before the head, the hop's expansion, everything after.
    pre=""; rest=""; expect=false
    local seen=false
    # set -f for the same reason as git_expansion_head — subshell-local, git never globs these.
    set -f
    for w in $exp; do
      if [[ "$seen" == "true" ]]; then rest="${rest}${rest:+ }${w}"; continue; fi
      if [[ "$w" == "$head" && "$expect" != "true" ]]; then seen=true; continue; fi
      if [[ "$expect" == "true" ]]; then
        expect=false
      elif git_global_takes_value "$w"; then
        expect=true
      fi
      pre="${pre}${pre:+ }${w}"
    done
    exp="${pre}${pre:+ }${next}${rest:+ }${rest}"
  done
  # Did the chain actually terminate? A head that STILL resolves to an alias means the bound cut
  # the flattening short, and the caller must refuse rather than judge the alias name as a verb.
  # `if` not `&&`: under `set -e` a bare `cmd && return` aborts the hook the moment cmd fails
  # (the common no-longer-an-alias case), exiting 1 with nothing said. (#1666 review)
  head=$(git_expansion_head "$exp") || { printf '%s' "$exp"; return 0; }
  if git_alias_expansion "$head" >/dev/null 2>&1; then
    return 2
  fi
  printf '%s' "$exp"
}

# Refuse a command whose alias chain did not resolve within the hop bound. Shared by both
# consumers so the message and the exit are identical. (#1666 review)
refuse_unresolved_alias_chain() {
  echo "[branch-guard] Blocked: the alias chain for '$1' does not resolve within 10 hops." >&2
  echo "[branch-guard] An unresolved chain hides the real verb from every check — refusing rather" >&2
  echo "[branch-guard] than judging an alias name as a git subcommand. Flatten the aliases, or run" >&2
  echo "[branch-guard] the underlying git command directly." >&2
  exit 2
}

STATEMENT_RANGES=$(hook_statement_ranges "$COMMAND" || printf '')
if [[ -z "${STATEMENT_RANGES//[[:space:]]/}" ]]; then
  echo "[branch-guard] Blocked: the command could not be split into statements, so nothing in it" >&2
  echo "[branch-guard] was judged. Nothing was verified; this is not a pass." >&2
  exit 2
fi

while read -r STMT_START STMT_LEN; do
  STMT_MASK=$(hook_verb_scan "$COMMAND" "$STMT_START" "$STMT_LEN")

  # INFRA-085: the statement is judged AS IF the alias were typed out. The expansion is
  # substituted into the MASK, so every existing check — the action regexes, the not-create and
  # copy corrections, the branch-NAME and base extraction — reads the real verb TOGETHER with the
  # call-site flags. Classifying aliases into per-action name lists could not do that: a create
  # flag typed at the call site (`git co -b x` over `alias.co checkout`) matched no list, and the
  # copy forms had no list at all — both "matched neither, passed through the guard entirely",
  # the failure this file names as the worst one. (#1666 review)
  # The RAW slice gets the same substitution: the branch-NAME and start-point extractions read
  # original text (a masked read returns fill for a quoted name), and their patterns name the
  # literal verbs — over `git co -b x` they matched nothing, so an aliased creation was detected
  # and then never judged.
  # Ranges are 1-based (awk substr); bash slicing is 0-based.
  STMT_RAW_EFFECTIVE="${COMMAND:$((STMT_START - 1)):$STMT_LEN}"
  # Aliases resolve where the STATEMENT runs: a statement carrying `git -C <path>` reads that
  # repository's config, exactly as the branch it is judged on does — the session repo's alias
  # set judged another checkout's names, and missed the local ones. Extracted here (the branch
  # resolution below re-extracts for its own comment trail) so the substitution and the verb
  # latch both read the right set. (#1666 review)
  GIT_C_PATH=$(hook_git_c_path "$COMMAND" "$STMT_START" "$STMT_LEN" || true)
  GIT_ALIASES="$GIT_ALIASES_SESSION"
  if [[ -n "$GIT_C_PATH" ]]; then
    GIT_ALIASES=$(hook_git_in "$GIT_C_PATH" config --get-regexp '^alias\.' 2>/dev/null | sed 's/^alias\.//' || true)
  fi
  # INLINE aliases: `git -c alias.NAME=EXPANSION … NAME` defines and uses an alias in ONE
  # invocation, with no config-file trace at all — so `--get-regexp` never saw it. The verb latch
  # consumed `-c <pair>` as -c's value, looked NAME up in the persisted set, found nothing, and
  # left GIT_VERB the alias NAME — matching no gated verb, so every check went silent. Register
  # each inline definition into GIT_ALIASES so the statement is judged as if NAME were configured.
  # The value is read from words-mode, so an unquoted single-word expansion (the natural bypass
  # `git -c alias.ci=commit ci -n`) is covered; a quoted multi-word value is masked (stated limit,
  # like the newline-alias case above). (#1666 review)
  if _INLINE_WORDS=$(hook_statement_words "$COMMAND" "$STMT_START" "$STMT_LEN" 2>/dev/null); then
    _expect_c_pair=false
    while IFS= read -r _iw; do
      if [[ "$_expect_c_pair" == "true" ]]; then
        _expect_c_pair=false
        if [[ "$_iw" == alias.*=* ]]; then
          _ia_body="${_iw#alias.}"
          _ia_name="${_ia_body%%=*}"
          _ia_exp="${_ia_body#*=}"
          if [[ "$_ia_name" =~ ^[A-Za-z0-9_-]+$ && -n "$_ia_exp" ]]; then
            GIT_ALIASES="${_ia_name} ${_ia_exp}"$'\n'"${GIT_ALIASES}"
          fi
        fi
      elif [[ "$_iw" == "-c" ]]; then
        _expect_c_pair=true
      fi
    done <<< "$_INLINE_WORDS"
  fi
  # STATED LIMIT: an alias whose VALUE contains a literal newline (a `\n` escape in the config
  # file) prints across several lines, and `--get-regexp`'s continuation lines carry no
  # `alias.<name>` prefix — read line-by-line here, a continuation is skipped as a name mismatch
  # and the expansion is truncated to its first line. Vanishingly rare, and it fails toward safety:
  # a truncated expansion whose head stays an alias now hits the chain-refuse path. (#1666 review)
  if [[ -n "$GIT_ALIASES" ]]; then
    while IFS= read -r _alias_line; do
      [[ -z "$_alias_line" ]] && continue
      _an="${_alias_line%% *}"
      [[ "$_an" =~ ^[A-Za-z0-9_-]+$ ]] || continue
      # A cheap containment test before the anchored grep: with a large global alias set this
      # loop runs per configured alias per statement, and most names appear nowhere. (#1666)
      [[ "$STMT_MASK" == *"$_an"* ]] || continue
      # EVERY value-taking global may stand between `git` and the alias, in either spelling
      # (`--git-dir .git` or `--git-dir=.git`) — the (-C|-c)-only prefix left `git --git-dir=.git
      # ci` unsubstituted, so the statement matched no action regex and took no check at all,
      # the exact class this substitution exists to end. One prefix expression, used by the gate
      # and both substitutions. (#1666 review)
      _GOPT="(((${GIT_VALUE_GLOBALS})(=[^[:space:]]+|[[:space:]]+[^[:space:]]+)|-[^[:space:]]+)[[:space:]]+)"
      printf '%s' "$STMT_MASK" | grep -qE "(^|[;&|({\"'\`]|[[:space:]])git[[:space:]]+${_GOPT}*${_an}([^-[:alnum:]_]|$)" || continue
      # `if var=$(cmd)` not `var=$(cmd); rc=$?`: under set -e a plain assignment from a command
      # substitution that exits non-zero ABORTS the hook before $? is ever read (line 496's
      # warning). The if-form captures both the output and the code. (#1666 review)
      if _aexp=$(git_alias_expansion_chain "$_an"); then _aexp_rc=0; else _aexp_rc=$?; fi
      if [[ "$_aexp_rc" -eq 2 ]]; then refuse_unresolved_alias_chain "$_an"; fi
      if [[ "$_aexp_rc" -ne 0 ]]; then continue; fi
      # Both texts are rewritten at offsets found on the MASK, never re-matched on raw text.
      # Quoted regions are fill in the mask, so an alias name inside an ordinary string
      # (`git ci -m "see git ci in the docs"`) cannot match there — but a second, independent
      # `sed …/g` over the raw slice matched exactly that, rewrote the message, and handed the
      # extractions below corrupted text: the unmasked-message bug class (#1572/#1588) rebuilt
      # for the raw-effective path. The mask is byte-aligned with the raw slice (fill is 1:1),
      # so a mask offset IS a raw offset; splicing plain strings also retires the sed-escaping
      # of the config-controlled expansion. Two calls, one deterministic match sequence — the
      # mask drives both. (#1666 review)
      _alias_splice() {
        SRC="$1" M="$STMT_MASK" AN="$_an" EXPN="$_aexp" \
          RE="(^|[;&|({\"'\`]|[[:space:]])git[[:space:]]+${_GOPT}*${_an}([^-[:alnum:]_]|$)" awk '
          BEGIN {
            mask = ENVIRON["M"]; src = ENVIRON["SRC"]; re = ENVIRON["RE"]
            an = ENVIRON["AN"]; expn = ENVIRON["EXPN"]
            if (length(mask) != length(src)) { printf "%s", src; exit }
            out = ""
            while (match(mask, re)) {
              m = substr(mask, RSTART, RLENGTH)
              b = (substr(m, length(m)) ~ /[[:alnum:]_-]/) ? 0 : 1
              apos = RSTART + RLENGTH - length(an) - b
              if (substr(mask, apos, length(an)) != an) { break }
              out = out substr(src, 1, apos - 1) expn
              mask = substr(mask, apos + length(an))
              src = substr(src, apos + length(an))
            }
            printf "%s%s", out, src
          }'
      }
      _new_raw=$(_alias_splice "$STMT_RAW_EFFECTIVE")
      STMT_MASK=$(_alias_splice "$STMT_MASK")
      STMT_RAW_EFFECTIVE="$_new_raw"
    done <<< "$GIT_ALIASES"
  fi

  # The source and window every per-statement EXTRACTION reads (NEW_BRANCH, START_POINT,
  # DELETE_BRANCH_NAME). When an alias resolved, the verb exists only in the substituted slice, so
  # that slice is read at 1-based offsets. When NOTHING was substituted, the extraction reads the
  # WHOLE command at this statement's offsets — the tokenizer needs the surrounding text to tell a
  # heredoc body or a quoted argument from a live command, and a `git checkout -b`/`git branch`/
  # `git push --delete` sitting inside a heredoc body would otherwise be read as a real one from
  # the bare slice. One decision, shared by all three extractions rather than repeated (and
  # divergently) at each. (#1666 review)
  if [[ "$STMT_RAW_EFFECTIVE" != "${COMMAND:$((STMT_START - 1)):$STMT_LEN}" ]]; then
    EXTRACT_SRC="$STMT_RAW_EFFECTIVE"; EXTRACT_START=1; EXTRACT_LEN="${#STMT_RAW_EFFECTIVE}"
  else
    EXTRACT_SRC="$COMMAND"; EXTRACT_START="$STMT_START"; EXTRACT_LEN="$STMT_LEN"
  fi

  # Resolve the git context THIS STATEMENT will actually run in (worktree-aware — parallel-wave
  # lesson): a worktree agent's commit/push was judged against the MAIN clone's branch
  # (CLAUDE_PROJECT_DIR), producing false blocks. Precedence: `git -C <path>` in the statement >
  # hook-input `cwd` > project dir.
  #
  # Per STATEMENT, because `-C` belongs to the invocation that carries it. Taken from the first match
  # anywhere in the command, `git -C /elsewhere status && git commit` judged /elsewhere's branch and
  # decided the commit — the same first-match-anywhere defect as NEW_BRANCH and DELETE_BRANCH_NAME,
  # one variable to the left. (INFRA-079, #1563)
  # Unanchored: `git -C <path>` is almost never the first thing on the line (`cd /elsewhere && git -C
  # <repo> commit`). The `^`-anchored version simply never found it, so the hook fired and then judged
  # whichever checkout it happened to sit in — passing a commit it should have refused.
  # `|| true` is load-bearing: grep exits 1 when the command has no `-C`, which is the common case, and
  # under `set -euo pipefail` a failed command substitution ABORTS the hook — silently, exit 1, before
  # a single check runs. That is a total bypass wearing the costume of a passing guard.
  # One extractor, matched against a masked command so a quoted mention of `git -C` cannot
  # redirect this guard at another repository. See lib/command-scan.sh.
  # GIT_C_PATH was already read for this statement above (the alias-source resolution); the
  # inputs cannot have changed between there and here, and a second subprocess would only be a
  # second reading to drift. (#1666 review)
  # One resolution, four callers, three NAMED modes — see lib/hook-facts.sh. This caller takes
  # `validated`: it must name SOME repository, because its verdict is about the branch that
  # repository is on. The mode is named rather than inlined so the two DELIBERATE divergences beside
  # it (worktree-cwd-guard's first-nonempty fail-safe, and this hook's own `session` base check) stay
  # decisions with a reason instead of four copies that drift apart.
  EFFECTIVE_DIR=$(hook_effective_repo validated "$GIT_C_PATH" "$HOOK_CWD" "${CLAUDE_PROJECT_DIR:-}")

  # Detect git action type
  IS_COMMIT=false
  IS_PUSH=false
  IS_MERGE=false
  IS_BRANCH_CREATE=false
  IS_BRANCH_COPY=false
  IS_GH_DELETE_BRANCH=false
  # GITPFX tolerates global git flags before the subcommand — `git -C <path> commit`, `git -c k=v push` —
  # which previously slipped past every action regex (worktree-blindness, parallel-wave lesson).
  #
  # It matches at any STATEMENT boundary, not only at the start of the command. The `^`-anchored
  # version fired only when the WHOLE command began with the verb — and a branch is created as
  # `cd <repo> && git checkout -b …`, a commit made after a `cd`, a merge on a later line of a block.
  # Measured 2026-07-28 against a scratch repository on `main`: commit, push, merge, `checkout -b` and
  # `switch -c` were ALL bypassed in 4 of the 5 shapes commands are actually written in here. The
  # branch-create guard had therefore never fired on a real branch creation. Same defect #1510 removed
  # from pre-push-check; it lived here in a variable and was reused for every action. A guard no real
  # invocation reaches is indistinguishable from no guard.
  #
  # Boundaries are line start, `;`, `&&`, `||`, `|`, `(`, whitespace and a quote. A newline is one too:
  # the command is decoded as JSON now and carries REAL newlines, so grep's `^` is a line start (a
  # multi-line block
  # keeps its escapes — and that is the shape that slipped through).
  # A heredoc BODY is data, not commands. `git commit -F - <<'EOF' … EOF` carries prose that may
  # quote a git invocation — this hook blocked a commit whose MESSAGE contained
  # "branches are made as `cd <repo> && git checkout -b …`", reading the sentence as the act it
  # describes. Verb detection therefore runs over the command with heredoc bodies removed.
  #
  # Deliberately narrow: it strips only `<<MARKER … MARKER`, whose boundaries are unambiguous. A verb
  # inside an ordinary quoted argument (`-m 'run git checkout -b x'`) still matches, because telling
  # quoting apart needs the shell-aware extraction filed as HARNESS-061, not a longer regex here.

  printf '%s' "$STMT_MASK" | grep -qE "$RE_COMMIT" && IS_COMMIT=true
  printf '%s' "$STMT_MASK" | grep -qE "$RE_PUSH" && IS_PUSH=true
  printf '%s' "$STMT_MASK" | grep -qE "$RE_MERGE" && IS_MERGE=true
  printf '%s' "$STMT_MASK" | grep -qE "$RE_CREATE" && IS_BRANCH_CREATE=true
  printf '%s' "$STMT_MASK" | grep -qE "$RE_BRANCH_COPY" && IS_BRANCH_COPY=true
  # …unless the statement is one of the `git branch` forms that operate on an existing branch or
  # list with a value. Their argument sits exactly where a new branch's name would, so the shape
  # matching above reads `git branch -d old` as creating `old` and `--contains HEAD` as creating
  # `HEAD`. Both were measured refusing correct work before this line existed.
  if printf '%s' "$STMT_MASK" | grep -qE "$RE_BRANCH_NOT_CREATE"; then
    IS_BRANCH_CREATE=false
    IS_BRANCH_COPY=false
  fi
  # A copy is NEVER also judged as a creation, and this holds even when the copy refusal is
  # overridden. `-c` is flag-shaped, so `git branch -c a b` looks like a creation of `a` from `b` —
  # with the arguments the wrong way round, which is the entire reason copies are refused instead of
  # parsed. Taking the deliberate exception must not silently hand the statement to the parser it was
  # exempted from: measured, `BRANCH_GUARD_ALLOW_BRANCH_COPY=1 git branch -c a b` was then refused by
  # the creation path, for a name and a base read out of the wrong positions.
  if [[ "$IS_BRANCH_COPY" == "true" ]]; then
    IS_BRANCH_CREATE=false
  fi
  # `gh pr merge --delete-branch` is banned (git-branch.md): it once deleted the
  # develop integration branch. Match ONLY when --delete-branch is an actual argument
  # of a `gh pr merge` invocation — strip shell comments first, then require the flag
  # to sit in the same command segment as `gh pr merge` (no intervening ; | &). This
  # avoids false positives from the flag mentioned in a comment or a separate echo.
  # Delete detection reads the MASKED command, like every other verb check. It was the last pair
  # still scanning quoted text, so a commit message naming `--delete-branch` refused the commit.
  COMMAND_NO_COMMENTS="$STMT_MASK"
  if printf '%s' "$COMMAND_NO_COMMENTS" | grep -qE 'gh[[:space:]]+pr[[:space:]]+merge\b[^|;&]*--delete-branch'; then
    IS_GH_DELETE_BRANCH=true
  fi

  # --- A gate is not skipped by asking git to skip it (INFRA-083) -------------------------------
  #
  # `--no-verify` disables the git-level hook, which means the pre-push hook cannot catch its own
  # bypass — by the time it would run, it has already been skipped. This layer runs on the TOOL CALL
  # and is the one place the flag cannot reach.
  #
  # Measured 2026-08-01: four parallel agents pushed with `--no-verify` in a single day. The cause
  # was real and was fixed (HARNESS-058 — the gate could not go green in a worktree), and the agents
  # were then TOLD not to bypass, which worked and is not a mechanism. A rule stated and never
  # mechanically reached is this repository's signature defect; `git-branch.md` had said the same
  # about a bare `git stash pop` since LESSON-005 and an agent did it anyway ten weeks later.
  #
  # ZERO EXCEPTIONS, matching the `--delete-branch` ban below. An override for an override is simply
  # the next bypass. If a gate is wrong, the gate is what changes — that is the whole of HARNESS-058.
  #
  # WHAT BASH WOULD SEE — asked of the tokenizer, not reconstructed here.
  #
  # This block previously did its own parsing with sed and grep, and every round of review found a
  # different way that was wrong: `awk -v` unescaped a backslash into a vertical tab; a blind
  # splice-removal desynchronised the quoting and hid a live flag behind an unterminated string; a
  # greedy match anchored on a nested verb and discarded the flags in front of it; an option skipper
  # swallowed `-x` as a flag. Each was a SECOND reading of a command, written beside the one that
  # models the shell grammar and is checked against real bash on a 200-shape corpus.
  #
  # So the question goes to that reading. `hook_statement_words` returns the WORDS the shell builds
  # for this statement: splices collapsed (`--no-''verify` and `--no-\verify` are one word, as bash
  # sees them), quoted content hidden (a commit message that NAMES a flag is not passing one),
  # substitution contents excluded (they are their own statement, judged as one).
  # FAIL-CLOSED ON THE TOKENIZER FAILING, not on it answering "no words". The first spelling of this
  # check treated an empty list as a failure, and that is wrong: a statement can legitimately build no
  # words a matcher should see — a bare `}` closing a function, a statement that is only a quoted
  # string. Measured immediately, it refused nearly every command typed in this repo. The error signal
  # is awk's exit status; emptiness is an ANSWER. (#1588)
  #
  # The SENTINEL is what keeps a trailing empty word: command substitution strips trailing newlines,
  # so a final fully-quoted argument — which builds a real but empty word — simply vanished, and
  # `git config core.hooksPath ""` read as a key with no value and was permitted. `&& printf` also
  # carries the failure: if the tokenizer exits non-zero the sentinel is never written and the `if`
  # below fires. Exactly one newline plus the sentinel is removed, so the here-string re-adds exactly
  # the one that was there. (#1588 review)
  if ! STMT_WORDS=$(hook_statement_words "$COMMAND" "$STMT_START" "$STMT_LEN" && printf '\001'); then
    echo "[branch-guard] Blocked: the statement could not be split into words, so its options were" >&2
    echo "[branch-guard] never read. Nothing was verified; this is not a pass." >&2
    exit 2
  fi
  STMT_WORDS=${STMT_WORDS%$'\n\001'}

  # The verb, and the options that belong to THIS invocation. A value-taking option consumes the
  # next word, which is what keeps `git commit -mn "x"` — a message of "n" — from reading as the
  # short skip-hooks flag, and `-m "--no-verify"` from reading as the long one.
  IS_GATED_STMT=false
  # An expansion this hook cannot resolve, sitting where the COMMAND or the SUBCOMMAND goes, makes
  # the statement's identity unknown — and `g${UNSET}it commit`, `$GIT commit` and
  # `git c${UNSET}ommit` are all real gated actions to bash. Measured on develop: each walked past
  # the protected-branch check with exit 0, the same evasion class as the alias bypass INFRA-085
  # closed. Tracked here and judged after the walk, where the gated-verb evidence is complete.
  # (HARNESS-084, #1682)
  CMD_UNRESOLVED=false
  VERB_UNRESOLVED=false
  SAW_CMD_WORD=false
  SAW_GATED_WORD=false
  GIT_VERB=""
  SKIP_HOOKS=false
  SKIP_WHAT=""
  EXPECT_VALUE=false
  SEEN_GIT=false
  HAS_HUSKY0=false
  SAW_HOOKSPATH_KEY=false
  while IFS= read -r W; do
    # An `assignment=` is judged BEFORE the value-skip, because the one that matters travels AS a
    # value: `git -c core.hooksPath=/dev/null commit` hands it to `-c`, and skipping the consumed
    # word walked the whole config route straight through the check written to close it. (#1588)
    case "$W" in
      *core.hooksPath*=*) SKIP_HOOKS=true; SKIP_WHAT="core.hooksPath" ;;
    esac
    # An EMPTY word is still a word — a fully-quoted argument builds one. It has to consume a pending
    # value, or the option is left hungry and eats the NEXT real word instead: `-m "$(date)" -n` fed
    # `-n` to `-m` and the skip-hooks flag behind it was never read. (#1588)
    if [[ "$EXPECT_VALUE" == "true" ]]; then EXPECT_VALUE=false; continue; fi
    # `git config core.hooksPath <path>` sets it with no `=` anywhere, so the assignment check above
    # cannot see it. What disables the gate is the ASSIGNMENT, and the first spelling refused the mere
    # appearance of the key — so `git config --get core.hooksPath` and `git grep core.hooksPath` were
    # refused as bypasses, and `git config --unset core.hooksPath`, which RESTORES the default hooks,
    # was refused as a way of removing them. A guard that fires on correct work is one people learn to
    # route around; that is the argument this whole change is built on, and it was being lost a few
    # lines below where it is made. (#1588 review)
    #
    # The key is remembered, and only a following POSITIONAL — the value — disables anything. An
    # option cannot be one, and `--get`/`--unset` sit ahead of the key rather than after it. Judged
    # BEFORE the empty-word skip, because `git config core.hooksPath ""` sets it to an empty string
    # and a fully-quoted argument builds an empty word.
    if [[ "$GIT_VERB" == "config" ]]; then
      if [[ -n "$W" && "$W" == *core.hooksPath* ]]; then
        SAW_HOOKSPATH_KEY=true
      elif [[ "$SAW_HOOKSPATH_KEY" == "true" && "$W" != -* ]]; then
        SKIP_HOOKS=true
        SKIP_WHAT="core.hooksPath"
      fi
    fi
    # An EMPTY word at the COMMAND position is a whole command substitution: words-mode collapses
    # `$(echo git)` to nothing, so the command is unknown. Judged BEFORE the empty-word filter below,
    # or the substitution is dropped and the NEXT word — `commit` in `$(echo git) commit -m x` — is
    # mistaken for the command, which reads clean and lets the statement through. (#1683 review)
    if [[ "$SEEN_GIT" == "false" && "$SAW_CMD_WORD" == "false" && -z "$W" ]]; then
      SAW_CMD_WORD=true
      CMD_UNRESOLVED=true
    fi
    [[ -n "$W" ]] || continue
    # Recorded, not acted on yet: `HUSKY=0 pnpm install` is ordinary work in a fresh clone. The
    # variable only disables a GATE when the statement it prefixes is the gated one, which is not
    # known until the verb is read. (#1588 review)
    case "$W" in
      HUSKY=0) [[ "$SEEN_GIT" == "false" ]] && HAS_HUSKY0=true ;;
    esac
    # Any word that spells a gated subcommand, wherever it sits — the evidence that an unresolvable
    # command position could be hiding a gated action rather than an editor. (HARNESS-084)
    case "$W" in
      commit | push | merge | rm | mv | config | checkout | switch | branch) SAW_GATED_WORD=true ;;
    esac
    if [[ "$SEEN_GIT" == "false" ]]; then
      # The COMMAND position: the first word that is not an env-var prefix. If it carries an
      # expansion this hook cannot resolve, the command is unknown — `$GIT` and `g${UNSET}it` are
      # `git` when the variable says so. Only the first such word is the command; a `$HOME` in a
      # later ARGUMENT changes nothing about which command runs. (HARNESS-084)
      if [[ "$SAW_CMD_WORD" == "false" ]]; then
        case "$W" in
          *=*) : ;;
          *)
            SAW_CMD_WORD=true
            case "$W" in
              *'$'* | *'`'*) CMD_UNRESOLVED=true ;;
            esac
            ;;
        esac
      fi
      [[ "$W" == "git" ]] && SEEN_GIT=true
      continue
    fi
    if [[ -z "$GIT_VERB" ]]; then
      # A GLOBAL option that takes its value as the NEXT word must consume it, or that value is read
      # as the subcommand. Measured: `git --work-tree /x commit -n -m y` set the verb to `/x`, which
      # silenced both the `-n` check and the HUSKY=0 check — they ask whether the verb is `commit`.
      # Only `-c`/`-C` were consumed before. (#1588 review)
      if git_global_takes_value "$W"; then
        EXPECT_VALUE=true
        continue
      fi
      case "$W" in
        -*) continue ;;
      esac
      # A verb is a git subcommand, and the option list above cannot be complete — git gains flags.
      # A word carrying a path separator or a dot is the VALUE of some option this list has not heard
      # of yet, not a subcommand, so it is skipped rather than latched as the verb. Getting this wrong
      # in the permissive direction is what the finding above measured.
      case "$W" in
        */*|.*|*.*) continue ;;
      esac
      # The VERB position, reached: `git` is established and this word is the subcommand. An
      # expansion here leaves the action unknown — `git c${UNSET}ommit` is a commit. Recorded rather
      # than refused inline, so the walk still finishes and the message below can name the whole
      # statement's evidence. (HARNESS-084)
      case "$W" in
        *'$'* | *'`'*) VERB_UNRESOLVED=true ;;
      esac
      # INFRA-085: the word about to become the verb may be an alias, and the checks below ask
      # about the verb it EXPANDS to. The expansion's own flags count too — `alias.ci "commit -n"`
      # carries the kill switch inside the alias, where no statement word will ever show it.
      # if-form for the same set -e reason as the mask-splice call above. (#1666 review)
      if _ALIAS_EXP=$(git_alias_expansion_chain "$W"); then _alias_rc=0; else _alias_rc=$?; fi
      if [[ "$_alias_rc" -eq 2 ]]; then refuse_unresolved_alias_chain "$W"; fi
      if [[ "$_alias_rc" -eq 0 ]]; then
        # The verb is the expansion's HEAD — global options and their values skipped — not its
        # literal first word: `-c commit.gpgsign=false commit` is a commit, and reading `-c` as
        # the verb silenced every check keyed on `commit`. A GLOBALS-ONLY expansion has no head:
        # falling back to its first word latched `-c` as the verb, and the loop then never read
        # the REAL verb typed after the alias — so `git q commit -n` (alias.q a config pair)
        # carried its kill switch past every check keyed on `commit`. No head means the verb is
        # still unknown and the walk keeps looking. (#1666 review)
        if ! GIT_VERB=$(git_expansion_head "$_ALIAS_EXP"); then
          GIT_VERB=""
        fi
        _PAST_VERB=false
        _AX_EXPECT=false
        # This loop runs in the MAIN shell: disable pathname expansion for the split and restore
        # after — a glob in the alias value must not be replaced by CWD filenames, least of all
        # here, where the words decide SKIP_HOOKS and the verb. (#1666 review)
        set -f
        for _AXW in $_ALIAS_EXP; do
          # A word a preceding option announced is that option's VALUE, not a flag — the same
          # skip the statement loop applies, or `alias.ci "commit -m -n"` reads its message text
          # as the kill switch and refuses ordinary work. Consumed BEFORE the verb comparison:
          # a global's value that happens to spell the verb (`-C commit`) must not latch
          # _PAST_VERB a token early. (#1666 review, both rounds)
          if [[ "$_AX_EXPECT" == "true" ]]; then
            _AX_EXPECT=false
            continue
          fi
          if [[ "$_PAST_VERB" != "true" ]]; then
            [[ "$_AXW" == "$GIT_VERB" ]] && _PAST_VERB=true
          fi
          if git_global_takes_value "$_AXW" && [[ "$_PAST_VERB" != "true" ]]; then
            _AX_EXPECT=true
            continue
          fi
          # Past the verb, a long option that TAKES a value consumes the next word — the same
          # rule the statement latch applies at its `--message|--file|…) EXPECT_VALUE=true`.
          # Without it, `alias.ci "commit --reuse-message -n"` reads `-n` as the standalone kill
          # switch instead of as --reuse-message's value, over-refusing an alias body that never
          # passes -n to git. Fails toward refusal, but the class is the one INFRA-085 fixes.
          # (#1666 review)
          if [[ "$_PAST_VERB" == "true" ]] && commit_opt_takes_value "$_AXW"; then
            _AX_EXPECT=true
            continue
          fi
          [[ "$_AXW" == "--no-verify" ]] && SKIP_HOOKS=true && SKIP_WHAT="--no-verify (via alias $W)"
          [[ "$_AXW" == *core.hooksPath*=* ]] && SKIP_HOOKS=true && SKIP_WHAT="core.hooksPath (via alias $W)"
          # The SPACE form of the assignment, inside the expansion: `alias.dh "config
          # core.hooksPath /dev/null"`. The statement loop's two-word machine never sees these
          # words, so the machine runs here too — the key remembered, only a following
          # POSITIONAL (the value) disabling anything, and a key left dangling in the expansion
          # arms the statement-loop machine for a value typed after the alias. (#1666 review)
          if [[ "$GIT_VERB" == "config" && "$_PAST_VERB" == "true" ]]; then
            if [[ "$_AXW" == *core.hooksPath* && "$_AXW" != *=* ]]; then
              SAW_HOOKSPATH_KEY=true
            elif [[ "$SAW_HOOKSPATH_KEY" == "true" && "$_AXW" != -* && "$_AXW" != "config" ]]; then
              SKIP_HOOKS=true
              SKIP_WHAT="core.hooksPath (via alias $W)"
            fi
          fi
          if [[ "$_PAST_VERB" == "true" && "$_AXW" == -[!-]* && "$GIT_VERB" == "commit" ]]; then
            read -r _AX_KILL _AX_VALUE <<< "$(commit_cluster_flags "$_AXW")"
            [[ "$_AX_KILL" == "true" ]] && SKIP_HOOKS=true && SKIP_WHAT="git commit -n (via alias $W)"
            [[ "$_AX_VALUE" == "true" ]] && _AX_EXPECT=true
          fi
        done
        set +f
      else
        GIT_VERB="$W"
      fi
      case "$GIT_VERB" in commit|push) IS_GATED_STMT=true ;; esac
      continue
    fi
    # Past the verb: these are this invocation's own options.
    if commit_opt_takes_value "$W"; then
      EXPECT_VALUE=true
      continue
    fi
    [[ "$W" == "--no-verify" ]] && SKIP_HOOKS=true && SKIP_WHAT="--no-verify"
    # `git config core.hooksPath <path>` sets it with no `=` anywhere, so the assignment check above
    # cannot see it. What disables the gate is the ASSIGNMENT, and the first spelling here refused
    # the mere appearance of the key — so `git config --get core.hooksPath` and `git grep
    # core.hooksPath` were refused as bypasses, and `git config --unset core.hooksPath`, which
    # RESTORES the default hooks, was refused as a way of removing them. A guard that fires on
    # correct work is one people learn to route around; that is the argument this whole change is
    # built on, and it was being lost one line below where it is made. (#1588 review)
    #
    # The key is remembered, and only a following POSITIONAL — the value — disables anything. An
    # option cannot be one, and `--get`/`--unset` sit ahead of the key rather than after it.
    # (the reading itself is above, before the empty-word skip: `--local core.hooksPath ""` sets it
    # to an empty string, and a fully-quoted argument builds an EMPTY word)
    # A SHORT CLUSTER is walked letter by letter, and the walk STOPS at the first letter that takes a
    # value — everything after it is that value, not more flags. `git commit -mn "x"` is a commit
    # whose message is "n"; reading the cluster as a set refused it. The asymmetry below is measured
    # rather than assumed:
    #   git commit -h  ->  -n, --no-verify
    #   git push   -h  ->  -n, --[no-]dry-run
    # so `-n` is a kill switch on a commit and a harmless rehearsal on a push.
    if [[ "$W" == -[!-]* ]]; then
      read -r _ST_KILL _ST_VALUE <<< "$(commit_cluster_flags "$W")"
      [[ "$_ST_KILL" == "true" && "$GIT_VERB" == "commit" ]] && SKIP_HOOKS=true && SKIP_WHAT="git commit -n"
      [[ "$_ST_VALUE" == "true" ]] && EXPECT_VALUE=true
    fi
  done <<< "$STMT_WORDS"

  # An unknowable gated action, refused where this hook actually gates — and NOT anywhere else.
  #
  # The command position being an expansion is only dangerous if the action it hides is one this
  # guard would refuse spelled out, so the refusal is scoped to exactly that:
  #   - a PROTECTED branch, where the literal `git commit`/`git push` are refused. On a feature
  #     branch they are ordinary work, so refusing their spliced twin would be pure over-refusal.
  #   - or a statement naming `.husky`/`core.hooksPath`, the two gates that bind on ANY branch, so a
  #     spliced `g${X}it rm .husky/pre-push` cannot slip through by moving off `develop` first.
  #
  # Without that scope the check fired on `$EDITOR commit` — opening a file that happens to be NAMED
  # `commit` — on every branch, which is ordinary work and precisely the "guard that fires on correct
  # work is one people learn to route around" failure this file argues against. (#1683 review)
  #
  # Judged HERE, before the four-booleans-false `continue` below: none of the action regexes matches
  # a statement whose verb is an expansion, so a check placed after that early exit never runs — the
  # first arrangement of this block did exactly that and refused nothing. The branch is read from
  # EFFECTIVE_DIR, which this statement already resolved, and only when the flag is set, so ordinary
  # statements pay no extra subprocess. The remedy in the message is to write the command literally
  # rather than a new override token: the legitimate surface is a variable standing in for `git`, and
  # spelling it out costs nothing. (HARNESS-084)
  if [[ "$VERB_UNRESOLVED" == "true" ]] || [[ "$CMD_UNRESOLVED" == "true" && "$SAW_GATED_WORD" == "true" ]]; then
    _UNKNOWABLE_SCOPE=false
    _UNKNOWABLE_BRANCH=$(hook_current_branch "$EFFECTIVE_DIR" "")
    case "$_UNKNOWABLE_BRANCH" in main | master | develop) _UNKNOWABLE_SCOPE=true ;; esac
    case "$STMT_MASK" in *.husky* | *core.hooksPath*) _UNKNOWABLE_SCOPE=true ;; esac
    if [[ "$_UNKNOWABLE_SCOPE" == "true" ]]; then
      echo "[branch-guard] Blocked: this statement builds its command or subcommand from an expansion" >&2
      echo "[branch-guard] this hook cannot resolve, so whether it is a gated git action is unknown —" >&2
      echo "[branch-guard] and \`\$GIT commit\` / \`git c\${X}ommit\` are commits when the variable says so." >&2
      echo "[branch-guard] Unable to determine is not the same as safe. Spell the command out literally." >&2
      exit 2
    fi
  fi
  # Now that the verb is known: the husky kill switch counts only in front of a gated command.
  [[ "$HAS_HUSKY0" == "true" && "$IS_GATED_STMT" == "true" ]] && SKIP_HOOKS=true && SKIP_WHAT="HUSKY=0"

  # The CLASS is "disable the gate instead of satisfying it", not one flag. The first version of this
  # ban closed `--no-verify` alone, and measuring it immediately found SIX other routes walking
  # through — the instance-not-class mistake this file's history is full of. Each member below is a
  # documented kill switch published by the tool it belongs to, and none has a legitimate agent use.
  # And simply destroying the hooks — asked as a WHITELIST, because the destructive side is
  # open-ended and the readable side is not.
  #
  # Three rounds of review each named another verb the enumeration had missed: first the directory
  # forms (`rm -rf .husky`), then `cp /dev/null`, `truncate -s0`, `find -delete`. Each addition was
  # correct and each left the next spelling, which is the shape this whole change exists to stop.
  # So the question is inverted: a statement that names a `.husky` path must be one of the few
  # commands that can only READ it. Everything else is refused, including verbs nobody has thought
  # of yet.
  #
  # `find` and `git` are readable but not only-readable, so their destructive forms are named.
  # `HUSKY_TOKEN`'s trailing boundary is GITEND's rule — anything that is not a word character or
  # `-`. The first spelling listed `/` and whitespace, so `echo \`rm -rf .husky\`` did not even enter
  # this block: `.husky` was followed by a closing BACKTICK. That is the third time in this file a
  # hand-written boundary class omitted the backtick, which is why it is written once here. (#1588)
  HUSKY_TOKEN='[^[:space:]]*\.husky([^-[:alnum:]_]|$)'
  if printf '%s' "$STMT_MASK" | grep -qE "$HUSKY_TOKEN"; then
    # The whitelist names commands that may not DESTROY, which is a wider set than "may only read".
    # `git-branch.md` says "reading, listing and EDITING a hook are untouched; only destroying one is
    # refused", and the first version contradicted its own statement: `chmod +x` restoring an
    # executable bit and `sed -i` editing a hook were refused as bypasses. Neither removes a gate.
    # Destruction is named separately below, so an editor here is not a hole. (#1588 review)
    #
    # STATED LIMIT, not a silent one: an in-place editor can EMPTY a hook — `sed -i 's/.*//'` is an
    # edit by shape and a removal by effect. Deciding which requires evaluating the editor's program,
    # and getting that wrong is worse in both directions: too strict refuses an ordinary
    # `sed -i 's/foo/bar/'` (which is exactly what the review before this one found), too loose buys
    # the next program spelling. The path an agent actually takes — Write/Edit/MultiEdit — IS closed,
    # in check-forbidden-patterns.sh, which refuses a hook body left with nothing to run.
    # `vim`, `nano`, `node` and `python3` were in this list under the heading "read-only", which they
    # are not: an editor writes, and an interpreter runs whatever it is handed. Measured — with them
    # present, `node -e "require('fs').writeFileSync('.husky/pre-push','exit 0')"` walked straight
    # through. The Write/Edit path already demands `HOOK_EDIT_ACK=1`; letting the same change in via
    # Bash because the verb was `node` was an asymmetry, not a policy. (#1588 review)
    #
    # `sed`/`awk` stay, and the stated limit below says why: they are the everyday edit path, and
    # deciding whether a given program empties a file needs an evaluator that is wrong in both
    # directions. An editor that OPENS a hook is refused; a stream edit is not.
    HUSKY_SAFE='(cat|bat|ls|head|tail|grep|rg|wc|stat|file|diff|less|more|find|git|echo|printf|sed|awk|chmod)'
    # EVERY command position, including the ones inside a substitution. The tokenizer deliberately
    # leaves substitution content executable — it runs — so `echo "$(rm .husky/pre-push)"` led with a
    # whitelisted verb while really deleting the hook. Checking only the statement's first token is
    # the same mistake the flag check made one screen up, and it was still here. (#1588 review)
    #
    # Each `$(`/backtick opens a new command position, so the text after one is checked as its own
    # leading verb, exactly as the statement's start is.
    HUSKY_POSITIONS=$(printf '%s' "$STMT_MASK" | sed -E 's/(\$\(|`)/\n/g')
    while IFS= read -r POS; do
      [[ -n "${POS//[[:space:]]/}" ]] || continue
      printf '%s' "$POS" | grep -qE "$HUSKY_TOKEN" || continue
      printf '%s' "$POS" |
        grep -qE "^[[:space:]]*([[:alnum:]_]+=[^[:space:]]+[[:space:]]+)*${HUSKY_SAFE}([[:space:]]|$)" ||
        { SKIP_HOOKS=true; SKIP_WHAT="touching .husky"; }
    done <<< "$HUSKY_POSITIONS"
    # `chmod` may restore a bit; it may not remove the executable one. Three spellings do that, and
    # the first version caught only the separated `-x`: `chmod a-x` attaches the minus to the mode
    # token, and an OCTAL mode drops the bit with no `-` anywhere. A mode is refused unless it is
    # visibly ADDING execute. (#1588 review)
    # Only REAL options are skipped over. `-[Rvfch]`-style flags are chmod's; `-x` is a MODE that
    # happens to start with a minus, and treating it as an option made the mode come back as the file
    # path — so `chmod -x` stopped being caught by the very change meant to widen the check.
    #
    # THE MODE IS TAKEN FROM THE WORDS, not from a sed pass over the mask. That pass was the last
    # second reading in this file and it was wrong in two ways at once, both measured:
    #
    #   chmod --recursive -x .husky/pre-push    the option class was SHORT-only (`[RLHPvfc]`), so the
    #                                           long option was captured AS the mode and the real
    #                                           `-x` behind it was never judged
    #   echo "$(chmod -x .husky/pre-push)"      the pattern demanded whitespace before `chmod`, and
    #                                           inside a substitution the character before it is `(`
    #
    # Both disarmed a hook and were permitted. The second is why this asks `hook_statement_all_words`
    # rather than `hook_statement_words`.
    #
    # The property precisely, because the loose version of this sentence misled a reviewer into
    # reporting a bypass that does not exist. Statement ranges split at a SEPARATOR, and a separator
    # inside a substitution is a separator — measured:
    #
    #   echo "$(echo x; rm .husky/pre-push)"   ->  two statements, and the second leads with `rm`
    #   echo "$(chmod -x .husky/pre-push)"     ->  ONE statement
    #
    # So what the substitution-excluding reading cannot see is a command that shares a statement with
    # the one it is nested in — which is exactly the chmod above, and is not a general blindness to
    # substitutions. The whitelist below still checks each substitution as its own command position,
    # for the same reason.
    #
    # EVERY chmod in the statement is judged, not the first: `chmod +x a && chmod -x .husky/pre-push`
    # has a restoring one in front of a disarming one.
    if ! STMT_ALL_WORDS=$(hook_statement_all_words "$COMMAND" "$STMT_START" "$STMT_LEN" && printf '\001'); then
      echo "[branch-guard] Blocked: a statement naming a hook path could not be split into words," >&2
      echo "[branch-guard] so what it does to that hook was never read. This is not a pass." >&2
      exit 2
    fi
    STMT_ALL_WORDS=${STMT_ALL_WORDS%$'\n\001'}
    CHMOD_MODES=()
    CHMOD_SEEK=false
    while IFS= read -r W; do
      if [[ "$CHMOD_SEEK" == "true" ]]; then
        case "$W" in
          # `--reference=<file>` copies another file's mode and can strip execute without ever naming
          # one. Refused rather than reasoned about: there is no mode token to judge, and "I cannot
          # tell" is a refusal here. (#1588 review)
          --reference*) SKIP_HOOKS=true; SKIP_WHAT="disarming a hook"; CHMOD_SEEK=false; continue ;;
          # A long option is never a mode. This is the class the sed pattern did not have.
          --*) continue ;;
          # A short cluster is an option only if EVERY letter is one of chmod's. `-x` is a MODE that
          # happens to start with a minus, and skipping it as an option made the file path come back
          # as the mode — so `chmod -x` stopped being caught by the change meant to widen the check.
          -*) [[ "${W#-}" =~ ^[RLHPvfc]+$ ]] && continue
              CHMOD_MODES+=("$W"); CHMOD_SEEK=false; continue ;;
          '') continue ;;
          *) CHMOD_MODES+=("$W"); CHMOD_SEEK=false; continue ;;
        esac
      fi
      case "$W" in
        chmod|*/chmod) CHMOD_SEEK=true ;;
      esac
    done <<< "$STMT_ALL_WORDS"
    for CHMOD_MODE in ${CHMOD_MODES+"${CHMOD_MODES[@]}"}; do
      # Each comma-separated CLAUSE is judged, and the LAST word about execute wins — `+x` appearing
      # anywhere is not "restoring". `chmod a-x,+X` removes the bit and then conditionally does
      # nothing (`+X` only acts when some execute bit survives), so a presence test read a pure
      # disarming as a restore. (#1588 review)
      # ANY clause that removes execute disarms the hook, whatever a later clause grants to someone
      # else. `chmod u-x,g+x` takes it from the OWNER — the identity git runs the hook as — and gives
      # it to the group, which does not put it back. A last-clause-wins reading called that a
      # restore. `+X` is conditional (it grants only where execute already survives) and so can never
      # undo a `-x` in the same command. (#1588 review)
      IFS=',' read -ra CHMOD_CLAUSES <<< "$CHMOD_MODE"
      for CLAUSE in "${CHMOD_CLAUSES[@]}"; do
        case "$CLAUSE" in
          *-x*|*-X*) SKIP_HOOKS=true; SKIP_WHAT="disarming a hook" ;;
        esac
      done
      case "$CHMOD_MODE" in
        *+x*|*+X*) ;;                                   # handled by the clause walk above
        [0-7][0-7][0-7]|[0-7][0-7][0-7][0-7])
          # Octal: the owner digit carries execute as 1, so 7/5/3/1 keep it and the rest drop it.
          case "${CHMOD_MODE: -3:1}" in
            1|3|5|7) ;;
            *) SKIP_HOOKS=true; SKIP_WHAT="disarming a hook" ;;
          esac
          ;;
        *-x*|*-X*) SKIP_HOOKS=true; SKIP_WHAT="disarming a hook" ;;
      esac
    done
    # `find … -delete` / `-exec` and `git rm|mv` name a path they then destroy.
    # `-exec` is refused even when the command it runs only reads (`find .husky -exec cat {} \;`).
    # Judging that would mean evaluating the exec'd command, which is the evaluator this file
    # declines to write elsewhere for the same reason — `ls`/`grep`/`cat` on the path are the
    # untouched read path, and they do not need `find -exec`. Stated so the narrower framing above
    # is not read as covering this. (#1588 review)
    printf '%s' "$STMT_MASK" | grep -qE '(^|[[:space:]])find([[:space:]]|$)' &&
      printf '%s' "$STMT_MASK" | grep -qE '(^|[[:space:]])-(delete|exec)([[:space:]]|$)' &&
      { SKIP_HOOKS=true; SKIP_WHAT="deleting a hook"; }
    printf '%s' "$STMT_MASK" | grep -qE "${GITPFX}(rm|mv)${GITEND}" &&
      { SKIP_HOOKS=true; SKIP_WHAT="removing a hook from git"; }
    # The ALIASED spelling of the same removal: with `alias.wipe rm` already in config,
    # `git wipe -f .husky/pre-push` deleted the hook while the whitelist read `git` and the
    # pattern above read `wipe`. The verb latch has already resolved the chain, so the verb is
    # asked beside the literal pattern. (Aliases are read from config ONCE at hook start, so an
    # alias configured earlier in the same tool call is not visible until the next one — setting
    # it is itself a visible command.) (#1666 review)
    case "$GIT_VERB" in
      rm | mv)
        SKIP_HOOKS=true
        SKIP_WHAT="removing a hook from git (via alias)"
        ;;
    esac
    # A redirection writes wherever it points, whatever the command in front of it is.
    #
    # INFRA-111: this was a private regex, and its holes were a DIFFERENT set from the ones the
    # bulk-edit guard had for the same question — `>& .husky/pre-push` and `>| .husky/pre-push` both
    # walked past a refusal whose own text says "Zero exceptions". Both now read the redirect targets
    # from `command-scan.sh`, which parses the grammar once.
    while IFS= read -r _RT; do
      [[ -z "$_RT" ]] && continue
      case "$_RT" in
        *.husky*) SKIP_HOOKS=true; SKIP_WHAT="overwriting a hook" ;;
      esac
    done < <(hook_redirect_targets "$COMMAND" "$STMT_START" "$STMT_LEN")
    # `echo`/`printf` are readers ONLY without a redirection, which the line above catches.
  fi
  if [[ "$SKIP_HOOKS" == "true" ]]; then
    echo "[branch-guard] Blocked: '$SKIP_WHAT' disables the gate rather than satisfying it. Zero exceptions." >&2
    echo "[branch-guard] Four agents bypassed in one day; the gate was broken (HARNESS-058) and was fixed." >&2
    echo "[branch-guard] If a check is wrong, unrunnable, or fires on correct work, change the CHECK." >&2
    echo "[branch-guard] A fresh worktree needs 'pnpm install --frozen-lockfile' and 'pnpm build' once." >&2
    exit 2
  fi

  if [[ "$IS_GH_DELETE_BRANCH" == "true" ]]; then
    # Print the corrected command; do not paraphrase the policy. A guard that restates a rule
    # becomes a second copy of it that drifts — this message once said the opposite of
    # git-branch.md on both who may delete a branch and which flag to use, and the prohibited
    # command was retried for weeks because the guard taught the wrong alternative.
    # Correct THIS STATEMENT, not the whole raw command: a sed over the full command also strips
    # the flag's name out of quoted text — a commit message, a PR body — and the "corrected"
    # suggestion is then a different command than the user meant. The statement slice bounds it,
    # and a statement where the flag appears more than once (one of them necessarily quoted text)
    # gets an instruction instead of a synthesis that would guess which one to drop.
    # Ranges are 1-based (awk substr); bash slicing is 0-based.
    STMT_RAW="${COMMAND:$((STMT_START - 1)):$STMT_LEN}"
    echo "[branch-guard] Blocked: '--delete-branch' is prohibited in 'gh pr merge'. Zero exceptions." >&2
    # Counted with the SAME boundary the sed strips with — a bare substring count read
    # `--delete-branch-like` (a different flag) as an occurrence, chose the single-occurrence
    # branch, and the sed then stripped nothing, so "Run this instead" repeated the refused
    # command verbatim. (#1672 review)
    if [[ $(printf '%s' "$STMT_RAW" | grep -oE -- '--delete-branch(=[^[:space:]]*)?([^-[:alnum:]_]|$)' | grep -c .) -eq 1 ]]; then
      # An explicit boundary class, not \b: `-` is not a word character, so \b matched inside
      # `--delete-branch-like` names and the sed would strip a prefix of a different flag. The
      # `=value` spelling is consumed WITH the flag — keeping the boundary alone turned
      # `--delete-branch=false` into a stray `=false` glued to the previous word. (#1672 review)
      FIXED_COMMAND=$(printf '%s' "$STMT_RAW" | sed -E 's/[[:space:]]+--delete-branch(=[^[:space:]]*)?([^-=[:alnum:]_]|$)/\2/')
      echo "[branch-guard] Run this instead:" >&2
      echo "[branch-guard]   $FIXED_COMMAND" >&2
    else
      echo "[branch-guard] Re-run this statement without '--delete-branch'." >&2
    fi
    echo "[branch-guard] Branch cleanup after the merge is governed by .agents/rules/git-branch.md" >&2
    echo "[branch-guard] (see 'Delete Merged Branches') — read it there, it is the only copy." >&2
    exit 2
  fi

  # --- L2: never delete a REMOTE branch until its PR is confirmed MERGED (git-branch.md) ---
  # A branch deleted while its PR is unmerged CLOSES/orphans the PR (this happened once: a delete
  # ran right after a `gh pr merge` that had actually failed DIRTY). Gate remote-branch deletion on
  # a confirmed merged PR. Matches: `gh api -X DELETE .../git/refs/heads/<name>`,
  # `git push <remote> --delete <name>`, `git push <remote> :<name>`.
  DELETE_BRANCH_NAME=""
  # The RAW command. A heredoc BODY is data — a `git commit -F - <<'EOF' …` message may legitimately
  # mention `git push --delete` or `refs/heads/` — and so is a quoted argument, and the tokenizer
  # inside `hook_deleted_branch` knows both. It used to be handed a string that had been pre-cut by a
  # line-oriented pass, which looked for a heredoc opener with a regex that did not know about quoting:
  # a `<<EOF` inside a quoted string opened a body that never closed, and the real delete that followed
  # it was deleted from the string this check reads. (INFRA-075, #1572)
  # EXTRACT_SRC/START/LEN carry the substituted-vs-whole decision computed once above: the
  # substituted slice when an alias resolved (`alias.pd "push origin --delete"` spells its verb
  # only after expansion), the whole command otherwise so hook_deleted_branch's tokenizer keeps
  # the surrounding text that tells a heredoc body (`cat <<'EOF' … git push --delete … EOF`) from
  # a live delete. (#1666 review)
  DELETE_BRANCH_NAME=$(hook_deleted_branch "$EXTRACT_SRC" "$EXTRACT_START" "$EXTRACT_LEN" || true)

  if [[ -n "$DELETE_BRANCH_NAME" ]] && ! stmt_override BRANCH_GUARD_ALLOW_DELETE; then
    if printf '%s' "$DELETE_BRANCH_NAME" | grep -qE '^(main|master|develop|gh-pages)$'; then
      echo "[branch-guard] Blocked: refusing to delete protected branch '$DELETE_BRANCH_NAME'." >&2
      exit 2
    fi
    MERGED_COUNT=$(bounded_gh pr list --head "$DELETE_BRANCH_NAME" --state merged --json number --jq 'length' || echo "")
    if [[ -z "$MERGED_COUNT" ]]; then
      echo "[branch-guard] Blocked: cannot confirm a MERGED PR for '$DELETE_BRANCH_NAME' (gh unavailable / query failed)." >&2
      echo "[branch-guard] Verify the merge landed (gh pr view <n> --json state == MERGED), then override: BRANCH_GUARD_ALLOW_DELETE=1" >&2
      exit 2
    fi
    if [[ "$MERGED_COUNT" == "0" ]]; then
      echo "[branch-guard] Blocked: branch '$DELETE_BRANCH_NAME' has NO merged PR — deleting it now would orphan/close an unmerged PR." >&2
      echo "[branch-guard] Confirm the merge FIRST: gh pr view <n> --json state must be MERGED." >&2
      echo "[branch-guard] Intentional abandon of an unmerged branch? Override: BRANCH_GUARD_ALLOW_DELETE=1" >&2
      exit 2
    fi

    # A merged PR in the branch's history is NOT proof that nothing is open on it NOW.
    #
    # Measured 2026-07-26: `fix/d4-scope-calculator` carried two merged PRs (#1484, #1485) from earlier
    # reuses of the same branch name. #1483 was open and CONFLICTING at the time — never merged. The
    # merged-count check saw `2`, allowed the deletion, and GitHub closed #1483 as a result. The exact
    # outcome this guard exists to prevent, waved through by the guard itself.
    #
    # So ask the question that actually matters: is anything OPEN on this branch right now?
    OPEN_COUNT=$(bounded_gh pr list --head "$DELETE_BRANCH_NAME" --state open --json number --jq 'length' || echo "")
    if [[ -z "$OPEN_COUNT" ]]; then
      echo "[branch-guard] Blocked: cannot confirm whether an OPEN PR exists for '$DELETE_BRANCH_NAME' (gh unavailable / query failed)." >&2
      echo "[branch-guard] Unable to determine is not the same as safe. Check by hand, then override: BRANCH_GUARD_ALLOW_DELETE=1" >&2
      exit 2
    fi
    if [[ "$OPEN_COUNT" != "0" ]]; then
      OPEN_LIST=$(bounded_gh pr list --head "$DELETE_BRANCH_NAME" --state open --json number,mergeStateStatus \
        --jq '[.[] | "#\(.number) (\(.mergeStateStatus))"] | join(", ")' || echo "")
      echo "[branch-guard] Blocked: '$DELETE_BRANCH_NAME' still has an OPEN PR — $OPEN_LIST." >&2
      echo "[branch-guard] Deleting it now CLOSES that PR. A merged PR earlier in this branch's history does not make deletion safe." >&2
      echo "[branch-guard] Merge or close it deliberately first. Intentional abandon? Override: BRANCH_GUARD_ALLOW_DELETE=1" >&2
      exit 2
    fi
    # A merged PR exists AND nothing is open on the branch → deletion is safe. Fall through.
  fi

  # Judged here rather than below, because the checks below read a NAME and a BASE out of positions
  # this form does not use (see RE_BRANCH_COPY). Refusing before that point is the whole reason the
  # copy forms are a separate verb: nothing downstream gets the chance to answer about the wrong
  # token.
  if [[ "$IS_BRANCH_COPY" == "true" ]] && ! stmt_override BRANCH_GUARD_ALLOW_BRANCH_COPY; then
    echo "[branch-guard] Blocked: 'git branch -c/-C' copies a branch, which creates one." >&2
    echo "[branch-guard] Its arguments are in the other order — '-c <old> <new>' names the branch" >&2
    echo "[branch-guard] SECOND — so the base and name checks would read the wrong token and answer" >&2
    echo "[branch-guard] confidently backwards. Create it the prescribed way instead:" >&2
    echo "[branch-guard]   git fetch origin && git checkout -b <type>/<slug> origin/develop" >&2
    echo "[branch-guard] Deliberate exception: BRANCH_GUARD_ALLOW_BRANCH_COPY=1 inline." >&2
    exit 2
  fi

  if [[ "$IS_COMMIT" == "false" && "$IS_PUSH" == "false" && "$IS_MERGE" == "false" && "$IS_BRANCH_CREATE" == "false" ]]; then
    continue
  fi

  # Get current branch of the EFFECTIVE context (worktree-aware, see resolution above)
  PROJECT_DIR="$EFFECTIVE_DIR"

  # A guard fails CLOSED. When nothing resolvable is a repository, the branch read below came back
  # empty, an empty branch matched no protected name, and the hook exited 0 — "I could not verify"
  # wearing the costume of "I verified this is fine", which the hook protocol reads as a pass.
  # A detached HEAD is deliberately NOT this case: there the repository IS readable and the branch is
  # genuinely nameless, and the checks below already handle that.
  if ! hook_is_work_tree "$PROJECT_DIR"; then
    echo "[branch-guard] Blocked: '$PROJECT_DIR' is no git repository, so the branch this command" >&2
    echo "[branch-guard] would act on cannot be read. Nothing was verified; this is not a pass." >&2
    echo "[branch-guard] Run the command from the checkout it belongs to." >&2
    exit 2
  fi
  # One branch reader, with the default on the VALUE. `git branch --show-current` exits 0 and prints
  # NOTHING on a detached HEAD, so an `|| echo …` arm here never runs — three hooks wrote one and all
  # three were dead code. THIS caller wants the empty value: the checks below key on emptiness to
  # recognise a detached HEAD, which is why the default is the caller's to name.
  CURRENT_BRANCH=$(hook_current_branch "$PROJECT_DIR" "")


  # A detached HEAD has no branch name, so the protected-branch checks below have nothing to compare
  # and the guard used to stop here. Branch CREATION is different: creating `feat/x` while detached at
  # `main` is precisely the wrong base this guard refuses, and stopping first made that unreachable —
  # the base check could never run in the one state where nobody notices the base.
  if [[ -z "$CURRENT_BRANCH" && "$IS_BRANCH_CREATE" != "true" ]]; then
    continue
  fi

  # Block new branch creation when local branches have commits not yet in the INTEGRATION branch.
  # `git-branch.md` § One-Branch-At-A-Time names the comparison itself — `git branch --no-merged
  # develop` — and this compared against `main`. `main` trails `develop` between promotions, so 53 of
  # 140 local branches here were counted unmerged while already being in `develop`. Measured, and a
  # straight contradiction of the rule this check enforces.
  # This correctly handles squash-merged branches (their commits appear reachable
  # from main after squash) as long as the local branch pointer is deleted post-merge.
  if [[ "$IS_BRANCH_CREATE" == "true" && "$UNMERGED_CHECKED" == "false" ]] &&
      ! stmt_override BRANCH_GUARD_ALLOW_OPEN_BRANCHES; then
  # Once per COMMAND, not once per creating statement. The query below is a network call and the
  # question it asks — "does this checkout have unmerged local branches" — is about the repository,
  # not about which statement asked. Marked before the checks run, so a second creation does not pay
  # for it again after the first one passed.
  UNMERGED_CHECKED=true
    # Prefer the remote-tracking integration head; fall back to local `develop` when offline.
    INTEGRATION_REF=origin/develop
    hook_git_in "$PROJECT_DIR" rev-parse --verify --quiet "$INTEGRATION_REF" >/dev/null 2>&1 || INTEGRATION_REF=develop
    # A branch whose PR was SQUASH-merged keeps commits git cannot find in the integration branch, so
    # ancestry alone calls it unmerged forever. Measured 2026-07-28: 83 branches reported, 73 of them
    # with a MERGED PR — an 88% false-positive rate. A guard wrong seven times out of eight is one
    # that gets overridden as a reflex, and it was: twice in one session, by me. The message under
    # this loop already told people to delete squash-merged branches; the check never used what the
    # message knew.
    #
    # Matched on NAME AND COMMIT, never name alone. A branch name gets reused: merge `feat/x`, leave the
    # local branch, and stack new work on it, and a name-only match would wave those new commits through
    # — silently disabling the very rule this check enforces. The delete-guard below already carries that
    # lesson ("a merged PR earlier in this branch's history does not make deletion safe"); this path was
    # written without it.
    # Asked PER BRANCH, not as one global list (PROC-012, issue #2135). The previous form pulled
    # `pr list --state merged --limit 500` once and matched candidates against it. That list is
    # SATURATED — it returns a full 500 — so every merged PR older than the window fell out and its
    # branch was reported unmerged. The hook printed a NOTE saying the list came back full and blocked
    # anyway, which is a guard announcing its own false positive and refusing regardless. Measured
    # 2026-08-23: it blocked branch creation in two of four active clones inside ten minutes, on four
    # branches merged as #2143, #2147, #2133 and #2144, and produced one reflex override.
    #
    # `--head <branch>` has no window to saturate. It costs one call per branch that is actually ahead
    # of the integration ref — the branches already deleted after their merge cost nothing, which is
    # the direction the rule pushes anyway.
    #
    # Still bounded, and for the reason the global form was: this path was once entirely local, it now
    # makes a network call, and it runs on every branch creation. A SLOW response is not a failed one —
    # unbounded, a stalled connection holds the branch creation open instead of taking the fallback
    # below. The bound comes from the shared helper, which owns the deadline and every hard-won detail
    # of enforcing it. Per-branch makes that bound MORE load-bearing, not less: the deadline is now
    # paid per candidate rather than once, which is the cost of asking a question that has an answer.
    MERGED_QUERY_FAILED=false

    UNMERGED_BRANCHES=()
    SKIP_PATTERNS="^(main|master|develop|gh-pages)$"
    while IFS= read -r candidate; do
      candidate="${candidate#  }"   # strip leading spaces
      candidate="${candidate#\* }"  # strip current-branch marker
      candidate="${candidate#+ }"   # strip the worktree marker, which otherwise yielded a bogus name
      [[ "$candidate" =~ $SKIP_PATTERNS ]] && continue
      [[ -z "$candidate" ]] && continue
      ahead=$(hook_git_in "$PROJECT_DIR" rev-list --count "$INTEGRATION_REF..$candidate" 2>/dev/null || echo 0)
      [[ "$ahead" -gt 0 ]] || continue
      # A merged PR settles it — for the COMMIT that was merged, not for the name, and only when the
      # merge actually LANDED on the integration ref.
      #
      # Three conditions, all required. A merged PR must exist for this branch name; the local branch
      # must still point at the exact commit that PR merged (a reused name with new work stacked on it
      # is NOT settled — the delete-guard below carries the same lesson); and the PR's merge commit
      # must be an ancestor of the integration ref. That last one is not redundant: measured
      # 2026-08-23, four branches on `origin` had a merged PR whose base was a since-deleted FEATURE
      # branch, so their work is on neither `develop` nor `main`. Asking only "was it merged" clears
      # all four.
      candidate_sha=$(hook_git_in "$PROJECT_DIR" rev-parse "$candidate" 2>/dev/null || echo "")
      if [[ -n "$candidate_sha" ]]; then
        if MERGED_PR=$(bounded_gh pr list --state merged --head "$candidate" \
          --json headRefOid,mergeCommit --jq '.[0] | "\(.headRefOid) \(.mergeCommit.oid)"'); then
          merged_head="${MERGED_PR%% *}"
          merged_commit="${MERGED_PR##* }"
          if [[ "$merged_head" == "$candidate_sha" && -n "$merged_commit" && "$merged_commit" != "null" ]] &&
            hook_git_in "$PROJECT_DIR" merge-base --is-ancestor "$merged_commit" "$INTEGRATION_REF" 2>/dev/null; then
            continue
          fi
        else
          MERGED_QUERY_FAILED=true
        fi
      fi
      UNMERGED_BRANCHES+=("$candidate ($ahead commits ahead of $INTEGRATION_REF)")
    done < <(hook_git_in "$PROJECT_DIR" branch 2>/dev/null)

    if [[ "${#UNMERGED_BRANCHES[@]}" -gt 0 ]]; then
      echo "[branch-guard] Blocked: local branches with unmerged commits detected." >&2
      echo "[branch-guard] Merge or delete them before creating a new branch:" >&2
      for b in "${UNMERGED_BRANCHES[@]}"; do
        echo "  - $b" >&2
      done
      echo "[branch-guard] Branch cleanup after a merge is governed by .agents/rules/git-branch.md" >&2
      echo "[branch-guard] (see 'Delete Merged Branches') — read it there, it is the only copy." >&2
      if [[ "$MERGED_QUERY_FAILED" == "true" ]]; then
        echo "[branch-guard] NOTE: at least one merged-PR query failed (gh unavailable / timed out), so a" >&2
        echo "[branch-guard] squash-merged branch may be listed here as unmerged. Verify by hand before" >&2
        echo "[branch-guard] overriding: gh pr list --state merged --head <branch> --json mergeCommit" >&2
      fi
      echo "[branch-guard] To override: set BRANCH_GUARD_ALLOW_OPEN_BRANCHES=1" >&2
      exit 2
    fi
  fi

  # Enforce feature branch naming convention <type>/<desc> (git-branch.md).
  # Long-lived branches are exempt; override with BRANCH_GUARD_ALLOW_BADNAME=1.
  # Branch creation. TWO independent checks live here — the base a branch is cut from, and the name
  # it is given — each with its OWN override. They were one block gated by the NAME override, so
  # `BRANCH_GUARD_ALLOW_BADNAME=1` silently switched the base check off too and reopened the
  # promotion-ancestry hole it exists to close. Two checks, two overrides; neither excuses the other.
  if [[ "$IS_BRANCH_CREATE" == "true" ]]; then
    # Read the branch name out of the checkout/switch invocation itself. The previous expression
    # ran a greedy `.*` over the WHOLE command and captured whatever followed the LAST
    # -b/-B/-c/-C, so `git checkout -b feat/x && git -C /other status` yielded /other and
    # refused a correctly named branch. Adding -C to that alternation made a long-standing
    # weakness reachable.
    # Read the name from the ORIGINAL, positioned by a match in the masked text — the same rule the
    # `-C` target and the delete name follow. Pulling it straight out of the masked string returned
    # the \001 fill for `git checkout -b "feat/x"` and refused a correctly named branch.
    NEW_BRANCH=$(hook_match_extract "$EXTRACT_SRC" \
      '(^|[ \t;&|({\n"\047`])git[ \t]+(('"$GIT_VALUE_GLOBALS"')[ \t]+[^ \t\n]+[ \t]+|-[^ \t\n]+[ \t]+)*(checkout|switch)[ \t]+(-[^ \t\n]+[ \t]+)*-[bBcC][ \t]+' \
        "$EXTRACT_START" "$EXTRACT_LEN" || true)
    # `git branch <name>` puts the name where the two spellings above put it after `-b`/`-c`, so it
    # reads with the same machinery and a different prefix (INFRA-070). Asked only when the first
    # extraction found nothing, because a statement is one creation and the first match is its name.
    if [[ -z "$NEW_BRANCH" ]]; then
      NEW_BRANCH=$(hook_match_extract "$EXTRACT_SRC" \
        '(^|[ \t;&|({\n"\047`])git[ \t]+(('"$GIT_VALUE_GLOBALS"')[ \t]+[^ \t\n]+[ \t]+|-[^ \t\n]+[ \t]+)*branch[ \t]+('"$RE_BRANCH_CREATE_FLAGS"'[ \t]+)*' \
          "$EXTRACT_START" "$EXTRACT_LEN" || true)
    fi
    # --- the base the branch is cut from (INFRA-067) ---------------------------------------------
    #
    # `git-branch.md` is mandatory about this: feature branches are created from a freshly-fetched
    # `origin/develop`, never from `main` and never from another feature branch. Nothing checked it at
    # creation time — this guard read the NAME and the unmerged-branch list, and never the base. Two
    # audits measured `grep -c origin/develop` over this file at 0.
    #
    # It cost a promotion: a branch cut from a promotion branch dragged main's merge commits into the
    # PR range and broke the promotion-ancestry check. Branch creation is also the one guarded action
    # with no git-native backstop — husky covers commits on protected branches, rulesets cover pushes
    # to main, nothing covers `checkout -b`.
    #
    # `hotfix/*` and `release/*` are exempt: the rule lets them PR to `main` and does not prescribe
    # develop as their base. Feature branches are what it prescribes, and what this checks.
    if [[ -n "$NEW_BRANCH" ]] && ! stmt_override BRANCH_GUARD_ALLOW_BASE &&
      ! [[ "$NEW_BRANCH" =~ ^(hotfix|release)/ ]]; then
      # The start point, when the command names one: the token after the branch name. A `&&`, a `;` or
      # another flag is not a start point — those mean the command simply ended.
      # Flags may sit between the new branch name and the start point: `git checkout -b feat/x --track
      # origin/main` puts `--track` where the start point was being read, so the check compared HEAD
      # instead and passed while the branch came from `origin/main` — the exact creation this exists to
      # refuse, waved through by one common flag.
      START_POINT=$(hook_match_extract "$EXTRACT_SRC" \
        '(^|[ \t;&|({\n"\047`])git[ \t]+(('"$GIT_VALUE_GLOBALS"')[ \t]+[^ \t\n]+[ \t]+|-[^ \t\n]+[ \t]+)*(checkout|switch)[ \t]+(-[^ \t\n]+[ \t]+)*-[bBcC][ \t]+[^ \t\n]+[ \t]+(-[^ \t\n]+[ \t]+)*' \
          "$EXTRACT_START" "$EXTRACT_LEN" || true)
      # Same position, different prefix, same reason as the name above (INFRA-070). `git branch x main`
      # is the form the item was filed for: it names its base explicitly, so leaving this unread would
      # have widened the DETECTION while leaving the base check comparing against HEAD — a creation
      # judged, and judged against the wrong thing.
      if [[ -z "$START_POINT" ]]; then
        START_POINT=$(hook_match_extract "$EXTRACT_SRC" \
          '(^|[ \t;&|({\n"\047`])git[ \t]+(('"$GIT_VALUE_GLOBALS"')[ \t]+[^ \t\n]+[ \t]+|-[^ \t\n]+[ \t]+)*branch[ \t]+('"$RE_BRANCH_CREATE_FLAGS"'[ \t]+)*[^ \t\n]+[ \t]+(-[^ \t\n]+[ \t]+)*' \
            "$EXTRACT_START" "$EXTRACT_LEN" || true)
      fi
      # A start point is a git ref, and the token holding it may be glued to what follows.
      #
      # Blanking the whole token whenever it contained an operator was worse than the bug it replaced:
      # `git checkout -b feat/x main;` reads as one token `main;`, git cuts from `main`, and blanking
      # it fell back to HEAD — so a base of `main` passed whenever HEAD happened to be develop. A
      # fail-OPEN, where the version before it at least failed to resolve and refused.
      #
      # So the token is TRUNCATED at the first operator rather than discarded, and a redirection is
      # recognised by its shape — `2>&1`, `>/dev/null` — instead of by containing an operator at all.
      # `git checkout -b feat/x 2>&1 | head` is an ordinary creation and must not be refused; that one
      # was measured, blocking the creation of the branch this check was fixed on.
      # A redirection, in either direction, with or without a file-descriptor number: `2>&1`,
      # `>/dev/null`, `3<file`, `<in`. Those are not start points at all.
      #
      # The descriptor and the operator must be ADJACENT. Written as the glob `[0-9]*'>'*` this read
      # "a digit, then anything, then `>`" — so `2fa-base>/tmp/out.log` matched, and a real ref whose
      # name begins with a digit was blanked and fell back to HEAD. The same fail-open this whole arm
      # exists to prevent, reintroduced for every start point starting with a number. So the leading
      # run of digits is stripped and the NEXT character decides.
      START_POINT_AFTER_FD="${START_POINT#"${START_POINT%%[!0-9]*}"}"
      case "$START_POINT_AFTER_FD" in '>'* | '<'*) START_POINT="" ;; esac

      case "$START_POINT" in
        -* | '') START_POINT="" ;;
        *) START_POINT="${START_POINT%%[\<\>\|\&\;]*}" ;;
      esac

      # The SESSION's repository, not `PROJECT_DIR`. `PROJECT_DIR` prefers a `git -C <path>` found
      # anywhere in the command, and in a compound command that `-C` usually belongs to some other
      # invocation — `git checkout -b feat/x && git -C <other> status` would have this check judge
      # <other>, which is not where the branch lands. Measured: that shape blocked a legitimate
      # creation. Stated limit: `git -C <other> checkout -b` is judged against the session repository
      # rather than <other>; branches are created where the session is, and erring that way
      # over-permits a rare form instead of refusing a common one.
      # The `session` mode is exactly that rule, named: hook `cwd` > project dir, `git -C` ignored.
      BASE_DIR=$(hook_effective_repo session "$GIT_C_PATH" "$HOOK_CWD" "${CLAUDE_PROJECT_DIR:-}")

      WANTED=origin/develop
      hook_git_in "$BASE_DIR" rev-parse --verify --quiet "$WANTED" >/dev/null 2>&1 || WANTED=develop
      WANTED_SHA=$(hook_git_in "$BASE_DIR" rev-parse --verify --quiet "$WANTED" 2>/dev/null || echo "")
      BASE_REF="${START_POINT:-HEAD}"
      BASE_SHA=$(hook_git_in "$BASE_DIR" rev-parse --verify --quiet "$BASE_REF" 2>/dev/null || echo "")
      # `branch --show-current` exits 0 with empty output on a detached HEAD, so `|| echo HEAD` never
      # fired and the refusal named nothing. The default belongs on the VALUE, not on the exit code —
      # which is what hook_current_branch does, for every caller, once.
      BASE_NAME="${START_POINT:-$(hook_current_branch "$BASE_DIR" HEAD)}"

      if [[ -z "$WANTED_SHA" || -z "$BASE_SHA" ]]; then
        echo "[branch-guard] Blocked: cannot resolve the base for '$NEW_BRANCH'." >&2
        echo "[branch-guard]   wanted: $WANTED   found: ${BASE_NAME:-<unresolved>}" >&2
        echo "[branch-guard] Fetch first (git fetch origin), or override: BRANCH_GUARD_ALLOW_BASE=1" >&2
        exit 2
      fi

      if [[ "$BASE_SHA" != "$WANTED_SHA" ]]; then
        echo "[branch-guard] Blocked: '$NEW_BRANCH' would be cut from the wrong base." >&2
        echo "[branch-guard]   found:  $BASE_NAME ($(printf '%.9s' "$BASE_SHA"))" >&2
        echo "[branch-guard]   wanted: $WANTED ($(printf '%.9s' "$WANTED_SHA"))" >&2
        echo "[branch-guard] git-branch.md: feature branches are cut from a freshly-fetched origin/develop." >&2
        echo "[branch-guard] Do: git fetch origin && git checkout -b $NEW_BRANCH origin/develop" >&2
        echo "[branch-guard] Deliberate exception: BRANCH_GUARD_ALLOW_BASE=1" >&2
        exit 2
      fi
    fi

    BRANCH_NAME_RE='^(feat|fix|chore|docs|refactor|test|perf|build|ci|style|revert|release|hotfix)/[a-z0-9][a-z0-9._/-]*$'
    EXEMPT_RE='^(main|master|develop|gh-pages)$'
    if [[ -n "$NEW_BRANCH" ]] && ! stmt_override BRANCH_GUARD_ALLOW_BADNAME &&
      ! [[ "$NEW_BRANCH" =~ $EXEMPT_RE ]] && ! [[ "$NEW_BRANCH" =~ $BRANCH_NAME_RE ]]; then
      echo "[branch-guard] Blocked: branch name '$NEW_BRANCH' does not match <type>/<desc>." >&2
      echo "[branch-guard] Expected e.g. feat/x-y, fix/z, chore/w" >&2
      echo "[branch-guard] (types: feat|fix|chore|docs|refactor|test|perf|build|ci|style|revert|release|hotfix)." >&2
      echo "[branch-guard] Override: BRANCH_GUARD_ALLOW_BADNAME=1" >&2
      exit 2
    fi
  fi

  # Block commit on all protected branches
  # Exception: allow merge commits (when .git/MERGE_HEAD exists — completing a git merge)
  if [[ "$IS_COMMIT" == "true" ]]; then
    MERGE_IN_PROGRESS=false
    [[ -f "$PROJECT_DIR/.git/MERGE_HEAD" ]] && MERGE_IN_PROGRESS=true
    if [[ "$MERGE_IN_PROGRESS" == "false" ]]; then
      for branch in main master develop; do
        if [[ "$CURRENT_BRANCH" == "$branch" ]]; then
          echo "[branch-guard] Blocked: cannot git commit on protected branch '${branch}'. Create a feature branch first." >&2
          exit 2
        fi
      done
    fi
  fi

  # Block push on main/master only (develop push after merge is allowed)
  # Exception: BRANCH_GUARD_ALLOW_MAIN_MERGE=1 for explicitly user-approved release pushes
  if [[ "$IS_PUSH" == "true" ]] && ! stmt_override BRANCH_GUARD_ALLOW_MAIN_MERGE; then
    for branch in main master; do
      if [[ "$CURRENT_BRANCH" == "$branch" ]]; then
        echo "[branch-guard] Blocked: cannot git push on protected branch '${branch}'." >&2
        exit 2
      fi
    done
  fi

  # Block merge into main/master (release merge requires explicit user approval via PR)
  # Exception: BRANCH_GUARD_ALLOW_MAIN_MERGE=1 for explicitly user-approved release merges
  if [[ "$IS_MERGE" == "true" ]] && ! stmt_override BRANCH_GUARD_ALLOW_MAIN_MERGE; then
    for branch in main master; do
      if [[ "$CURRENT_BRANCH" == "$branch" ]]; then
        echo "[branch-guard] Blocked: cannot git merge into '${branch}'. Use a PR or get explicit user approval for release merges." >&2
        exit 2
      fi
    done
  fi

done <<< "$STATEMENT_RANGES"

exit 0
