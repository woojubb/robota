#!/bin/bash
# branch-guard hook
# Blocks git commit on protected branches (main, master, develop).
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
GITPFX='(^|[;&|({"'"'"'`]|[[:space:]])[[:space:]]*(\S+=\S+\s+)*git\s+((-C|-c)\s+\S+\s+)*'
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
RE_CREATE="${GITPFX}(checkout\s+(-\S+\s+)*-[bB]|switch\s+(-\S+\s+)*-[cC])${GITEND}"
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
STATEMENT_RANGES=$(hook_statement_ranges "$COMMAND" || printf '')
if [[ -z "${STATEMENT_RANGES//[[:space:]]/}" ]]; then
  echo "[branch-guard] Blocked: the command could not be split into statements, so nothing in it" >&2
  echo "[branch-guard] was judged. Nothing was verified; this is not a pass." >&2
  exit 2
fi

while read -r STMT_START STMT_LEN; do
  STMT_MASK=$(hook_verb_scan "$COMMAND" "$STMT_START" "$STMT_LEN")

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
  GIT_C_PATH=$(hook_git_c_path "$COMMAND" "$STMT_START" "$STMT_LEN" || true)
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

  if [[ "$IS_GH_DELETE_BRANCH" == "true" ]]; then
    echo "[branch-guard] Blocked: '--delete-branch' is prohibited in 'gh pr merge'. Zero exceptions." >&2
    echo "[branch-guard] It once deleted the develop integration branch. Merge without it, then delete" >&2
    echo "[branch-guard] only on explicit user request: git branch -D <name> (local) /" >&2
    echo "[branch-guard] gh api -X DELETE repos/<owner>/<repo>/git/refs/heads/<name> (remote)." >&2
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
  DELETE_BRANCH_NAME=$(hook_deleted_branch "$COMMAND" "$STMT_START" "$STMT_LEN" || true)

  if [[ -n "$DELETE_BRANCH_NAME" ]] && ! stmt_override BRANCH_GUARD_ALLOW_DELETE; then
    if printf '%s' "$DELETE_BRANCH_NAME" | grep -qE '^(main|master|develop|gh-pages)$'; then
      echo "[branch-guard] Blocked: refusing to delete protected branch '$DELETE_BRANCH_NAME'." >&2
      exit 2
    fi
    MERGED_COUNT=""
    if command -v gh >/dev/null 2>&1; then
      MERGED_COUNT=$(gh pr list --head "$DELETE_BRANCH_NAME" --state merged --json number --jq 'length' 2>/dev/null || echo "")
    fi
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
    OPEN_COUNT=""
    if command -v gh >/dev/null 2>&1; then
      OPEN_COUNT=$(gh pr list --head "$DELETE_BRANCH_NAME" --state open --json number --jq 'length' 2>/dev/null || echo "")
    fi
    if [[ -z "$OPEN_COUNT" ]]; then
      echo "[branch-guard] Blocked: cannot confirm whether an OPEN PR exists for '$DELETE_BRANCH_NAME' (gh unavailable / query failed)." >&2
      echo "[branch-guard] Unable to determine is not the same as safe. Check by hand, then override: BRANCH_GUARD_ALLOW_DELETE=1" >&2
      exit 2
    fi
    if [[ "$OPEN_COUNT" != "0" ]]; then
      OPEN_LIST=$(gh pr list --head "$DELETE_BRANCH_NAME" --state open --json number,mergeStateStatus \
        --jq '[.[] | "#\(.number) (\(.mergeStateStatus))"] | join(", ")' 2>/dev/null || echo "")
      echo "[branch-guard] Blocked: '$DELETE_BRANCH_NAME' still has an OPEN PR — $OPEN_LIST." >&2
      echo "[branch-guard] Deleting it now CLOSES that PR. A merged PR earlier in this branch's history does not make deletion safe." >&2
      echo "[branch-guard] Merge or close it deliberately first. Intentional abandon? Override: BRANCH_GUARD_ALLOW_DELETE=1" >&2
      exit 2
    fi
    # A merged PR exists AND nothing is open on the branch → deletion is safe. Fall through.
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
    MERGED_REFS=""
    MERGED_REFS_READ=false
    MERGED_LIMIT=500
    #
    # Bounded, because this runs on every branch creation. Before this check the path was entirely
    # local; it now makes a network call, and a SLOW response is not a failed one — without a limit a
    # stalled connection would hang the hook indefinitely instead of taking the fallback below.
    #
    # The bound is hand-rolled rather than delegated to `timeout`, which is absent on a stock macOS.
    # Branching on whether it exists would leave the promise above true on one platform and silently
    # false on another, with the untested path being the one nobody runs — the shape of defect this
    # directory has spent the week removing. One path, everywhere.
    GH_TIMEOUT=10
    bounded_merged_refs() {
      local out pid watcher rc
      out=$(mktemp) || return 1
      (gh pr list --state merged --limit "$MERGED_LIMIT" --json headRefName,headRefOid \
        --jq '.[] | "\(.headRefName) \(.headRefOid)"' >"$out" 2>/dev/null) &
      pid=$!

      # A watchdog rather than a `kill -0` polling loop. Polling asks "is the child still alive", and a
      # child that has exited but not yet been reaped can still answer yes — on a shell where it does,
      # every successful query would burn the whole deadline and then be thrown away as a timeout, so
      # the feature would always fall back and every branch creation would cost ten seconds. Measured
      # here at 1.2s with the polling version, so it did not reproduce on this bash; `wait` removes the
      # question rather than leaving it to the platform, and returns the instant the query finishes.
      # stdout detached deliberately. This function runs inside a command substitution, and a command
      # substitution does not return until EVERY process holding the write end of its pipe is gone —
      # so a watchdog inheriting that pipe kept it open for the full deadline even after the query had
      # answered and the watchdog itself was killed, because the `sleep` it spawned still held the fd.
      # Measured: the success path took 10.2s that way, worse than the polling it replaced.
      (
        sleep "$GH_TIMEOUT"
        kill -TERM "$pid" 2>/dev/null || true
      ) >/dev/null 2>&1 &
      watcher=$!

      if wait "$pid"; then rc=0; else rc=1; fi
      kill -TERM "$watcher" 2>/dev/null || true
      wait "$watcher" 2>/dev/null || true

      if [[ "$rc" -eq 0 ]]; then
        cat "$out"
        rm -f "$out"
        return 0
      fi
      rm -f "$out"
      return 1
    }

    if command -v gh >/dev/null 2>&1; then
      if MERGED_REFS=$(bounded_merged_refs); then
        MERGED_REFS_READ=true
      fi
    fi

    # A full page may mean the list was truncated, so older merged branches would be missing and the
    # check would over-report again — without the notice that explains why. Say it rather than let the
    # list quietly grow back.
    MERGED_TRUNCATED=false
    if [[ "$MERGED_REFS_READ" == "true" ]] &&
      [[ "$(printf '%s\n' "$MERGED_REFS" | grep -c .)" -ge "$MERGED_LIMIT" ]]; then
      MERGED_TRUNCATED=true
    fi

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
      # A merged PR settles it — for the COMMIT that was merged, not for the name.
      if [[ "$MERGED_REFS_READ" == "true" ]]; then
        candidate_sha=$(hook_git_in "$PROJECT_DIR" rev-parse "$candidate" 2>/dev/null || echo "")
        if [[ -n "$candidate_sha" ]] &&
          printf '%s\n' "$MERGED_REFS" | grep -Fxq -- "$candidate $candidate_sha"; then
          continue
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
      echo "[branch-guard] After squash-merge via PR, delete the local branch: git branch -D <name>" >&2
      if [[ "$MERGED_REFS_READ" != "true" ]]; then
        echo "[branch-guard] NOTE: merged PRs could not be read, so squash-merged branches are listed" >&2
        echo "[branch-guard] here as unmerged. The list is longer than the real backlog." >&2
      elif [[ "$MERGED_TRUNCATED" == "true" ]]; then
        echo "[branch-guard] NOTE: the merged-PR list came back full ($MERGED_LIMIT), so older merged" >&2
        echo "[branch-guard] branches may be missing from it and listed here as unmerged." >&2
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
    NEW_BRANCH=$(hook_match_extract "$COMMAND" \
      '(^|[ \t;&|({\n"\047`])git[ \t]+((-C|-c)[ \t]+[^ \t\n]+[ \t]+|-[^ \t\n]+[ \t]+)*(checkout|switch)[ \t]+(-[^ \t\n]+[ \t]+)*-[bBcC][ \t]+' \
        "$STMT_START" "$STMT_LEN" || true)
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
      START_POINT=$(hook_match_extract "$COMMAND" \
        '(^|[ \t;&|({\n"\047`])git[ \t]+((-C|-c)[ \t]+[^ \t\n]+[ \t]+|-[^ \t\n]+[ \t]+)*(checkout|switch)[ \t]+(-[^ \t\n]+[ \t]+)*-[bBcC][ \t]+[^ \t\n]+[ \t]+(-[^ \t\n]+[ \t]+)*' \
          "$STMT_START" "$STMT_LEN" || true)
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
