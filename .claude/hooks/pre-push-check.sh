#!/bin/bash
# pre-push-check.sh
# Before git push: cheap, fast branch-hygiene + lockfile gates ONLY.
#
# fail-direction: refuse — its checks are cheap and its subject is the branch and the lockfile, both
# of which it can always read. An unrecognised state means it could not establish the property it
# gates on, and a push that proceeds on that is the one nobody looks at again.
# 1. Branch-base hygiene (no foreign merge commits over origin/develop)
# 2. Verify pnpm-lock.yaml is committed and in sync
# The heavy typecheck/lint/test re-runs were removed (HARNESS-DIET-006):
# .husky/pre-push (harness:pre-push) and CI already own those gates.
# Runs as a PreToolUse hook on Bash tool calls.

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

# Fail closed on an unreadable tool name. Left bare, a non-zero return aborts the assignment
# under `set -e` and the hook exits 1 with nothing said — which the hook protocol treats as
# non-blocking. Silent exit and "it is fine" are the two states this file refuses to conflate.
if ! TOOL_NAME=$(hook_tool_name_of "$INPUT"); then
  echo "[pre-push-check] Blocked: the hook payload names no tool, so nothing can be judged." >&2
  exit 2
fi

if [[ "$TOOL_NAME" != "Bash" ]]; then
  exit 0
fi

if ! COMMAND=$(hook_command_of "$INPUT"); then
  echo "[pre-push-check] Blocked: the tool command could not be decoded, so the push cannot be judged." >&2
  echo "[pre-push-check] Install jq or python3 so this guard can read what it is judging." >&2
  exit 2
fi

# ONE reading, by the grammar (INFRA-075, #1572). This hook used to hold two: `COMMAND_VERBS` from
# the tokenizer and `COMMAND_EXEC` from two line-oriented passes that did no quote masking, and the
# `-C` extraction below read the second one. Measured, with the bare form refused correctly:
#   git -C <a repo with no review record> push                                 -> exit 2
#   echo "see <<EOF for details" ; git -C <that repo> push                     -> exit 0
# The quoted `<<EOF` opened a heredoc the old reading never saw close, so everything after it was
# deleted from the string this guard examined; the `-C` vanished, the gate judged the SESSION
# repository instead, and an unreviewed push walked through.
COMMAND_VERBS=$(hook_verb_scan "$COMMAND")

# Only intercept git push commands (tolerating env prefixes + global git flags like `git -C <path>`).
#
# Matched at any STATEMENT boundary, not only at the start of the command. The `^`-anchored version
# fired only when the whole command began with `git push`, so every compound form slipped past it
# silently — and `cd <repo> && git push`, or a multi-line block whose push is on a later line, is how
# a push is normally written here. Measured 2026-07-27: EVERY push in a long session bypassed this
# guard, which is why the branch-hygiene rule it enforces kept being violated. The guard existed, was
# registered, and was unreachable from the way commands are actually issued — enforcement that no
# real invocation can reach is indistinguishable from no enforcement.
#
# Boundaries are STATEMENT separators only — line start, `;`, `&&`, `||`, `|`, `(`, and the literal
# a real newline, matched by grep's own `^`. Whitespace IS a boundary — `time git push`, `command git push`, `nice git push` reach the
# guard only through it. It was excluded while the false positive below was live:
# `gh pr create --body "… git push …"` and `git commit -m "fix: git push guard"` both match, and a
# guard that blocks ordinary work is one that gets switched off.
#
# THE CEILING, stated rather than discovered later. This is `grep` over a command string; it does not
# understand shell quoting, so a separator INSIDE a quoted argument —
# `git commit -m 'note: cd x; git push'` — reads as a real one and the hook runs. That is a genuine
# false positive and the trade is deliberate: a missed push cost a promotion-ancestry break, while a
# spurious run costs one lockfile check and passes silently on a clean branch. Understanding quoting
# needs the shell-aware extraction filed as HARNESS-061, not a longer regex.
#
# That false positive does not reproduce today only because the shared COMMAND extraction truncates
# at the first escaped quote, so the text after `--body \"` is never seen (HARNESS-061). It would
# come alive the moment that extraction is repaired — so it is excluded here rather than left as a
# trap for whoever fixes it.
# Boundaries: line start, `;`, `&&`, `||`, `|`, `(`, `{`, a quote, a backtick, a newline — and
# whitespace. `time git push`, `command git push` and `nice git push` reach this guard only through
# the last one, and it was excluded while the false positive it guarded against was live: back then
# the whole command was scanned raw, so `gh pr create --body "… git push …"` matched. Quoted
# payloads are masked before this runs now, so the exclusion protected nothing and cost the forms
# above. A quote and a backtick are boundaries because a kept region — `bash -c "git push"`,
# `` `git push` `` — puts one immediately before the verb.
# The trailing boundary is any NON-WORD character, matching `branch-guard`'s. It required
# whitespace-or-end here, so `git push;` was a push to that guard and not a push to this one — and
# because this line is the whole file's entry point, the branch-hygiene check, the lockfile-sync
# check and the local-review record were all skipped for that shape. Two guards reading one command
# must reach one reading of it.
# ONE spelling of "this statement is a push", shared with the per-statement walk below — a second
# copy of the pattern is a second answer waiting to disagree (#1667 review; lib/command-scan.sh
# carries this file's history of exactly that).
RE_PUSH_STMT='(^|[;&|({"'"'"'`]|[[:space:]])[[:space:]]*(\S+=\S+[[:space:]]+)*git[[:space:]]+((-C|-c)[[:space:]]+\S+[[:space:]]+)*push([^-[:alnum:]_]|$)'
printf '%s' "$COMMAND_VERBS" | grep -qE "$RE_PUSH_STMT" || exit 0

# Worktree-aware context resolution — the repository the push will ACTUALLY act on (#1662).
#
# The previous resolution took `git -C` from the whole command, then the DECLARED tool cwd, then the
# project dir. For the shape pushes are actually written in here — `cd <worktree> && git push` —
# that is exactly wrong: the `cd` runs after the hook has read the payload, there is no `-C`, and
# the declared cwd is the MAIN clone. Measured (issue #1662): five worktree pushes, each with a
# fresh 0-finding review recorded IN the worktree, all refused against the record of a sixth,
# already-merged branch the main checkout happened to be parked on. And the mirror direction is the
# one this hook exists for: a main checkout parked on a branch with a CURRENT record would wave an
# unreviewed worktree push straight through.
#
# So the resolution follows the PUSH STATEMENT:
#   1. that statement's own `git -C <path>`;
#   2. else the LAST `cd <path>` in a statement BEFORE it, resolved against the declared cwd;
#   3. else the declared cwd.
# A `cd` whose target cannot be read (quoted away, a variable, `cd -`) REFUSES: the hook then knows
# the push runs somewhere other than anywhere it can name, and a guard that cannot tell which
# repository is being pushed has not verified anything about it. Two push statements resolving to
# different repositories refuse for the same reason.
HOOK_CWD=$(hook_cwd_of "$INPUT" || true)
PUSH_DIR=""
PUSH_DIR_CONFLICT=false
LAST_CD=""
LAST_CD_UNREADABLE=false
PUSHD_STACK=()
STATEMENT_RANGES=$(hook_statement_ranges "$COMMAND" || printf '')
if [[ -z "${STATEMENT_RANGES//[[:space:]]/}" ]]; then
  echo "[pre-push-check] Blocked: the command could not be split into statements, so which" >&2
  echo "[pre-push-check] repository this push acts on was never read. This is not a pass." >&2
  exit 2
fi
while read -r PS_START PS_LEN; do
  PS_MASK=$(hook_verb_scan "$COMMAND" "$PS_START" "$PS_LEN")
  if printf '%s' "$PS_MASK" | grep -qE "$RE_PUSH_STMT"; then
    # 1. This statement's own `git -C`.
    PS_DIR=$(hook_git_c_path "$COMMAND" "$PS_START" "$PS_LEN" 2>/dev/null || printf '')
    if [[ -z "$PS_DIR" ]]; then
      # 2. The last `cd` seen before this statement.
      if [[ "$LAST_CD_UNREADABLE" == "true" ]]; then
        echo "[pre-push-check] Blocked: a \`cd\` earlier in this command has a target this hook" >&2
        echo "[pre-push-check] cannot read (quoted, a variable, or bare), so which repository the" >&2
        echo "[pre-push-check] push acts on is unknown. Name it: git -C <path> push …" >&2
        exit 2
      fi
      PS_DIR="${LAST_CD:-$HOOK_CWD}"
    fi
    if [[ -n "$PUSH_DIR" && "$PS_DIR" != "$PUSH_DIR" ]]; then
      PUSH_DIR_CONFLICT=true
    fi
    PUSH_DIR="$PS_DIR"
  else
    # Track directory changes so a later push statement is judged where it runs. Words-mode hides
    # quoted content and substitutions, so an unreadable target is DETECTED rather than guessed at.
    # A statement whose words cannot be READ is a statement whose directory changes cannot be
    # seen — the same answer every other unknowable gets, not a silent skip that leaves a later
    # push trusting a stale base. (#1667 review)
    if ! PS_WORDS=$(hook_statement_words "$COMMAND" "$PS_START" "$PS_LEN" 2>/dev/null); then
      LAST_CD_UNREADABLE=true
      continue
    fi
    PS_FIRST=""
    PS_SECOND=""
    PS_THIRD=""
    PS_FOURTH=""
    PS_FIFTH=""
    PS_INDEX=0
    while IFS= read -r PS_W; do
      [[ -n "$PS_W" || "$PS_INDEX" -gt 0 ]] || continue
      case "$PS_W" in *=*) [[ "$PS_INDEX" -eq 0 ]] && continue ;; esac
      PS_INDEX=$((PS_INDEX + 1))
      [[ "$PS_INDEX" -eq 1 ]] && PS_FIRST="$PS_W"
      [[ "$PS_INDEX" -eq 2 ]] && PS_SECOND="$PS_W"
      [[ "$PS_INDEX" -eq 3 ]] && PS_THIRD="$PS_W"
      [[ "$PS_INDEX" -eq 4 ]] && PS_FOURTH="$PS_W"
      [[ "$PS_INDEX" -eq 5 ]] && PS_FIFTH="$PS_W"
      [[ "$PS_INDEX" -ge 6 ]] && break
    done <<< "$PS_WORDS"
    # A subshell opener glues to the first word — `(cd <dir> && git push)` reads as `(cd` — and
    # an unstripped paren made the whole idiom invisible to this tracking: the push was judged
    # against the declared cwd, the exact wrong-repository answer this walk exists to end.
    PS_FIRST="${PS_FIRST#"${PS_FIRST%%[!({]*}"}"
    # A BRACE group is different: `{` must be its own space-delimited word (`{ cd dir; …`), so the
    # stripped first word comes back empty and the `cd` sits one word later — shift, or the walk
    # silently falls back to the declared cwd for a form bash itself accepts. (#1667 review)
    if [[ -z "$PS_FIRST" ]]; then
      PS_FIRST="$PS_SECOND"
      PS_SECOND="$PS_THIRD"
      PS_THIRD="$PS_FOURTH"
      PS_FOURTH="$PS_FIFTH"
      PS_FIFTH=""
    fi
    # `builtin cd`, `command cd` and `\cd` are the cd builtin wearing a bypass prefix — valid
    # ways to skip a shell function or alias, and each left the walk blind to a real directory
    # change: the push after one was judged where the shell no longer stood. STACKED prefixes
    # (`command builtin cd`) unwrap one per loop turn, or the second prefix re-blinded the walk
    # one word later. (#1667 review)
    while [[ "$PS_FIRST" == "builtin" || "$PS_FIRST" == "command" ]]; do
      PS_FIRST="$PS_SECOND"
      PS_SECOND="$PS_THIRD"
      PS_THIRD="$PS_FOURTH"
      PS_FOURTH="$PS_FIFTH"
      PS_FIFTH=""
    done
    PS_FIRST="${PS_FIRST#\\}"
    if [[ "$PS_FIRST" == "popd" ]]; then
      # `popd` returns to the top of the stack this walk has been keeping. A stack this walk did
      # not see filled (no prior pushd), a rotation (`+N`), or a poisoned entry is a base only the
      # real shell knows — unreadable, the same answer every other unknowable target gets.
      if [[ -n "$PS_SECOND" ]] || [[ ${#PUSHD_STACK[@]} -eq 0 ]]; then
        LAST_CD_UNREADABLE=true
      else
        # Indexed from the length, not a negative subscript: bash gained negative array indices
        # in 4.3, and macOS ships /bin/bash at 3.2 — where the negative form is a fatal expansion
        # error that, under set -e, kills the hook with a non-2 exit the protocol reads as PASS.
        # A guard whose newest line fail-opens an entire platform is the exact silence it exists
        # to refuse. (#1667 review)
        _PUSHD_TOP=$(( ${#PUSHD_STACK[@]} - 1 ))
        LAST_CD="${PUSHD_STACK[$_PUSHD_TOP]}"
        unset "PUSHD_STACK[$_PUSHD_TOP]"
        if [[ "$LAST_CD" == "?" ]]; then
          LAST_CD=""
          LAST_CD_UNREADABLE=true
        else
          LAST_CD_UNREADABLE=false
        fi
      fi
    elif [[ "$PS_FIRST" == "cd" || "$PS_FIRST" == "pushd" ]]; then
      # `cd -- <path>`: the end-of-options marker is not the target — the next word is.
      [[ "$PS_SECOND" == "--" && -n "$PS_THIRD" ]] && PS_SECOND="$PS_THIRD"
      # A substitution EMBEDDED in the target is invisible to words-mode: `cd /pre$(x)post`
      # yields the word `/prepost`, the inner content AND its delimiters dropped — a clean-looking
      # literal that is not where the shell will land. The raw TARGET TOKEN still carries the
      # `$`/backtick — and it is the token that is scanned, not the whole statement, or an
      # env-var prefix (`V=$(x) cd ../sibling`) would refuse a perfectly literal target.
      # (#1667 review, both rounds)
      PS_RAW="${COMMAND:$((PS_START - 1)):$PS_LEN}"
      # EVERY raw occurrence is tested, not the first: `head -1` locked onto a decoy `cd `
      # inside an env-prefix substitution (`V=$(cd /tmp) cd /repo$(echo evil)path`), and the
      # real, substitution-bearing target was never inspected. The walk cannot know which
      # occurrence is the live command word, so a `$`/backtick in ANY of them refuses —
      # a decoy can only add a refusal, never launder a hidden target past one. (#1667 review)
      RAW_TGT=$(printf '%s' "$PS_RAW" | grep -oE "(^|[^[:alnum:]_-])${PS_FIRST}[[:space:]]+(--[[:space:]]+)?[^[:space:]]+") || RAW_TGT=""
      TARGET_HIDDEN=false
      if [[ "$RAW_TGT" == *'$'* || "$RAW_TGT" == *'`'* ]]; then
        TARGET_HIDDEN=true
      fi
      # A target this hook cannot resolve, decided BEFORE the stack is touched: empty (quoted
      # away), `-`/flags, a variable or substitution (`$DIR`, or one EMBEDDED in the token —
      # TARGET_HIDDEN above), `~` (the hook does not expand another process's home), a `pushd`
      # stack rotation (`+N`/`-N`), a word still carrying a subshell paren — `(cd x) && push`
      # changes no directory the push will see — or a quote character, the tokenizer's mark of
      # hidden content (a quoted target with inner spaces words as bare quote marks).
      #
      # The closing paren need not glue to the target: `( cd x ) && push` tokenizes the `)` as
      # its own word, so the slice AFTER the target is tested too — a `)` there means the
      # subshell closed before the push, and the outer directory is not what this walk just
      # read. Only the tail is tested, because a paren BEFORE the target is a different fact:
      # an env-prefix substitution (`V=$(x) cd /repo`) closes ITS paren before `cd`, and the
      # target is still literal. The residue is a `)` in a trailing comment, which refuses —
      # fail-closed, and the shape is not one an agent writes. (#1667 review)
      PS_TAIL="${PS_RAW##*"$PS_SECOND"}"
      UNREADABLE_TARGET="$TARGET_HIDDEN"
      if [[ -z "$PS_SECOND" || "$PS_SECOND" == "-" || "$PS_SECOND" == -* || "$PS_SECOND" == *'$'* || "$PS_SECOND" == *'`'* || "$PS_SECOND" == '~'* || "$PS_SECOND" == *'('* || "$PS_SECOND" == *')'* || "$PS_SECOND" == *'"'* || "$PS_SECOND" == *"'"* || "$PS_TAIL" == *')'* ]] \
        || [[ "$PS_FIRST" == "pushd" && "$PS_SECOND" == +* ]]; then
        UNREADABLE_TARGET=true
      fi
      # `pushd` remembers where the shell stood, or that it could not tell (`?`), so a later
      # `popd` restores exactly what this walk knew at the push. The frame is pushed for EVERY
      # pushd, poisoned when the target is unreadable: the real pushd moved the stack one frame
      # (or failed and moved it none — unknowable), and a stack one frame short handed popd the
      # wrong directory with full confidence. (#1667 review)
      if [[ "$PS_FIRST" == "pushd" ]]; then
        if [[ "$LAST_CD_UNREADABLE" == "true" || "$UNREADABLE_TARGET" == "true" ]]; then
          PUSHD_STACK+=("?")
        else
          PUSHD_STACK+=("${LAST_CD:-${HOOK_CWD:-.}}")
        fi
      fi
      if [[ "$UNREADABLE_TARGET" == "true" ]]; then
        LAST_CD_UNREADABLE=true
      else
        case "$PS_SECOND" in
          /*)
            LAST_CD="$PS_SECOND"
            LAST_CD_UNREADABLE=false
            ;;
          *)
            # A RELATIVE hop resolves against where the shell already stands: the last tracked
            # `cd`, or the declared cwd when none. Resolving every hop against the declared cwd
            # sent the second hop of `cd .. && cd sibling && git push` to the wrong path — and
            # the fallback then judged the main clone, the exact pre-#1662 resolution, silently.
            # After an UNREADABLE cd the base is unknown, so a relative hop stays unreadable.
            if [[ "$LAST_CD_UNREADABLE" != "true" ]]; then
              LAST_CD="${LAST_CD:-${HOOK_CWD:-.}}/$PS_SECOND"
            fi
            ;;
        esac
      fi
    fi
  fi
done <<< "$STATEMENT_RANGES"
if [[ "$PUSH_DIR_CONFLICT" == "true" ]]; then
  echo "[pre-push-check] Blocked: this command pushes from two different repositories, and one" >&2
  echo "[pre-push-check] verdict cannot be about both. Split the pushes into separate commands." >&2
  exit 2
fi
# `validated` still applies its work-tree test to what the statement walk produced; the project dir
# stays as the final fallback ONLY when neither a `-C`, a `cd`, nor the declared cwd named a work
# tree — the bare-`git push`-in-the-session case, which is the one that fallback was for.
PROJECT_DIR=$(hook_effective_repo validated "" "$PUSH_DIR" "${CLAUDE_PROJECT_DIR:-}")

# A guard fails CLOSED, and two guards taking the same resolution must answer this the same way.
# branch-guard refuses when nothing resolvable is a repository; this hook took the identical
# `validated` resolution and the identical branch reader and did not — a fact fixed in one hook and
# not in the one beside it, which is the failure this whole change exists to end.
#
# What it cost, measured: `CUR_BRANCH` comes back "" for a detached HEAD AND for "not a repository
# at all", and the `""` arm of the hygiene switch below — written for the first — silently skipped
# the foreign-merge check for the second. The lockfile check further down then refused anyway and
# named `pnpm-lock.yaml`, so the push was stopped for a reason that was not the reason: a wrong
# refusal after a check that never ran. A detached HEAD is deliberately NOT this case, and this hook
# has its own considered answer for it further down; the test beside this one pins that so the
# refusal here cannot grow to swallow it.
if ! hook_is_work_tree "$PROJECT_DIR"; then
  echo "[pre-push-check] Blocked: '$PROJECT_DIR' is no git repository, so the branch this push" >&2
  echo "[pre-push-check] would come from cannot be read. Nothing was verified; this is not a pass." >&2
  echo "[pre-push-check] Run the push from the checkout it belongs to." >&2
  exit 2
fi

# ── 0. Branch-base hygiene (git-branch.md: feature branches start from origin/develop) ──────────
# After a develop→main promotion, `main` sits AHEAD of `develop`. A branch cut from `main` (or that
# merged one in) and PR'd to develop carries the promotion's merge commits in its `origin/develop..HEAD`
# range, which land in the PR range and fail commitlint. A clean feature/docs branch has ZERO merge
# commits over origin/develop. Skip integration/detached branches and when origin/develop is absent.
# One branch reader, with the default on the VALUE (see lib/hook-facts.sh). This caller asks for
# the EMPTY default deliberately: the detached-HEAD refusal further down is keyed on emptiness, and
# a reader that substituted a word there would have silently disabled it.
CUR_BRANCH=$(hook_current_branch "$PROJECT_DIR" "")
case "$CUR_BRANCH" in
  # release/* and hotfix/* are promotion branches — they LEGITIMATELY carry the `git merge --no-ff origin/main`
  # that records main's ancestry into a develop→main promotion (INFRA-051, built by
  # scripts/harness/promote.mjs), so exempt them from the "no foreign merge commits" check that targets
  # feature branches accidentally based on `main`.
  # `""` here now means ONE thing — a detached HEAD, which has nothing to compare against
  # origin/develop. It used to mean that OR "the repository could not be read", and the two are not
  # the same answer; the refusal above separates them before this switch is reached.
  main | master | develop | release/* | hotfix/* | "") : ;;
  *)
    if hook_git_in "$PROJECT_DIR" rev-parse --verify --quiet origin/develop >/dev/null 2>&1; then
      FOREIGN_MERGES=$(hook_git_in "$PROJECT_DIR" log --merges --oneline origin/develop..HEAD 2>/dev/null || true)
      if [ -n "$FOREIGN_MERGES" ]; then
        echo "[pre-push-check] Blocked: branch '$CUR_BRANCH' carries merge commits in its range over origin/develop:" >&2
        echo "$FOREIGN_MERGES" | sed 's/^/[pre-push-check]   /' >&2
        echo "[pre-push-check] It was likely based on 'main' (ahead of develop after a promotion), not origin/develop." >&2
        echo "[pre-push-check] Re-base on develop: git reset --hard origin/develop && git cherry-pick <your-commit(s)>" >&2
        exit 2
      fi
    fi
    ;;
esac

# ── 1. Lockfile sync check ──────────────────────────────────────────────────

if ! hook_git_in "$PROJECT_DIR" diff --quiet pnpm-lock.yaml 2>/dev/null; then
  echo "[pre-push-check] Blocked: pnpm-lock.yaml has uncommitted changes. Commit the lockfile before pushing." >&2
  exit 2
fi

if ! hook_git_in "$PROJECT_DIR" diff --cached --quiet pnpm-lock.yaml 2>/dev/null; then
  echo "[pre-push-check] Blocked: pnpm-lock.yaml is staged but not committed. Commit it first." >&2
  exit 2
fi

cd "$PROJECT_DIR"

pnpm install --prefer-offline --silent 2>/dev/null || pnpm install --silent 2>/dev/null || true

if ! hook_git_in "$PROJECT_DIR" diff --quiet pnpm-lock.yaml 2>/dev/null; then
  echo "[pre-push-check] Blocked: pnpm-lock.yaml is out of sync with package.json files." >&2
  echo "[pre-push-check] Run: pnpm install && git add pnpm-lock.yaml && git commit -m 'chore: update lockfile'" >&2
  hook_git_in "$PROJECT_DIR" checkout -- pnpm-lock.yaml 2>/dev/null || true
  exit 2
fi

# Nothing is printed on the clean path. Both lines that used to sit here narrated progress on
# every successful push and carried nothing the operator could act on; a guard that speaks when
# it has nothing to say is one people learn to scroll past, and then its refusals scroll past too.
# --- the review round belongs BEFORE this push -------------------------------------------------
#
# `pr-finding-resolution-loop` used to wait for required checks to go green before its FIRST review
# round, so the reviewer only ever saw a diff that had already been pushed, opened as a PR and run
# through CI. Every finding therefore cost a push → CI round trip before anyone could look at it.
#
# Measured across one session (2026-07-28), PRs #1514/#1518/#1519/#1520/#1521: 38 rounds, 24 of them
# carrying a blocking finding, at 6–10 minutes of CI each. None of those findings needed CI to be
# seen; every one was read out of the diff. Several were regressions introduced by the previous
# round's fix, which a review of the next diff would have caught just as cheaply. The reviewer agent
# already accepts a local diff — only the precondition forced the trip.
#
# What this checks is that a review RAN at this commit and reported zero gating findings. It cannot
# check that the review was good; a hook judging that would be measuring the wrong thing. Its value
# is that the round happens here rather than eight minutes from now.
#
# Not enforced for the integration branches or a promotion branch: a promotion carries develop's
# already-reviewed content and no diff of its own.
# Deliberately NOT the same list as the branch-hygiene exemption above, which answers a different
# question. That one asks "does comparing this branch to develop mean anything", so it exempts every
# `release/*` and `hotfix/*` because their base is not develop. This one asks "does this push carry
# a diff someone should have reviewed", and a hotfix or a release branch carries exactly that — they
# are the pushes least worth waving through. Only `release/promote-*` is exempt here, because a
# promotion carries develop's already-reviewed content and no diff of its own.
#
# `gh-pages` is exempt for the same reason as the integration branches: it is published output, not
# a reviewed change set.
#
# Review flagged the difference as possible drift and asked whether it was intentional. It is, and
# the tests below pin every entry so unifying the lists breaks loudly instead of quietly.
case "$CUR_BRANCH" in
  main | master | develop | gh-pages | release/promote-*) exit 0 ;;
esac


# The override must be an env prefix OF THE PUSH, not a token loose in the command. Matched
# anywhere, `PRE_PUSH_ALLOW_UNREVIEWED=1 date; git push …` disarms the gate with an assignment that
# belongs to an unrelated statement and never reaches the push. `merge-gate` already carries this
# correction; applying it there and not here is the sibling asymmetry this session kept finding.
#
# And it excuses only the pushes it actually prefixes. `PRE_PUSH_ALLOW_UNREVIEWED=1 git push a &&
# git push b` overrides the first push and not the second in real shell semantics, so letting the
# whole command through would grant an unearned bypass to the second — the one direction this file
# never trades in. When some pushes are unprefixed the override does not apply and the record check
# below decides for all of them.
PUSH_RE='(^|[;&|({"'"'"'`]|[[:space:]])[[:space:]]*(\S+=\S+[[:space:]]+)*git[[:space:]]+((-C|-c)[[:space:]]+\S+[[:space:]]+)*push\b'
ACK_RE='(^|[[:space:];&|(])PRE_PUSH_ALLOW_UNREVIEWED=1([[:space:]]+[[:alnum:]_]+=[^[:space:]]+)*[[:space:]]+git[[:space:]]+((-C|-c)[[:space:]]+[^[:space:]]+[[:space:]]+)*push\b'
PUSH_COUNT=$(printf '%s' "$COMMAND_VERBS" | grep -oE "$PUSH_RE" | grep -c . || true)
ACK_COUNT=$(printf '%s' "$COMMAND_VERBS" | grep -oE "$ACK_RE" | grep -c . || true)

if [[ "$ACK_COUNT" -gt 0 && "$ACK_COUNT" -ge "$PUSH_COUNT" ]]; then
  echo "[pre-push-check] Override: PRE_PUSH_ALLOW_UNREVIEWED=1 — this push carries an unreviewed diff." >&2
  exit 0
fi

# A detached HEAD has no branch to key a record against, and falling through produced a single
# shared filename — `.agents/local-reviews/.json` — that every detached push would satisfy for every
# other. The branch-hygiene check above exempts the empty case because it has nothing to compare;
# this one has something to protect and no key for it, so it refuses. Review asked whether the
# difference was intentional: it is now, and stated.
if [[ -z "$CUR_BRANCH" ]]; then
  echo "[pre-push-check] Blocked: pushing from a detached HEAD, so a review record cannot be keyed" >&2
  echo "[pre-push-check] to a branch. Check out the branch you are pushing, or override inline:" >&2
  echo "[pre-push-check] PRE_PUSH_ALLOW_UNREVIEWED=1 git push …" >&2
  exit 2
fi

# The verdict comes from `record-local-review.mjs --show`, which owns it. The first version of this
# block re-parsed the record with grep in bash — reproducing, in the read path, the duplicated-logic
# drift the comment below it complains about. Two implementations agree until one of them changes.
# Resolved beside the hook, not inside the checkout being judged: the recorder ships with the hook,
# and the hook is what decides. WHICH checkout is judged is passed as the working directory instead,
# which is why the recorder resolves its repository from `cwd` rather than from its own location.
RECORDER="$(dirname "${BASH_SOURCE[0]}")/../../scripts/harness/record-local-review.mjs"

if ! command -v node >/dev/null 2>&1 || [[ ! -f "$RECORDER" ]]; then
  echo "[pre-push-check] Blocked: cannot check the review record (node or the recorder is missing)," >&2
  echo "[pre-push-check] so whether this diff was reviewed is unknown. Override inline:" >&2
  echo "[pre-push-check] PRE_PUSH_ALLOW_UNREVIEWED=1 git push …" >&2
  exit 2
fi

if ! REVIEW_STATE=$(cd "$PROJECT_DIR" && node "$RECORDER" --show 2>&1); then
  # --- but only one reviewer owns a diff at a time (HARNESS-074) --------------------------------
  #
  # Once a pull request is OPEN, its review automation reviews every push and carries the history of
  # the rounds before it. That is the reviewer this repository delegates to. Demanding a second,
  # local, subjective review before each of those pushes did not add a reviewer — it multiplied the
  # remote ones, because the loop pushed once per local round and every push bought another remote
  # review of the same change. The cost argument above is what makes that damage visible rather than
  # contradicting it: a round is cheap HERE, and expensive when it causes a push.
  #
  # Before the pull request exists nothing has reviewed this diff, so the argument stands untouched
  # and the demand stays.
  #
  # Asked only on the path that would otherwise block, so a recorded review still touches no network,
  # and one lookup is spent only where the alternative is a refusal. Unknown is not open: no `gh`,
  # no authentication, no network, or no pull request all reach the same refusal the gate gave before
  # this exemption existed — an exemption that opens on a failed measurement is a vacuous green.
  #
  # `gh pr list --head` and not `gh pr view "$CUR_BRANCH"`: `pr view` takes a number, a URL or a
  # branch and decides which by shape, so a branch named `42` would be answered with pull request
  # #42's state — a waiver granted on some other change's evidence. `--head` only ever means a branch.
  if [[ "$(cd "$PROJECT_DIR" &&
    bounded_gh pr list --head "$CUR_BRANCH" --state open --json number --jq 'length')" =~ ^[1-9] ]]; then
    echo "[pre-push-check] Open pull request on '$CUR_BRANCH': its review automation owns the review" >&2
    echo "[pre-push-check] of this push. Resolve what that review reports; do not review it again." >&2
    exit 0
  fi

  echo "[pre-push-check] Blocked: ${REVIEW_STATE:-no local review recorded}." >&2
  # The base depends on the branch. This file's own hygiene section documents `release/*` and
  # `hotfix/*` as based on main, and those branches are deliberately NOT exempt from this gate — so
  # naming develop unconditionally pointed a blocked hotfix at the wrong diff.
  case "$CUR_BRANCH" in
    release/* | hotfix/*) REVIEW_BASE=origin/main ;;
    *) REVIEW_BASE=origin/develop ;;
  esac
  echo "[pre-push-check] Review the local diff first (git diff ${REVIEW_BASE}...HEAD), resolve every" >&2
  echo "[pre-push-check] MUST/SHOULD, then: pnpm harness:review:record -- --findings 0" >&2
  echo "[pre-push-check] A round here costs a minute; the same round after a push costs a CI cycle." >&2
  echo "[pre-push-check] Deliberate exception: PRE_PUSH_ALLOW_UNREVIEWED=1 inline." >&2
  exit 2
fi

exit 0
