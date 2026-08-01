#!/bin/bash
# worktree-cwd-guard hook (HARNESS-043)
# Blocks DESTRUCTIVE git commands when a worktree-assigned subagent's cwd has silently fallen back
# to the MAIN checkout. This is the TYPE-003 incident: a subagent was assigned an isolated worktree,
# that worktree was externally cleaned/removed mid-session, the process cwd dropped to the main clone,
# and `git reset --hard` then ran against MAIN.
#
# Blocks: `git reset --hard`, `git clean -f[dx]`, `git checkout -- .`, `git push --force*`
# ONLY WHEN BOTH:
#   (a) the command's EFFECTIVE repo resolves to the MAIN checkout — its toplevel path is NOT under
#       `.claude/worktrees/`; AND
#   (b) a worktree-assignment marker is present — the `ROBOTA_AGENT_WORKTREE` env var is set. The
#       worktree launcher (Claude Code `Agent` tool `isolation: "worktree"`) SHOULD export
#       `ROBOTA_AGENT_WORKTREE=<assigned worktree path>` when spawning a worktree subagent, so this
#       guard can tell an assigned-worktree session apart from an ordinary main-clone session.
#
# FAIL-SAFE: if the guard cannot POSITIVELY confirm BOTH main-checkout AND an assigned-worktree
# marker, it does NOT block — ordinary destructive work in the main clone (no marker) and destructive
# work inside the assigned worktree both pass untouched.
#
# Inline override (same convention as branch-guard): prefix the command with
# `WORKTREE_CWD_GUARD_ALLOW_MAIN=1` for a deliberate main-checkout destructive op.
#
# Runs as a PreToolUse hook on Bash tool calls.
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
  echo "[worktree-cwd-guard] Blocked: the hook payload names no tool, so nothing can be judged." >&2
  exit 2
fi

if [[ "$TOOL_NAME" != "Bash" ]]; then
  exit 0
fi

# Extract command from tool_input.command
if ! COMMAND=$(hook_command_of "$INPUT"); then
  echo "[worktree-cwd-guard] Blocked: the tool command could not be decoded, so the command cannot be judged." >&2
  echo "[worktree-cwd-guard] Install jq or python3 so this guard can read what it is judging." >&2
  exit 2
fi

# The inline override is checked further down, AFTER the destructive command is identified — not
# here. It has to be, and the reason is the whole shape of this class:
#
#   - The `VAR=1` prefix runs in the TOOL's shell, not this hook's process, so a plain env check
#     never sees it (same reasoning as branch-guard's inline overrides).
#   - Read off the RAW command, a commit message that merely NAMED the token switched the guard off.
#     So it is read off the masked text.
#   - Read as a token ANYWHERE, an unquoted mention still disarmed it — `git commit -m TOKEN &&
#     git reset --hard`. So it must PREFIX a command.
#   - Read as "prefixes SOME git call", a decoy disarmed it — `TOKEN git status && git reset --hard`
#     puts the token on something harmless and the destructive command that follows is never judged.
#
# Each repair was correct and each left the next hole, because the question was being asked about
# the wrong subject. An override is given to ONE command: the one it precedes. So the only check
# that closes it is asked of the destructive statement itself.

# --- The shared stash ------------------------------------------------------------------------
#
# Checked BEFORE the worktree-session gate below, and that placement is the point: the hazard is not
# "I am inside a worktree", it is "this clone HAS more than one", which is equally true of the main
# checkout. A guard that only fired inside worktrees would miss the main clone racing them.
#
# `refs/stash` is a single ref on the shared object store. `worktree-parallel-orchestration` promises
# worktree-isolated agents, and the isolation is real for the working tree and the index — not for
# this. Measured 2026-08-01 during a five-agent wave: one agent's bare `git stash push` + `pop` took
# ANOTHER agent's uncommitted work into its own tree.
#
# git-branch.md has said "never a bare `git stash pop`, pop by explicit ref" since LESSON-005
# (2026-06-15), and an agent did it anyway ten weeks later, because the rule was written down and
# never mechanically reached. This is the reaching. (INFRA-082)
#
# Read-only subcommands (`list`, `show`) are untouched — they cannot move anyone's work.
# ONE reading, by the grammar (INFRA-075, #1572). This hook used to hold two: `VERBS` from the
# tokenizer and `SCAN` from two line-oriented passes that did no quote masking at all. Measured on a
# worktree session, with the bare form refused correctly:
#   git -C <MAIN> reset --hard                                 -> exit 2
#   echo "see <<EOF for details" ; git -C <MAIN> reset --hard  -> exit 0
# The quoted `<<EOF` opened a heredoc the old reading never saw close, so the `git -C <MAIN>` after it
# was deleted from the string this guard examined and the destructive command was allowed.
#
# Computed HERE, above the stash gate, and read by both checks. The stash block first ran the
# tokenizer a second time on the same text — and since it runs before the worktree-session gate, that
# doubled the cost on EVERY Bash call in every session, not only ones naming a stash. (#1585)
#
# Fail closed on an unreadable command: a non-zero return means the value could NOT be read, and a
# guard must refuse rather than treat it as an empty string that matches nothing.
if ! VERBS=$(hook_verb_scan "$COMMAND"); then
  echo "[worktree-cwd-guard] Blocked: the command could not be scanned, so nothing can be judged." >&2
  exit 2
fi
# ONE boundary pair, used by every match below.
#
# Review of #1585 found the entry gate missing the backtick, so `OUT=`git stash pop`` skipped the
# whole guard. Fixing that in place then left the SAME defect one line down — `pop` followed by a
# closing backtick failed the trailing `([[:space:]]|$)`. Five hand-written copies of "what ends a
# word" is five chances to disagree, and two of them already had. So they are written once.
#
# The leading class matches this file's GITPFX; the trailing one is GITEND's rule — anything that is
# not a word character or `-`, which covers the closing backtick, `)`, `;` and end of line.
STASH_PRE='(^|[;&|({"'"'"'`]|[[:space:]])[[:space:]]*([^[:space:]]+=)?[[:space:]]*'
STASH_END='([^-[:alnum:]_]|$)'
# `git`, INCLUDING the global flags that may precede a subcommand — the same tolerance GITPFX below
# already has. Written once and used by every match, because the fourth review finding on this change
# was that the entry gate lacked it: `git -C <sibling-worktree> stash pop` skipped the whole check,
# and a `-C` pointing at a sibling worktree is not an edge case — it is how one worktree reaches into
# another. Three earlier findings on this same block were the same shape: a rule this file already
# states, re-derived worse a few lines away. (#1585)
STASH_GIT='git[[:space:]]+((-C|-c)[[:space:]]+[^[:space:]]+[[:space:]]+)*stash'
if printf '%s' "$VERBS" | grep -qE "${STASH_PRE}${STASH_GIT}${STASH_END}"; then
  BARE_STASH=false
  # PER STATEMENT, and a comment is not a statement.
  #
  # The ref check asked whether `stash@{` occurred ANYWHERE in the command. So a bare pop travelled
  # free beside a well-formed sibling — `git stash pop; git stash pop stash@{0}` — and a trailing
  # `# stash@{0}` was enough on its own. This file had already met that class further down, for the
  # destructive-command override, and says so there: "the token sitting on a sibling command excuses
  # nothing". The new block did not reuse the split and reintroduced it. (#1585)
  #
  # One judgement, called once per BARE statement — because each is judged against ITS OWN
  # repository. Capturing the repo once let `git -C <scratch> stash push; git -C <shared> stash pop`
  # be judged entirely against the scratch repo, and the second, genuinely bare pop went through.
  stash_refuse_unless_single_worktree() {
    local repo="$1" list count
    if [[ -z "$repo" ]]; then
      # REFUSE, not fail-safe — and the difference from the destructive path is deliberate. A bare
      # pop always has a correct form (`stash@{N}`), so refusing costs the caller a ref they should
      # have written. A destructive command has no such substitute, which is why that path fails safe.
      echo "[worktree-cwd-guard] Blocked: a bare stash command, and no repository could be named," >&2
      echo "[worktree-cwd-guard] so a shared stack cannot be ruled out." >&2
      echo "[worktree-cwd-guard] Name an explicit ref: git stash pop stash@{N}   (git-branch.md)" >&2
      exit 2
    fi
    # `hook_git_in`, not a bare `git -C`: with `GIT_DIR` exported, `git -C <dir>` reports the OUTER
    # repository, so the count would be another clone's. INFRA-077 measured that, and this file's own
    # floor caught the line the moment it was written.
    #
    # Read the list first, THEN count it. `git … | grep -c . || echo 0` yields the two-line string
    # "0\n0" when git produces nothing — `grep -c` prints 0 AND exits 1, so the `||` fires as well —
    # and the arithmetic comparison then errors and the guard falls OPEN.
    if ! list=$(hook_git_in "$repo" worktree list 2>/dev/null); then
      echo "[worktree-cwd-guard] Blocked: cannot read the worktree list, so a shared stash cannot be" >&2
      echo "[worktree-cwd-guard] ruled out. Name an explicit ref: git stash pop stash@{N}" >&2
      exit 2
    fi
    count=$(printf '%s\n' "$list" | grep -c . || true)
    # A count that is not a number means the count was not read, and this file's stated policy is
    # that an unreadable subject is a refusal. No test covers this branch and saying so is the honest
    # form: `grep -c` always emits a number, so it is unreachable by construction. A test that
    # appeared to exercise it would be passing for some other reason — the first attempt at one did
    # exactly that, blocking because the fixture had two worktrees. (#1585)
    if [[ ! "$count" =~ ^[0-9]+$ ]]; then
      echo "[worktree-cwd-guard] Blocked: the worktree count could not be read, so a shared stash" >&2
      echo "[worktree-cwd-guard] cannot be ruled out. Name an explicit ref: git stash pop stash@{N}" >&2
      exit 2
    fi
    if [[ "$count" -gt 1 ]]; then
      echo "[worktree-cwd-guard] Blocked: a bare stash command while this clone has $count worktrees." >&2
      echo "[worktree-cwd-guard] refs/stash is SHARED across every worktree — a bare push or pop can" >&2
      echo "[worktree-cwd-guard] take another agent's uncommitted work. It has already happened once." >&2
      echo "[worktree-cwd-guard] Pop by explicit ref: git stash pop stash@{N}   (git-branch.md)" >&2
      echo "[worktree-cwd-guard] To save state instead, copy the files — no shared ref is involved." >&2
      exit 2
    fi
  }

  # The statements come from `hook_statement_ranges`, and every reader below is given that
  # statement's (START, LENGTH). The command is masked WHOLE and only the READING is narrowed.
  #
  # This replaces a `sed` split over the already-masked `$VERBS`, which was the root cause of the
  # last two review rounds and which `command-scan.sh` warns against by name: "a per-statement
  # judgement built by re-masking each slice would be a THIRD reading of a command, in the file whose
  # subject is that there must be one." Both findings followed from it — a comment pass that could
  # not tell a real comment from a `#` mid-word, and a `-C` extracted from mangled text where a
  # quoted path with a space came back as `\001` bytes. The window is the facility that already
  # exists for this. (#1585)
  #
  # Read from a here-string, never a PIPE: a `while` on the right of a pipe runs in a SUBSHELL, where
  # the `exit 2` of a refusal would end only that subshell and the hook would carry on and exit 0 —
  # a refusal that refuses nothing. `branch-guard.sh` records the same trap.
  STASH_RANGES=$(hook_statement_ranges "$COMMAND" || printf '')
  if [[ -z "${STASH_RANGES//[[:space:]]/}" ]]; then
    echo "[worktree-cwd-guard] Blocked: the command names a stash and could not be split into" >&2
    echo "[worktree-cwd-guard] statements, so nothing in it was judged. This is not a pass." >&2
    exit 2
  fi
  while read -r WSTART WLEN; do
    [[ -n "$WSTART" && -n "$WLEN" ]] || continue
    STMT=$(hook_verb_scan "$COMMAND" "$WSTART" "$WLEN" || printf '')
    printf '%s' "$STMT" | grep -qE "${STASH_PRE}${STASH_GIT}${STASH_END}" || continue
    STMT_BARE=false
    # A bare `git stash`, or one whose next word is a FLAG — `-u`, `--all`, `-k` are implicit pushes
    # with no subcommand keyword, and they add an entry another agent's bare pop can take. Matching
    # only the literal words `push`/`save` let every one of them through. (#1585)
    printf '%s' "$STMT" | grep -qE "${STASH_GIT}[[:space:]]*$" && STMT_BARE=true
    printf '%s' "$STMT" | grep -qE "${STASH_GIT}[[:space:]]*(\)|\`)" && STMT_BARE=true
    printf '%s' "$STMT" | grep -qE "${STASH_GIT}[[:space:]]+(push|save)${STASH_END}" && STMT_BARE=true
    printf '%s' "$STMT" | grep -qE "${STASH_GIT}[[:space:]]+-" && STMT_BARE=true
    # `clear` takes no argument and deletes EVERY entry, including ones another agent has not popped
    # yet — the worst of the set, and the one the first version of this list forgot.
    printf '%s' "$STMT" | grep -qE "${STASH_GIT}[[:space:]]+clear${STASH_END}" && STMT_BARE=true
    # `branch` and `pop`/`apply`/`drop` all take the TOP of the stack when no ref is named — and the
    # ref must be in THIS statement.
    if printf '%s' "$STMT" | grep -qE "${STASH_GIT}[[:space:]]+(pop|apply|drop|branch)${STASH_END}"; then
      printf '%s' "$STMT" | grep -qE 'stash@\{' || STMT_BARE=true
    fi
    [[ "$STMT_BARE" == "true" ]] || continue
    BARE_STASH=true
    # EVERY bare statement is judged against ITS OWN repository, not the first one's. Capturing the
    # `-C` once let `git -C <scratch> stash push; git -C <shared> stash pop` be judged entirely
    # against the scratch repo — the second, genuinely bare pop waved through. The `-C` is read from
    # the RAW command through this statement's window, so a quoted path with a space survives. (#1585)
    STASH_REPO=$(hook_effective_repo first-nonempty \
      "$(hook_git_c_path "$COMMAND" "$WSTART" "$WLEN" 2>/dev/null || printf '')" \
      "$(hook_cwd_of "$INPUT" 2>/dev/null || printf '')" \
      "${CLAUDE_PROJECT_DIR:-}" 2>/dev/null || printf '')
    stash_refuse_unless_single_worktree "$STASH_REPO"
  done <<< "$STASH_RANGES"
fi

# --- (b) worktree-assignment marker -------------------------------------------------------------
# Present iff this session was spawned as a worktree-assigned subagent. Absent → ordinary main-clone
# session → FAIL-SAFE, never block.
# The marker the original design hoped for — `ROBOTA_AGENT_WORKTREE`, exported by the launcher —
# is exported by nothing. Measured 2026-07-30: the only places that set it in this repository are
# this guard's own tests, so in every real session the variable was empty and the guard exited here
# before checking anything. Ten green tests, and a guard that had never once run (INFRA-068).
#
# The session's own cwd cannot answer the question, because a cwd that has fallen back to the main
# checkout is the very condition being guarded. What can answer it is WHICH COPY OF THIS HOOK IS
# RUNNING: a worktree session has `CLAUDE_PROJECT_DIR` pointing at its worktree, and
# `.claude/settings.json` invokes the hook through that variable — so the file executing right now
# lives under `.claude/worktrees/` exactly when this is a worktree session. That is supplied by the
# deployment rather than hoped for from it.
#
# The env marker is still honoured, for a launcher that does export it.
IN_WORKTREE_SESSION=false
SELF_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || echo "")
case "$SELF_DIR" in */.claude/worktrees/*) IN_WORKTREE_SESSION=true ;; esac
case "${CLAUDE_PROJECT_DIR:-}" in */.claude/worktrees/*) IN_WORKTREE_SESSION=true ;; esac
[[ -n "${ROBOTA_AGENT_WORKTREE:-}" ]] && IN_WORKTREE_SESSION=true

if [[ "$IN_WORKTREE_SESSION" != "true" ]]; then
  exit 0
fi

# --- Detect destructive git commands ------------------------------------------------------------

# GITPFX tolerates env prefixes and global git flags before the subcommand (`git -C <path> reset`,
# `git -c k=v push`) — the same pattern branch-guard uses.
#
# A newline is a boundary too. The command arrives decoded as JSON with real newlines, and
# is decoded as JSON now and carries real newlines, so grep's `^` is a line start and the second line
# of `cd <repo>` + newline + `git reset --hard` begins with no whitespace, no `;` and no `&`.
# Measured 2026-07-28: this guard was reachable from `;`, `&&` and env prefixes but silently bypassed
# by exactly that shape — and a destructive command on a later line of a block is the shape of the
# incident it exists to prevent.
# A quote and a backtick are boundaries too: a KEPT region — `bash -c "git push"`, or a backtick
# subshell — puts one immediately before the verb, and without them the region survived masking and
# still matched nothing. Quoted payloads are masked before this runs, so this cannot resurrect the
# false positive it sits beside.
GITPFX='(^|[[:space:];&|({"'"'"'`])([[:alnum:]_]+=[^[:space:]]+[[:space:]]+)*git[[:space:]]+((-C|-c)[[:space:]]+[^[:space:]]+[[:space:]]+)*'

IS_DESTRUCTIVE=false
# git reset --hard
printf '%s' "$VERBS" | grep -qE "${GITPFX}reset\b[^|;&]*--hard\b" && IS_DESTRUCTIVE=true
# git clean with a force flag (-f, -fd, -fdx, -xf, --force)
printf '%s' "$VERBS" | grep -qE "${GITPFX}clean\b[^|;&]*(-[[:alnum:]]*f|--force)" && IS_DESTRUCTIVE=true
# git checkout -- <path> (discards working-tree changes, e.g. `git checkout -- .`)
printf '%s' "$VERBS" | grep -qE "${GITPFX}checkout\b[^|;&]*[[:space:]]--([[:space:]]|$)" && IS_DESTRUCTIVE=true
# git push --force / --force-with-lease
printf '%s' "$VERBS" | grep -qE "${GITPFX}push\b[^|;&]*--force" && IS_DESTRUCTIVE=true

if [[ "$IS_DESTRUCTIVE" != "true" ]]; then
  exit 0
fi

# --- The inline override, asked of the destructive statement itself ------------------------------
# Split on statement separators and judge each statement alone. A statement that is destructive is
# excused only if the override prefixes THAT statement; the token sitting on a sibling command
# excuses nothing. Every destructive statement must carry it, so a decoy plus a real one still
# refuses. See the note above for the three earlier readings this replaces.
OVERRIDE_RE='^[[:space:]]*([[:alnum:]_]+=[^[:space:]]+[[:space:]]+)*WORKTREE_CWD_GUARD_ALLOW_MAIN=1[[:space:]]'
DESTRUCTIVE_STATEMENTS=0
OVERRIDDEN_STATEMENTS=0
while IFS= read -r STATEMENT; do
  [[ -z "${STATEMENT//[[:space:]]/}" ]] && continue
  IS_STMT_DESTRUCTIVE=false
  printf '%s' "$STATEMENT" | grep -qE "${GITPFX}reset\b.*--hard\b" && IS_STMT_DESTRUCTIVE=true
  printf '%s' "$STATEMENT" | grep -qE "${GITPFX}clean\b.*(-[[:alnum:]]*f|--force)" && IS_STMT_DESTRUCTIVE=true
  printf '%s' "$STATEMENT" | grep -qE "${GITPFX}checkout\b.*[[:space:]]--([[:space:]]|$)" && IS_STMT_DESTRUCTIVE=true
  printf '%s' "$STATEMENT" | grep -qE "${GITPFX}push\b.*--force" && IS_STMT_DESTRUCTIVE=true
  [[ "$IS_STMT_DESTRUCTIVE" != "true" ]] && continue
  DESTRUCTIVE_STATEMENTS=$((DESTRUCTIVE_STATEMENTS + 1))
  if printf '%s' "$STATEMENT" | grep -qE "$OVERRIDE_RE"; then
    OVERRIDDEN_STATEMENTS=$((OVERRIDDEN_STATEMENTS + 1))
  fi
# `%s\n`, not `%s`: without a trailing newline `read` drops the final line, which for a single-
# statement command is the only line there is — the override would then never be seen and an
# ordinary, correct invocation would be refused.
done < <(printf '%s\n' "$VERBS" | sed -E 's/(\|\||&&|[;&|])/\n/g')

if [[ "$DESTRUCTIVE_STATEMENTS" -gt 0 && "$OVERRIDDEN_STATEMENTS" -eq "$DESTRUCTIVE_STATEMENTS" ]]; then
  exit 0
fi

# --- Resolve the EFFECTIVE dir the command will actually run in ----------------------------------
# Precedence (worktree-aware, same intent as branch-guard/pre-push-check): `git -C <path>` in the
# command > hook-input `cwd` > CLAUDE_PROJECT_DIR. Unlike branch-guard, we do NOT fall back to `.`
# (the hook's OWN process dir): `.` is wherever the hook binary runs, not where the tool command runs
# — resolving its toplevel would judge an unrelated checkout (this caused a fail-safe bug: a non-git
# cwd fell back to `.`, which resolved to the hook's own checkout and blocked). If no concrete dir can
# be named, we cannot positively confirm anything → FAIL-SAFE, do not block.
HOOK_CWD=$(hook_cwd_of "$INPUT" || true)
# Unanchored: `git -C <path>` is almost never the first thing on the line. Anchored, the highest-
# precedence input to this resolution was never available, so a `cd <worktree> && git -C <main> reset
# --hard` — the exact cross-checkout shape this guard exists for — resolved to the worktree and passed.
# `|| true` is load-bearing: grep exits 1 when there is no `-C`, and under `set -euo pipefail` a
# failed command substitution aborts the hook silently before any check runs.
# One extractor, matched against a masked command so a quoted mention of `git -C` cannot
# redirect this guard at another repository. The RAW command goes in: `hook_git_c_path` masks it
# itself, by the grammar, and handing it a string a second reader had already mangled was the
# bypass above. See lib/command-scan.sh.
GIT_C_PATH=$(hook_git_c_path "$COMMAND" || true)
# The `first-nonempty` mode, named rather than flattened into the validating one its siblings use.
# It is this guard's FAIL-SAFE and the paragraph above is its reason: this hook blocks only on
# POSITIVE confirmation, so naming an unresolvable `-C` target and then declining to block is the
# correct outcome, where validating would silently retarget the guard at the session repository and
# block a destructive command aimed somewhere else. It has no `.` fallback for the same reason.
EFFECTIVE_DIR=$(hook_effective_repo first-nonempty "$GIT_C_PATH" "$HOOK_CWD" "${CLAUDE_PROJECT_DIR:-}")

# No nameable effective dir → cannot positively confirm main-checkout → FAIL-SAFE.
if [[ -z "$EFFECTIVE_DIR" ]]; then
  exit 0
fi

# --- (a) is the effective repo the MAIN checkout? -----------------------------------------------
# Positively resolve the repo toplevel of the EFFECTIVE dir. If the dir is not inside a git work tree
# (empty/error) → cannot positively confirm main-checkout → FAIL-SAFE, do not block.
TOPLEVEL=$(hook_git_in "$EFFECTIVE_DIR" rev-parse --show-toplevel 2>/dev/null || echo "")
if [[ -z "$TOPLEVEL" ]]; then
  exit 0
fi

# Under `.claude/worktrees/` → the assigned worktree, not main → allow.
if printf '%s' "$TOPLEVEL" | grep -q '/\.claude/worktrees/'; then
  exit 0
fi

# Both conditions positively confirmed: destructive command + assigned-worktree marker +
# effective repo is the MAIN checkout. This is the silent-cwd-fallback incident → BLOCK.
echo "[worktree-cwd-guard] Blocked: a DESTRUCTIVE git command resolved to the MAIN checkout" >&2
echo "[worktree-cwd-guard]   effective repo: $TOPLEVEL" >&2
# Named however this session was identified. The env marker is optional now — the copy of the hook
# that is running is the signal that actually arrives — and referencing it bare aborted the script
# under `set -u` AFTER the refusal had printed, turning a considered exit 2 into a bare exit 1.
ASSIGNED_WORKTREE="${ROBOTA_AGENT_WORKTREE:-${CLAUDE_PROJECT_DIR:-$SELF_DIR}}"
echo "[worktree-cwd-guard]   assigned worktree: $ASSIGNED_WORKTREE" >&2
echo "[worktree-cwd-guard] Your worktree session's cwd appears to have fallen back to the main clone" >&2
echo "[worktree-cwd-guard] (the assigned worktree was likely removed). Running this here would damage MAIN." >&2
echo "[worktree-cwd-guard] Fix: cd back into your assigned worktree ('$ASSIGNED_WORKTREE') and re-run;" >&2
echo "[worktree-cwd-guard] if the worktree is gone, re-create it (git worktree add) or restart the task." >&2
echo "[worktree-cwd-guard] Deliberate main-checkout op? Prefix: WORKTREE_CWD_GUARD_ALLOW_MAIN=1 <cmd>" >&2
exit 2
