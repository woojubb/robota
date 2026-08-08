#!/bin/bash
# worktree-cwd-guard hook (HARNESS-043)
# Blocks DESTRUCTIVE git commands when a worktree-assigned subagent's cwd has silently fallen back
# to the MAIN checkout. This is the TYPE-003 incident: a subagent was assigned an isolated worktree,
# that worktree was externally cleaned/removed mid-session, the process cwd dropped to the main clone,
# and `git reset --hard` then ran against MAIN.
#
# Blocks: `git reset --hard`, `git clean` with a force flag, `git checkout -- <path>`, and
# `git push` with a force flag — where "a force flag" means `--force*` OR any short bundle
# containing `f`, because `git push -f` is the same command and was permitted until an audit
# measured it.
# ONLY WHEN BOTH:
#   (a) the STATEMENT's effective repo resolves to the MAIN checkout — its toplevel path is NOT
#       under `.claude/worktrees/`. Per statement, not per command: a `-C` read from the whole
#       string let one statement's harmless `-C <worktree>` speak for a destructive sibling's; AND
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
# The leading class is what may sit immediately before a `git`; the trailing one is anything that is
# not a word character or `-`, which covers the closing backtick, `)`, `;` and end of line.
STASH_PRE='(^|[;&|({"'"'"'`]|[[:space:]])[[:space:]]*([^[:space:]]+=)?[[:space:]]*'
STASH_END='([^-[:alnum:]_]|$)'
# `git`, INCLUDING the global flags that may precede a subcommand — the same tolerance
# `statement_is_destructive` below reaches by skipping them in the word list. Written once and used
# by every match, because the fourth review finding on this change
# was that the entry gate lacked it: `git -C <sibling-worktree> stash pop` skipped the whole check,
# and a `-C` pointing at a sibling worktree is not an edge case — it is how one worktree reaches into
# another. Three earlier findings on this same block were the same shape: a rule this file already
# states, re-derived worse a few lines away. (#1585)
STASH_GIT='git[[:space:]]+((-C|-c)[[:space:]]+[^[:space:]]+[[:space:]]+)*stash'

# EVERY branch a statement could move HEAD to, one per line. Returns 1 when it names none.
#
# ALL of them, and asked of the STATEMENT rather than of one invocation — the same correction the
# destructive judgement below needed, and review found this function still had the defect after its
# neighbour was fixed. `hook_statement_all_words` flattens a substitution into the same word stream,
# so a `git` inside one used to clear the verb and the next word ended the reading:
#
#   git checkout $(git config user.name) held-branch; git reset --hard
#     words: git checkout git config user.name held-branch
#     old:   the inner `git` cleared the verb, `config` hit the "other subcommand" exit, return 1
#     now:   `checkout` was seen, so `user.name` and `held-branch` are both candidates
#
# Returning every candidate rather than the first is what makes that safe: with a substitution
# flattened in, which word git will treat as the ref is not decidable here, and a guard that has to
# guess should check them all. A word that merely coincides with a held branch name costs a
# refusal; the branch actually held costs the incident this block exists to prevent.
#
# The shapes that reach a ref another worktree may hold:
#
#   git checkout <ref>            the bare form
#   git checkout -b|-B <name>     create/reset — `-B` is refused for a held branch exactly as a
#   git switch   -c|-C <name>     plain checkout is, because HEAD still has to move there
#   git checkout -t <ref>         `--track` without `-b` derives the branch FROM that ref, so its
#                                 value is a candidate rather than a throwaway (review)
#
# A restore — `git checkout <ref> -- <path>` — is NOT a switch: it succeeds while a sibling worktree
# holds that ref, so a bare `--` in the statement ends the reading. `git checkout -- .` reaches this
# same exit, and is the DESTRUCTIVE block's subject rather than this one's.
checkout_targets_in_words() {
  local seen_git=false saw_verb=false want="" word
  # The `--` question is POSITIONAL, and review walked through why twice.
  #
  # In `git checkout <ref> -- <path>` the ref comes BEFORE the separator, so an exemption that ends
  # the whole reading exempts too much: `hook_statement_all_words` flattens substitutions into the
  # same word list, so a `--` INSIDE one — `git checkout $(git log --oneline -- README.md) <held>` —
  # switched the old pre-scan off before the real target was ever read, and the exact accident this
  # block exists for sailed through. The rest of this file already accepts the consequence of
  # flattening — every candidate is checked, because nothing can tell which word is the real
  # argument — and an early return was this one function voting the other way.
  #
  # So: candidates BEFORE the first `--` are the restore-ref reading and are exempt; words AFTER it
  # stay candidates. A false candidate costs nothing unless it coincides with a branch another
  # worktree holds, which is the same trade every other candidate from a substitution already makes.
  #
  # A trailing `--` with NOTHING after it exempts nobody: that is git's own revision/path
  # disambiguation and the command is still an ordinary switch (the previous round's finding).
  local separator_seen=false word_after_separator=false
  local -a pre=() post=()
  while IFS= read -r word; do
    case "$want" in
      # A flag whose value is a branch git will move HEAD to.
      target)
        want=""
        if [[ "$separator_seen" == "true" ]]; then post+=("$word"); else pre+=("$word"); fi
        continue
        ;;
      # A flag whose value is something else entirely — an upstream, a start point.
      skip)
        want=""
        continue
        ;;
    esac
    case "$word" in
      git | */git)
        seen_git=true
        continue
        ;;
    esac
    [[ "$seen_git" == "true" ]] || continue
    # BEFORE the verb, `-c`/`-C` are git's global options and consume the next word. AFTER it they
    # are `switch`'s create flags and the next word is the BRANCH. Ordering these the other way
    # round made `git switch -c <held>` read the branch as a throwaway config value — measured,
    # exit 0, a regression this probe caught between one edit and the next.
    if [[ "$saw_verb" != "true" ]]; then
      case "$word" in
        -C | -c | --git-dir | --work-tree | --namespace | --exec-path)
          want=skip
          continue
          ;;
        checkout | switch)
          saw_verb=true
          continue
          ;;
      esac
      continue
    fi
    if [[ "$separator_seen" == "true" && -n "$word" ]]; then
      word_after_separator=true
    fi
    case "$word" in
      --)
        separator_seen=true
        ;;
      -b | -B | --orphan | -t | --track) want=target ;;
      -c | -C) want=target ;;
      --conflict | --pathspec-from-file) want=skip ;;
      -*) ;;
      *'>'* | *'<'* | '') ;;
      *)
        if [[ "$separator_seen" == "true" ]]; then post+=("$word"); else pre+=("$word"); fi
        ;;
    esac
  done <<< "$1"

  local -a candidates=()
  if [[ "$separator_seen" == "true" && "$word_after_separator" == "true" ]]; then
    # Restore-shaped: what precedes the separator is the ref being read FROM, which a sibling
    # worktree may legitimately hold. What follows is still checked, because a flattened
    # substitution can put the real switch target there.
    candidates=("${post[@]+"${post[@]}"}")
  else
    candidates=("${pre[@]+"${pre[@]}"}")
  fi
  [[ ${#candidates[@]} -gt 0 ]] || return 1
  local candidate
  for candidate in "${candidates[@]}"; do
    printf '%s\n' "$candidate"
  done
}

# --- A checkout that fails, in a command that keeps going ---------------------------------------
#
# A branch checked out by another worktree cannot be checked out here — git refuses it. On its own
# that is fine: the command fails and nothing happened. In a COMPOUND command it is not, because the
# statements after it still run, against whatever branch is actually checked out. That is how a
# `reset --hard` intended for one branch landed on another.
#
# So the block is narrow on purpose: a bare failing checkout is left alone (git's own error IS the
# whole outcome), and only a checkout with something after it is refused.
# A NEWLINE is a separator too, and this file already says so where it splits statements — the
# same reading was re-derived here and came out worse, which is the recurring defect in this file.
# `grep -c ''` counts lines: more than one means the command continues past the checkout.
#
# A BARE PIPE is a continuation as well, and review found it missing: `git checkout <held> | git
# reset --hard` never entered this block, and the destructive judgement that would otherwise catch
# it sits behind the worktree-session gate — so outside such a session neither block saw it. `|` is
# in the alternation now, and `||` still matches because the alternation tries it first.
#
# And a BARE `&`, which review found missing one round later — the third separator to be added one
# at a time. `git checkout <held> & git reset --hard` separates the statements like `;` does, except
# worse: it does not even wait for the checkout to fail before running what follows. Each of these
# came from re-deriving "what continues a command" instead of asking the one place that already
# knows, which is this file's recurring defect; the class is closed by the character class carrying
# every separator the statement splitter recognises, not by the latest instance.
if printf '%s' "$COMMAND" | grep -qE '(\|\||&&|[;|&])' ||
  [[ "$(printf '%s' "$COMMAND" | grep -c '')" -gt 1 ]]; then
  # PER STATEMENT, and every one of them. The first version read only the FIRST checkout in the
  # command (`head -1`) and applied the restore exemption to the WHOLE string, so one harmless
  # `git checkout -- README.md` in front erased the detection of a real switch behind it:
  #
  #   git checkout -- README.md; git checkout <held-branch>; git reset --hard   -> permitted
  #
  # Review found it, measured. This file already learned the same lesson twice — the stash check and
  # the override both say "the token sitting on a sibling command excuses nothing" — and the reading
  # was re-derived here without it.
  #
  # The branch is read from the WORD LIST, not from a regex over the text, for the same reason the
  # destructive judgement below is: a regex reads what a name looks like, and the question is which
  # word git will treat as the target.
  #
  # The regex this replaces took the token immediately after `checkout`/`switch`, bounded by what a
  # ref name may contain. Two findings followed. Read loosely it had swallowed the separator —
  # `git checkout foo; git reset` yielded `foo;`, matching no branch, so the block silently passed
  # the exact command it exists to refuse. And bounded, it still required the name to come FIRST, so
  # a flag in front of it ended the match at a `-`:
  #
  #   git checkout -B held-branch; git reset --hard    -> permitted (RAN: exit 0)
  #   git switch -c held-branch; git reset --hard      -> permitted (RAN: exit 0)
  #
  # Both are the hazard verbatim. git refuses `-B`/`-c` onto a branch another worktree holds just as
  # it refuses a plain checkout — moving HEAD to that ref is what is blocked — and the statements
  # after it still run against whatever is actually checked out.
  #
  # And the repository is resolved PER STATEMENT. `CHECKOUT_REPO` used to pass `""` for the `-C`
  # while the extraction regex two lines below explicitly matched `git -C <path> checkout <ref>`, so
  # a checkout naming another repository was looked up in this one: both the branch-held question
  # and the already-on-it exemption were answered about the wrong repo. RAN: `git -C <other>
  # checkout <branch held in other's sibling>; git status` was exit 0.
  CHECKOUT_TARGET=""
  CHECKOUT_RANGES=$(hook_statement_ranges "$COMMAND" || printf '')
  # How many statements there are, so the loop can tell a checkout that has something AFTER it from
  # one that is simply last. The block's own premise is "the statements after it still run"; a
  # held-branch checkout with nothing after it fails and that failure IS the whole outcome, which is
  # what the bare-command case at the top already says. Review found the loop refusing it anyway.
  CHECKOUT_STATEMENT_COUNT=$(printf '%s\n' "$CHECKOUT_RANGES" | grep -c '[^[:space:]]' || printf '0')
  # FAIL-CLOSED on an unsplittable command, like the destructive block below and unlike the first
  # version of this one. `|| printf ''` alone turned "could not split" into "no statements" and
  # permitted the whole command — the asymmetry review pointed out, in the file whose repeated line
  # is that what cannot be measured is not a pass.
  if [[ -z "${CHECKOUT_RANGES//[[:space:]]/}" ]]; then
    echo "[worktree-cwd-guard] Blocked: the command could not be split into statements, so which" >&2
    echo "[worktree-cwd-guard] branch it checks out was never determined. This is not a pass." >&2
    exit 2
  fi
  CHECKOUT_STATEMENT_INDEX=0
  while read -r CO_START CO_LEN; do
    [[ -n "$CO_START" && -n "$CO_LEN" ]] || continue
    CHECKOUT_STATEMENT_INDEX=$((CHECKOUT_STATEMENT_INDEX + 1))
    # Nothing runs after the LAST statement, so a held checkout there is git's own error and no
    # more. Judging it would refuse `echo build; git checkout <held>` — correct work, and the shape
    # that gets a guard turned off.
    [[ "$CHECKOUT_STATEMENT_INDEX" -ge "$CHECKOUT_STATEMENT_COUNT" ]] && break
    if ! CO_WORDS=$(hook_statement_all_words "$COMMAND" "$CO_START" "$CO_LEN" && printf '\001'); then
      echo "[worktree-cwd-guard] Blocked: a statement could not be split into words, so which branch" >&2
      echo "[worktree-cwd-guard] it checks out was never read. This is not a pass." >&2
      exit 2
    fi
    CO_WORDS=${CO_WORDS%$'\n\001'}

    CANDIDATES=$(checkout_targets_in_words "$CO_WORDS") || CANDIDATES=""
    [[ -n "$CANDIDATES" ]] || continue

    # The `-C` of THIS statement, then the session's own directory.
    CHECKOUT_REPO=$(hook_effective_repo first-nonempty \
      "$(hook_git_c_path "$COMMAND" "$CO_START" "$CO_LEN" 2>/dev/null || printf '')" \
      "$(hook_cwd_of "$INPUT" 2>/dev/null || printf '')" \
      "${CLAUDE_PROJECT_DIR:-}" 2>/dev/null || printf '')
    [[ -n "${CHECKOUT_REPO:-}" ]] || continue

    # EVERY candidate this statement names, because with a substitution flattened into the word
    # stream which one git will treat as the ref is not decidable here. One `worktree list` per
    # statement, not per candidate.
    HELD=$(hook_git_in "$CHECKOUT_REPO" worktree list --porcelain 2>/dev/null || printf '')
    CURRENT=$(hook_git_in "$CHECKOUT_REPO" rev-parse --abbrev-ref HEAD 2>/dev/null || true)
    while IFS= read -r CANDIDATE; do
      [[ -n "$CANDIDATE" ]] || continue
      printf '%s\n' "$HELD" | grep -qxF "branch refs/heads/${CANDIDATE}" || continue
      [[ "$CURRENT" == "$CANDIDATE" ]] && continue
      CHECKOUT_TARGET="$CANDIDATE"
      break
    done <<< "$CANDIDATES"
    [[ -n "$CHECKOUT_TARGET" ]] && break
  done <<< "$CHECKOUT_RANGES"
  if [[ -n "$CHECKOUT_TARGET" ]]; then
    echo "[worktree-cwd-guard] Blocked: '${CHECKOUT_TARGET}' is checked out in another worktree, so" >&2
    echo "[worktree-cwd-guard] this checkout FAILS — and the rest of this compound command still runs," >&2
    echo "[worktree-cwd-guard] against whatever branch is actually checked out. A reset --hard landed" >&2
    echo "[worktree-cwd-guard] on the wrong branch exactly this way." >&2
    echo "[worktree-cwd-guard] Run the work in that worktree, or split this into separate commands." >&2
    exit 2
  fi
fi
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

# --- What makes a git invocation destructive ----------------------------------------------------
#
# ONE judgement, asked of the TOKENIZER rather than matched with a regex over the raw text — and
# asked once, not twice. This file used to hold the same four rules written out in two places: a
# whole-command pass that decided IS_DESTRUCTIVE, and a second per-statement pass that decided
# whether the inline override excused it. They differed only in the window between tokens
# (`[^|;&]*` against `.*`), and the difference was a real drift the duplication itself created —
# `git checkout --;ls` matched the override copy and not the entry-gate copy, so the gate the
# command had to pass first never saw it.
#
# Between them the two copies missed three shapes an audit MEASURED as exit 0:
#
#   git push -f origin develop     the short flag; the rule was literally `push\b[^|;&]*--force`,
#                                  while the `clean` rule two lines up WAS bundle-aware
#   git clean 2>&1 -fd             a redirect between the verb and its flag
#   git reset 2>&1 --hard          the same, on the rule this guard exists for
#
# A word list has no window to get wrong: a flag was PASSED or it was not. `hook_statement_all_words`
# and not `hook_statement_words`, because a destructive verb inside a substitution RUNS —
# `echo "$(git reset --hard)"` resets — and the substitution-excluding reading returns `echo|""`
# there. Measured both ways before choosing.
#
# Quoted content is hidden by the tokenizer, so `git commit -m "do not git push -f"` builds the
# words `git|commit|-m|""` and is not a force-push. That is the false positive this whole approach
# is judged on, and it has a case.

# `--force`, `--force-with-lease`, `--force-if-includes`, and any short bundle containing `f`
# (`-f`, `-fd`, `-xf`). The bundle test requires a SHORT flag — a single leading `-` — so
# `--follow-tags` is not a force push.
#
# A bundle is read only up to the first VALUE-TAKING letter, and review supplied the counterexample:
# `git push -octi.skip=false` is `-o` (push-option) carrying a value that happens to contain an `f`,
# and `git clean -e*.conf` is `-e` (exclude) the same way. `*f*` over the whole token read both as
# force. `o` and `e` end the flag reading because everything after them is the VALUE — so `-fo…` is
# still force (the `f` stands on its own) while `-of…` is an option value that starts with f.
is_force_flag() {
  case "$1" in
    --force | --force=* | --force-*) return 0 ;;
    -[!-]*)
      local letters="${1#-}" i ch
      for ((i = 0; i < ${#letters}; i++)); do
        ch="${letters:i:1}"
        case "$ch" in
          f) return 0 ;;
          o | e) return 1 ;;
        esac
      done
      ;;
  esac
  return 1
}

# Whether a statement's word list contains a destructive git invocation.
#
# The question is asked of the STATEMENT, not of one invocation inside it: a verb seen anywhere in
# the statement arms its flags for the rest of it. That is not a simplification, it is the only
# model this word list can support — and getting it wrong was a review finding on the first version.
#
# The first version tracked "the verb of the invocation being read" and reset it at every `git`
# token. `hook_statement_all_words` flattens a substitution into the SAME word stream, and an
# UNQUOTED one leaves no boundary marker at all. MEASURED:
#
#   git reset $(git rev-parse HEAD~1) --hard   ->  git|reset|git|rev-parse|HEAD~1|--hard
#   git push $(git remote) -f main             ->  git|push|git|remote|-f|main
#
# The substitution's `git` reset the verb, `rev-parse` was adopted as the new one, and `--hard`
# matched nothing. Both were exit 0. There is no way to tell that nested `git` from a sequential one
# at this level, so the per-invocation model cannot be recovered — the statement is the unit.
#
# What that trades: a statement holding a destructive verb AND, elsewhere in it, the flag of that
# verb is judged destructive even if they belong to different invocations. `git reset --soft HEAD &&
# git log --hard` would be refused. Quoted text cannot cause it (the tokenizer hides it, so
# `git commit -m "--hard"` builds `""`), and this guard blocks only in a worktree session whose cwd
# has fallen back to MAIN — a rare state where refusing too much is the right way to be wrong.
#
# The redirect and `-C` handling stay: `git clean 2>&1 -fd` and `git -C <path> reset --hard` were
# both exit 0 before them.
statement_is_destructive() {
  local seen_git=false skip_value=false word
  # The verbs seen ANYWHERE in this statement, not the verb of the invocation currently being read.
  # A destructive flag counts when its verb is among them.
  local saw_reset=false saw_clean=false saw_checkout=false saw_push=false

  while IFS= read -r word; do
    if [[ "$skip_value" == "true" ]]; then
      skip_value=false
      continue
    fi
    case "$word" in
      git | */git)
        seen_git=true
        continue
        ;;
    esac
    [[ "$seen_git" == "true" ]] || continue
    case "$word" in
      # A global option that CONSUMES the next word. Without this the path of a
      # `git -C <path> reset --hard` read as the subcommand and the statement judged clean.
      -C | -c | --git-dir | --work-tree | --namespace | --exec-path)
        skip_value=true
        continue
        ;;
      reset) saw_reset=true ;;
      clean) saw_clean=true ;;
      checkout) saw_checkout=true ;;
      push) saw_push=true ;;
    esac
    [[ "$saw_reset" == "true" && "$word" == "--hard" ]] && return 0
    [[ "$saw_clean" == "true" ]] && is_force_flag "$word" && return 0
    # `git checkout -- <path>` DISCARDS working-tree changes. The bare `--` is the whole signal.
    [[ "$saw_checkout" == "true" && "$word" == "--" ]] && return 0
    [[ "$saw_push" == "true" ]] && is_force_flag "$word" && return 0
  done <<< "$1"
  return 1
}


# --- Ambient git environment --------------------------------------------------------------------
#
# ABOVE the worktree-session gate, and that is the finding. Placed below it, this never ran in an
# ordinary session — which is precisely where the incident happened: a command in the main checkout,
# no worktree marker anywhere, writing to another repository because a variable said so.
#
# It judges EVERY session and every git command, with no deferral to the block at the bottom of this
# file. The first version deferred: in a worktree-assigned session with a destructive command it let
# the cwd-fallback check answer instead, on the reasoning that the more specific story was the more
# useful one. That was wrong, and review found the case that shows it. The bottom block resolves its
# directory with `hook_git_in`, which SCRUBS the ambient variables — so it can never see that a
# `GIT_DIR` would redirect the real command. It detects "cwd fell back to MAIN", a different failure
# mode. So from inside a correctly assigned worktree,
#
#   GIT_DIR=/somewhere/else/.git git reset --hard
#
# was permitted: the ambient check skipped, and the bottom check saw a path under `.claude/worktrees/`
# and allowed it. Measured before and after. A foreign repository is this block's subject and nothing
# below looks for it, so there is no case in which deferring is safe.
#
# `GIT_DIR` and its family outrank the working directory. A process that inherits one runs against a
# DIFFERENT repository than the one it appears to be standing in, and git hooks export exactly these
# variables — so a command launched from inside a hook, or from a test that was, silently reaches
# another clone. That is not a hypothetical: a shared branch was overwritten with fixture commits
# this way more than once, and every command involved looked local.
#
# Checked BEFORE anything that resolves a repository, because with one of these set the resolution
# itself answers about the wrong repo. Any git command at all is judged, not just the destructive
# ones: `git commit` into the wrong repository is as bad as `git reset` in the right one.
#
# NARROWED, by a case this file already had. Git sets `GIT_DIR` when it runs a hook, so the variable
# being present is ORDINARY — and this guard is built for that: `hook_git` scrubs the environment for
# its own questions, and `hook-facts` asserts no hook asks git anything without the scrub. Refusing on
# presence alone fired on the normal case and broke the existing "still sees the MAIN checkout when
# GIT_DIR names a worktree" case, which is the guard working exactly as designed.
#
# The hazard is not that the variable is set. It is that it names a DIFFERENT repository than the one
# the command appears to target — then the command silently reaches the other one, which is how a
# shared branch was overwritten. Same repository: the scrub already handles it, and this permits.
#
# fail-direction: refuse — the list of variable names is a DENYLIST, so a variable git adds later is
# not covered here. That gap is stated rather than hidden; it fails toward permitting, which is why
# the repository-identity checks below are not replaced by this one.
# The list is OWNED by scripts/harness/git-ambient-env.json. It used to be spelled out here, and
# review found this copy checking seven variables where the gate's copy checked nine — the drift
# this file has paid for before. An unreadable list is a REFUSAL: a check that cannot read its own
# subject has not run, and must not read as one that found nothing.
# Found relative to THIS FILE first. The hook is copied into worktrees, and the copy that is
# running is the one whose repository owns the list — `CLAUDE_PROJECT_DIR` may point elsewhere
# entirely, which is the situation the guard around it exists for.
GIT_AMBIENT_ENV_NAMES=""
for _candidate in "$SELF_DIR/../../scripts/harness/git-ambient-env.json" \
  "$SELF_DIR/../scripts/harness/git-ambient-env.json" \
  "${CLAUDE_PROJECT_DIR:-}/scripts/harness/git-ambient-env.json"; do
  [[ -r "$_candidate" ]] || continue
  # `grep -o` over the whole document, NOT a line-anchored sed. Review pointed at the failure a
  # line shape invites: a formatter collapsing the short array onto one line would make a
  # line-per-name pattern come back empty, and the refusal below would then block every git command
  # in every worktree session — fail-closed, but a repo-wide outage resting on text shape (#1664 is
  # the same disagreement class). Token extraction reads the names wherever the formatter puts
  # them; a real JSON parse would need node, which is too heavy for a hook that runs per command.
  GIT_AMBIENT_ENV_NAMES=$(grep -o '"GIT_[A-Z_]*"' "$_candidate" | tr -d '"')
  [[ -n "$GIT_AMBIENT_ENV_NAMES" ]] && break
done
if [[ -z "$GIT_AMBIENT_ENV_NAMES" ]]; then
  echo "[worktree-cwd-guard] Blocked: could not read scripts/harness/git-ambient-env.json, so the" >&2
  echo "[worktree-cwd-guard] ambient-git" >&2
  echo "[worktree-cwd-guard] check has no subject list. A check that cannot read what it judges" >&2
  echo "[worktree-cwd-guard] has not run, and must not read as one that found nothing." >&2
  exit 2
fi
GIT_AMBIENT_ENV_SET=""
for _var in $GIT_AMBIENT_ENV_NAMES; do
  if [[ -n "${!_var:-}" ]]; then
    GIT_AMBIENT_ENV_SET="${GIT_AMBIENT_ENV_SET}${GIT_AMBIENT_ENV_SET:+, }${_var}"
  fi
done
AMBIENT_REPO=""
AMBIENT_TARGET_REPO=""
if [[ -n "$GIT_AMBIENT_ENV_SET" ]] &&
  printf '%s' "$VERBS" | grep -qE "${STASH_PRE}git${STASH_END}"; then
  # Compared by COMMON DIR, not by path: every worktree of one clone shares it, so a hook's own
  # `GIT_DIR` pointing at a sibling worktree compares equal and is permitted, while a variable naming
  # another clone does not.
  #
  # BOTH readings are taken from the SAME directory, and that is the whole design of the comparison:
  # one is read with the ambient environment INTACT and one with it scrubbed, so the ONLY thing that
  # can make them differ is the environment — which is the question being asked. The first version
  # read the ambient side from the hook process's own OS cwd and the scrubbed side from the declared
  # tool cwd, so the two differed in two ways at once. With `GIT_DIR` set that is harmless (it
  # replaces the cwd search outright), but the family includes variables that do not — and a
  # comparison whose inputs vary in something other than its subject is not measuring its subject.
  # Review raised it without being able to confirm a reachable mismatch; neither could I, and it is
  # fixed on the reasoning rather than on a case, which is why no test claims to reproduce one.
  #
  # `cd` in a subshell rather than `git -C`: the ambient environment must survive, so `hook_git_in`
  # (which scrubs) cannot be used here — and a literal `git -C` in a hook is what
  # `hook-facts.test.mjs` refuses, precisely so the scrub is not skipped by accident.
  AMBIENT_DIR=$(hook_effective_repo first-nonempty "" "$(hook_cwd_of "$INPUT" || true)" "${CLAUDE_PROJECT_DIR:-}")
  if [[ -n "$AMBIENT_DIR" ]]; then
    AMBIENT_REPO=$(cd "$AMBIENT_DIR" 2>/dev/null && git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)
    AMBIENT_TARGET_REPO=$(hook_git_in "$AMBIENT_DIR" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)
  fi
fi
if [[ -n "$AMBIENT_REPO" && -n "$AMBIENT_TARGET_REPO" && "$AMBIENT_REPO" != "$AMBIENT_TARGET_REPO" ]]; then
  echo "[worktree-cwd-guard] Blocked: ${GIT_AMBIENT_ENV_SET} names a DIFFERENT repository" >&2
  echo "[worktree-cwd-guard]   ambient: ${AMBIENT_REPO}" >&2
  echo "[worktree-cwd-guard]   target:  ${AMBIENT_TARGET_REPO}" >&2
  echo "[worktree-cwd-guard] These outrank the working directory, so this git command can read and" >&2
  echo "[worktree-cwd-guard] write a DIFFERENT repository than the one you are standing in. A shared" >&2
  echo "[worktree-cwd-guard] branch was overwritten this way; the command looked local and was not." >&2
  echo "[worktree-cwd-guard] Unset them, then run the command again." >&2
  exit 2
fi

if [[ "$IN_WORKTREE_SESSION" != "true" ]]; then
  exit 0
fi

# --- Every destructive statement, judged against ITS OWN repository ------------------------------
#
# The `-C` used to be read from the WHOLE command, first match anywhere. That is the bypass an audit
# measured, and it is the third time this file has met the class — the stash block above it and
# `branch-guard` both already resolve per statement, and both say so in a comment this reading did
# not follow. Two shapes were exit 0:
#
#   git -C <worktree> status && git reset --hard          the reset runs in the MAIN cwd
#   git -C <worktree> status && git -C <MAIN> reset --hard the reset names MAIN outright
#
# In both, the first `-C` found anywhere resolved under `.claude/worktrees/` and the guard allowed
# the whole command. It also refused a legitimate one for the same reason: `git -C <MAIN> log -1 &&
# git reset --hard` from inside a worktree resolved to MAIN and blocked a reset aimed at the
# worktree. A guard that both misses the hazard and blocks correct work is not conservative, it is
# reading the wrong string.
#
# So the statement is the unit of every question asked below: is it destructive, does the override
# excuse it, and WHICH repository does it name. The window comes from `hook_statement_ranges`, the
# one splitter this file already uses twice — not a third `sed` over separators.
STATEMENT_RANGES=$(hook_statement_ranges "$COMMAND" || printf '')
if [[ -z "${STATEMENT_RANGES//[[:space:]]/}" ]]; then
  # The command could not be split, so nothing in it can be attributed to a repository. FAIL-SAFE is
  # this guard's rule everywhere else, but not here: refusing to split is not the same as finding
  # nothing, and the whole command is still in hand to ask the cheaper question of.
  if statement_is_destructive "$(hook_statement_all_words "$COMMAND" || printf '')"; then
    echo "[worktree-cwd-guard] Blocked: the command is destructive and could not be split into" >&2
    echo "[worktree-cwd-guard] statements, so which repository it targets was never determined." >&2
    echo "[worktree-cwd-guard] This is not a pass." >&2
    exit 2
  fi
  exit 0
fi

# The inline override, asked of the destructive statement ITSELF. The token sitting on a sibling
# command excuses nothing — a decoy in front of a real one still refuses.
OVERRIDE_RE='^[[:space:]]*([[:alnum:]_]+=[^[:space:]]+[[:space:]]+)*WORKTREE_CWD_GUARD_ALLOW_MAIN=1[[:space:]]'
HOOK_CWD=$(hook_cwd_of "$INPUT" || true)

while read -r STMT_START STMT_LEN; do
  [[ -n "$STMT_START" && -n "$STMT_LEN" ]] || continue

  # FAIL-CLOSED ON THE TOKENIZER FAILING, not on it answering "no words" — a statement can
  # legitimately build none. The error signal is awk's exit status; emptiness is an ANSWER. The
  # `&& printf '\001'` sentinel carries the failure through the substitution, which strips trailing
  # newlines and would otherwise hide it. `branch-guard.sh` records the same trap.
  if ! STMT_WORDS=$(hook_statement_all_words "$COMMAND" "$STMT_START" "$STMT_LEN" && printf '\001'); then
    echo "[worktree-cwd-guard] Blocked: a statement could not be split into words, so what it does" >&2
    echo "[worktree-cwd-guard] to which repository was never read. This is not a pass." >&2
    exit 2
  fi
  STMT_WORDS=${STMT_WORDS%$'\n\001'}

  statement_is_destructive "$STMT_WORDS" || continue

  STMT_TEXT=$(hook_verb_scan "$COMMAND" "$STMT_START" "$STMT_LEN" || printf '')
  printf '%s' "$STMT_TEXT" | grep -qE "$OVERRIDE_RE" && continue

  # Precedence (worktree-aware, same intent as branch-guard/pre-push-check): `git -C <path>` in THIS
  # statement > hook-input `cwd` > CLAUDE_PROJECT_DIR. Unlike branch-guard, we do NOT fall back to
  # `.` (the hook's OWN process dir): `.` is wherever the hook binary runs, not where the tool
  # command runs — resolving its toplevel would judge an unrelated checkout (this caused a fail-safe
  # bug: a non-git cwd fell back to `.`, which resolved to the hook's own checkout and blocked).
  #
  # The RAW command goes in, with this statement's window: `hook_git_c_path` masks it itself, by the
  # grammar, and handing it a string a second reader had already mangled was an earlier bypass. See
  # lib/command-scan.sh.
  GIT_C_PATH=$(hook_git_c_path "$COMMAND" "$STMT_START" "$STMT_LEN" || true)
  # The `first-nonempty` mode, named rather than flattened into the validating one its siblings use.
  # It is this guard's FAIL-SAFE: this hook blocks only on POSITIVE confirmation, so naming an
  # unresolvable `-C` target and then declining to block is the correct outcome, where validating
  # would silently retarget the guard at the session repository and block a destructive command
  # aimed somewhere else. It has no `.` fallback for the same reason.
  EFFECTIVE_DIR=$(hook_effective_repo first-nonempty "$GIT_C_PATH" "$HOOK_CWD" "${CLAUDE_PROJECT_DIR:-}")
  # No nameable effective dir → cannot positively confirm main-checkout → FAIL-SAFE, next statement.
  [[ -n "$EFFECTIVE_DIR" ]] || continue

  # Positively resolve the repo toplevel. Not inside a git work tree (empty/error) → cannot
  # positively confirm main-checkout → FAIL-SAFE.
  TOPLEVEL=$(hook_git_in "$EFFECTIVE_DIR" rev-parse --show-toplevel 2>/dev/null || echo "")
  [[ -n "$TOPLEVEL" ]] || continue

  # Under `.claude/worktrees/` → the assigned worktree, not main → this statement is fine.
  printf '%s' "$TOPLEVEL" | grep -q '/\.claude/worktrees/' && continue

  BLOCKED_TOPLEVEL="$TOPLEVEL"
  break
done <<< "$STATEMENT_RANGES"

# Read from a here-string, never a PIPE: a `while` on the right of a pipe runs in a SUBSHELL, where
# both the `exit 2` of a refusal and the `BLOCKED_TOPLEVEL` it sets would be confined to that
# subshell — the hook would carry on and exit 0, a refusal that refuses nothing.
if [[ -z "${BLOCKED_TOPLEVEL:-}" ]]; then
  exit 0
fi

# Positively confirmed: a destructive statement, an assigned-worktree marker, and an effective repo
# that is the MAIN checkout. This is the silent-cwd-fallback incident → BLOCK.
echo "[worktree-cwd-guard] Blocked: a DESTRUCTIVE git command resolved to the MAIN checkout" >&2
echo "[worktree-cwd-guard]   effective repo: $BLOCKED_TOPLEVEL" >&2
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
