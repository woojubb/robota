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
# The whole-command mask, tokenized ONCE. Every per-statement mask below is a byte-aligned SLICE of
# this string, not a fresh `hook_verb_scan` over the whole command per statement — that re-parse was
# O(N²) in the statement count and made a 60-statement chain take seconds (HARNESS-083). Guarded:
# a bare assignment from a failing command substitution aborts the hook under set -e (exit 1, which
# the protocol reads as non-blocking), and the push-detection grep below would then find nothing in
# an empty mask and exit 0 — fail-OPEN. An unreadable command is refused instead.
if ! COMMAND_VERBS=$(hook_verb_scan "$COMMAND" 2>/dev/null); then
  echo "[pre-push-check] Blocked: this command could not be tokenized, so whether it pushes — and" >&2
  echo "[pre-push-check] which repository it would act on — is unknown. This is not a pass." >&2
  exit 2
fi

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
# ONE spelling of "this statement is a push", reused by the per-statement walk AND by the
# override/ACK counting below (PUSH_RE) — a second copy of the pattern is a second answer waiting
# to disagree (#1667 review; lib/command-scan.sh carries this file's history of exactly that).
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
# A SEEN flag, not `-n "$PUSH_DIR"`, decides whether a prior push exists: the first push can
# legitimately resolve to the EMPTY string (no cwd in the payload — "Absence is normal" — no `cd`,
# no `-C`, the bare-push-in-session case that falls back to the project dir). Testing `-n` then
# read that empty first push as "no push yet", so a second push to a DIFFERENT repo overwrote it
# with no conflict and the first push went unverified. (#1667 review)
PUSH_SEEN=false
PUSH_DIR_EXPLICIT=false
PUSH_DIR_CONFLICT=false
LAST_CD=""
LAST_CD_UNREADABLE=false
# Whether the cd that set LAST_CD was itself CONDITIONAL (`&&`-guarded) — its effect is certain
# only if the push is `&&`-chained back to it. (#1667 review)
LAST_CD_CONDITIONAL=false
PUSHD_STACK=()
# Subshell scope. A `cd` inside `( … )` applies to commands WITHIN that subshell but NEVER to the
# parent shell after the `)` — `(cd /w && npm ci); git push` runs the push in the ORIGINAL dir, not
# /w. A single-statement `PS_TAIL` check saw only a `)` in the same statement as the cd; a subshell
# spanning statements (`(cd /w`, then `npm ci)`) leaked its cd past the close entirely. So the dir
# state is SAVED at every `(` and RESTORED at every `)`: a cd done inside is visible until the close
# and discarded after. Closes are applied at the TOP of the NEXT statement (and after the loop), so
# a push in the SAME statement as its own closing `)` — `(cd /w && git push)` — still resolves
# against the in-subshell dir before the restore. (#1667 review)
SUBSHELL_STACK_CD=()
SUBSHELL_STACK_UNREAD=()
SUBSHELL_STACK_COND=()
PENDING_CLOSES=0
STATEMENT_RANGES=$(hook_statement_ranges "$COMMAND" || printf '')
if [[ -z "${STATEMENT_RANGES//[[:space:]]/}" ]]; then
  echo "[pre-push-check] Blocked: the command could not be split into statements, so which" >&2
  echo "[pre-push-check] repository this push acts on was never read. This is not a pass." >&2
  exit 2
fi
PREV_STMT_END=0
while read -r PS_START PS_LEN; do
  # The connector JOINING this statement to the previous one — the text in the gap the ranges
  # discard. `A || B` runs B only when A FAILED, so the linear walk (every statement runs, in
  # order) is wrong for a `||`-guarded statement: `cd /a || cd /b && git push` lands the push in
  # /a when /a exists (|| short-circuits, cd /b never runs) but the walk would carry /b forward,
  # judging the wrong repository — the #1662 defect in its more dangerous under-refusing form. A
  # `||`-guarded directory change is therefore UNCERTAIN, not a definite base. (#1667 review)
  PS_CONNECTOR="${COMMAND:$PREV_STMT_END:$((PS_START - 1 - PREV_STMT_END))}"
  PS_STMT_END=$((PS_START - 1 + PS_LEN))
  PREV_STMT_END="$PS_STMT_END"
  PS_OR_GUARDED=false
  [[ "$PS_CONNECTOR" == *'||'* ]] && PS_OR_GUARDED=true
  # `&&` before a statement means it runs only if the PRIOR command succeeded — conditional, just
  # like `||`, but in the other direction. A cd so guarded is CERTAIN to have taken effect only
  # when the push is itself reached through an unbroken `&&` chain from it (push runs ⟹ every
  # `&&`-linked command before it, including the cd, succeeded). If a `;` or `||` breaks that chain
  # between the cd and the push, the cd may not have run while the push still does. Tracked here and
  # resolved at the push. (#1667 review)
  PS_AND_GUARDED=false
  [[ "$PS_CONNECTOR" == *'&&'* ]] && PS_AND_GUARDED=true
  # A `cd` that runs in a SUBSHELL never propagates its directory to a later statement, so its
  # effect must be IGNORED, not carried forward. Both sides of a pipe run in subshells, and a
  # backgrounded (`&`) command does too. The connector AFTER a statement is the operator that
  # applies to IT — a background `&` and a pipe `|` bind to the command on their LEFT — while a
  # pipe on the connector BEFORE binds to the command on its right. `||`/`&&` are two-char and
  # must not be mistaken for the single `|`/`&`. (#1667 review)
  PS_AFTER="${COMMAND:$PS_STMT_END}"
  PS_AFTER="${PS_AFTER#"${PS_AFTER%%[![:space:]]*}"}"
  PS_SUBSHELLED=false
  [[ "$PS_CONNECTOR" != *'||'* && "$PS_CONNECTOR" == *'|'* ]] && PS_SUBSHELLED=true
  case "$PS_AFTER" in
    '||'* | '&&'*) : ;;
    '|'* | '&'*) PS_SUBSHELLED=true ;;
  esac
  # This statement's mask is a SLICE of the once-tokenized whole-command mask — the same bytes
  # `hook_verb_scan "$COMMAND" "$PS_START" "$PS_LEN"` returned, since the mask is byte-aligned with
  # the command, but without a fresh awk fork per statement (HARNESS-083). The whole-command tokenize
  # was already guarded above, so there is no per-statement failure mode left to catch here.
  PS_MASK="${COMMAND_VERBS:$((PS_START - 1)):$PS_LEN}"
  # Subshell CLOSES pending from the previous statement are applied HERE, before this statement runs
  # — restoring the dir state saved at the matching `(`. Deferring to the next statement's top (not
  # the end of the closing statement) means a push sharing a statement with its own `)` has already
  # resolved against the in-subshell dir. (#1667 review)
  while (( PENDING_CLOSES > 0 )); do
    if (( ${#SUBSHELL_STACK_CD[@]} > 0 )); then
      _SS_TOP=$(( ${#SUBSHELL_STACK_CD[@]} - 1 ))
      LAST_CD="${SUBSHELL_STACK_CD[$_SS_TOP]}"
      LAST_CD_UNREADABLE="${SUBSHELL_STACK_UNREAD[$_SS_TOP]}"
      LAST_CD_CONDITIONAL="${SUBSHELL_STACK_COND[$_SS_TOP]}"
      unset "SUBSHELL_STACK_CD[$_SS_TOP]" "SUBSHELL_STACK_UNREAD[$_SS_TOP]" "SUBSHELL_STACK_COND[$_SS_TOP]"
    fi
    PENDING_CLOSES=$((PENDING_CLOSES - 1))
  done
  # This statement's own SUBSHELL-GROUP parens, counted on the MASK (quoted parens are fill). A
  # command/process substitution — `$( … )`, `<( … )`, `>( … )` — is NOT a subshell that scopes the
  # surrounding cd: `cd /pre$(x)post` runs the cd in the CURRENT shell, the `$( )` only produces
  # part of the argument. Its parens are balanced within the one statement, so they are subtracted
  # from both the open and close counts and never trigger a save/restore (which would erase the
  # target-is-unreadable verdict the `$` earns). STATED LIMIT: arithmetic `$(( … ))` / `(( … ))` is
  # not special-cased — rare on a push command line, and its extra paren fails toward a refusal, not
  # a bypass. (#1667 review)
  _SS_ALLOPEN="${PS_MASK//[^(]/}"
  _SS_ALLCLOSE="${PS_MASK//[^)]/}"
  _SS_CMDSUB=0
  for _SS_PAT in '$(' '<(' '>('; do
    _SS_STRIPPED="${PS_MASK//"$_SS_PAT"/}"
    _SS_CMDSUB=$(( _SS_CMDSUB + (${#PS_MASK} - ${#_SS_STRIPPED}) / 2 ))
  done
  _SS_OPENS_N=$(( ${#_SS_ALLOPEN} - _SS_CMDSUB ))
  _SS_CLOSES_N=$(( ${#_SS_ALLCLOSE} - _SS_CMDSUB ))
  if (( _SS_OPENS_N < 0 )); then _SS_OPENS_N=0; fi
  if (( _SS_CLOSES_N < 0 )); then _SS_CLOSES_N=0; fi
  _SS_I=0
  while (( _SS_I < _SS_OPENS_N )); do
    SUBSHELL_STACK_CD+=("$LAST_CD")
    SUBSHELL_STACK_UNREAD+=("$LAST_CD_UNREADABLE")
    SUBSHELL_STACK_COND+=("$LAST_CD_CONDITIONAL")
    _SS_I=$((_SS_I + 1))
  done
  PENDING_CLOSES=$_SS_CLOSES_N
  # A bash-native `*push*` pre-filter short-circuits the grep for every statement that cannot be a
  # push — `RE_PUSH_STMT` requires the literal `push`, and PS_MASK is what the grep reads, so a mask
  # without that substring can never match. This spends no fork on the ordinary commands of a long
  # chain while leaving the exact grep engine to DECIDE the statements that could be pushes.
  # (HARNESS-083)
  if [[ "$PS_MASK" == *push* ]] && printf '%s' "$PS_MASK" | grep -qE "$RE_PUSH_STMT"; then
    # Whether this push's directory was named EXPLICITLY — a `-C` or a tracked `cd` — as opposed
    # to the HOOK_CWD fallback (the bare-`git push`-in-session case). Only an explicit target that
    # turns out not to be a work tree is refused below; the fallback keeps its existing handling.
    PS_DIR_EXPLICIT=false
    # 1. This statement's own `git -C`.
    PS_DIR=$(hook_git_c_path "$COMMAND" "$PS_START" "$PS_LEN" 2>/dev/null || printf '')
    [[ -n "$PS_DIR" ]] && PS_DIR_EXPLICIT=true
    # A `||`-guarded push with no `-C` of its own runs only when the prior command FAILED — so
    # the directory the walk tracked (from the branch that succeeded) is not where this push
    # lands. Its base is unknowable; refuse rather than judge the wrong repository. (#1667 review)
    if [[ -z "$PS_DIR" && "$PS_OR_GUARDED" == "true" ]]; then
      echo "[pre-push-check] Blocked: this push runs only if a preceding command failed (\`||\`)," >&2
      echo "[pre-push-check] so which directory it lands in depends on that failure and cannot be" >&2
      echo "[pre-push-check] read here. Name the repository explicitly: git -C <path> push …" >&2
      exit 2
    fi
    if [[ -z "$PS_DIR" ]]; then
      # 2. The last `cd` seen before this statement.
      if [[ "$LAST_CD_UNREADABLE" == "true" ]]; then
        echo "[pre-push-check] Blocked: a \`cd\` earlier in this command has a target this hook" >&2
        echo "[pre-push-check] cannot read (quoted, a variable, or bare), so which repository the" >&2
        echo "[pre-push-check] push acts on is unknown. Name it: git -C <path> push …" >&2
        exit 2
      fi
      # The tracked `cd` was CONDITIONAL (`&&`-guarded) and this push is not `&&`-chained back to
      # it — a `;` or `||` sits between, so the push runs even if that cd never did, landing
      # somewhere other than the dir the walk carried. `cd /A && git push` (push `&&`-chained) is
      # certain and passes; `false && cd /A ; git push` (push `;`-separated) is not. Refuse the
      # uncertain shape rather than judge the wrong repository. (#1667 review)
      if [[ -n "$LAST_CD" && "$LAST_CD_CONDITIONAL" == "true" && "$PS_CONNECTOR" != *'&&'* ]]; then
        echo "[pre-push-check] Blocked: a \`cd\` this push relies on runs only if a preceding" >&2
        echo "[pre-push-check] command succeeded (\`&&\`), but this push is not chained to that" >&2
        echo "[pre-push-check] success — it would run even where the cd did not. Which repository" >&2
        echo "[pre-push-check] it lands in is unknown; name it: git -C <path> push …" >&2
        exit 2
      fi
      # A tracked `cd` named this directory (explicit); an empty LAST_CD means the HOOK_CWD
      # fallback (bare push in session), which is NOT explicit.
      [[ -n "$LAST_CD" ]] && PS_DIR_EXPLICIT=true
      PS_DIR="${LAST_CD:-$HOOK_CWD}"
    fi
    # Compare on a trailing-slash-normalized form so `-C /repo` and `-C /repo/` are not read as two
    # different repositories (fail-closed over-refusal). STATED LIMIT: this is a string compare, so
    # two spellings that only a filesystem could equate — a relative `-C ../repo` vs a cd-absolutized
    # path, or a symlink — can still over-refuse. Canonicalizing would mean a rev-parse per push on a
    # directory that may not exist yet (the mkdir case), so the cheap normalization covers the common
    # spelling and the rest stays a documented fail-closed edge. (#1667 review)
    _PS_DIR_NORM="$PS_DIR"; while [[ "$_PS_DIR_NORM" == */ && "$_PS_DIR_NORM" != "/" ]]; do _PS_DIR_NORM="${_PS_DIR_NORM%/}"; done
    _PUSH_DIR_NORM="$PUSH_DIR"; while [[ "$_PUSH_DIR_NORM" == */ && "$_PUSH_DIR_NORM" != "/" ]]; do _PUSH_DIR_NORM="${_PUSH_DIR_NORM%/}"; done
    if [[ "$PUSH_SEEN" == "true" && "$_PS_DIR_NORM" != "$_PUSH_DIR_NORM" ]]; then
      PUSH_DIR_CONFLICT=true
    fi
    # OR-latch the "was any push to this dir EXPLICIT?" invariant rather than overwriting it with
    # the last statement's value. Two pushes to the same normalized dir where one is explicit
    # (`cd`/`-C`) and one is the HOOK_CWD fallback would otherwise let the fallback's `false` flip
    # it off, skipping the not-a-work-tree refusal below. No current bypass (the shapes converge on
    # the already-permitted bare-push-in-session path), but the invariant should not hinge on
    # statement order. (#1667 review)
    if [[ "$PUSH_SEEN" == "true" ]]; then
      if [[ "$PS_DIR_EXPLICIT" == "true" ]]; then PUSH_DIR_EXPLICIT=true; fi
    else
      PUSH_DIR_EXPLICIT="$PS_DIR_EXPLICIT"
    fi
    PUSH_SEEN=true
    PUSH_DIR="$PS_DIR"
  else
    # A statement can only change directory if it runs `cd`, `pushd`, or `popd`. Skipping the word
    # tokenization for statements that cannot is what makes a long ordinary chain — `echo a && echo
    # b && … && git push`, the shape that made this hook take seconds — cost no per-statement fork.
    # (HARNESS-083)
    #
    # The skip is only safe when the raw text CANNOT be hiding the builtin, and the shell has many
    # ways to hide it. A SPLICE assembles the name from pieces that no `cd`-shaped substring shows:
    # `"c""d"`, `c\d`, `c$()d`, a pair of empty backticks, `c${UNSET}d`, `c{d,x}` — and a glob
    # (`c?`) can even match a file named `cd`. Each was measured as a wrong-repository fail-open:
    # the statement was skipped, the push resolved to the session repo while the real cd moved
    # elsewhere, exit 0 where this hook had refused.
    #
    # So the second condition is an ALLOWLIST, not a blocklist of splice characters — enumerating
    # the ways a shell can splice is the whack-a-mole that produced two rounds of this same defect
    # (#1681 review, twice). The skip is taken ONLY for a statement built from inert characters:
    # letters, digits, whitespace and a few literal path/argument punctuation marks. Anything else —
    # any quote, backslash, dollar, backtick, brace, bracket, glob — forces the full walk, which is
    # what the ordinary long chain (`echo step1 && echo step2 && …`) does not contain, so the
    # perf win this task exists for is kept while the fail-open class is closed by construction.
    PS_RAW_STMT="${COMMAND:$((PS_START - 1)):$PS_LEN}"
    # Bash-native matches, no subprocess — a long chain of ordinary statements costs no forks here.
    if ! [[ "$PS_RAW_STMT" =~ (^|[^[:alnum:]_-])(cd|pushd|popd)([^[:alnum:]_-]|$) ]] \
      && [[ "$PS_RAW_STMT" =~ ^[[:alnum:][:space:]_./:=+@,%-]*$ ]]; then
      continue
    fi
    # Track directory changes so a later push statement is judged where it runs. Words-mode hides
    # quoted content and substitutions, so an unreadable target is DETECTED rather than guessed at.
    # A statement whose words cannot be READ is a statement whose directory changes cannot be
    # seen — the same answer every other unknowable gets, not a silent skip that leaves a later
    # push trusting a stale base. (#1667 review)
    #
    if ! PS_WORDS=$(hook_statement_words "$COMMAND" "$PS_START" "$PS_LEN" 2>/dev/null); then
      LAST_CD_UNREADABLE=true
      continue
    fi
    # WHICH COMMAND IS THIS? When the answer is an expansion the hook cannot resolve, the honest
    # answer is "unknown", and unknown is unreadable — a `cd` is exactly what it might be.
    #
    # Three shapes reach here, all measured as wrong-repository fail-opens (the push resolved to the
    # session repo, which held a clean record, while the real `cd` moved elsewhere — exit 0 where
    # this hook refuses for every other unknowable):
    #   `c${UNSET}d /repo`   the command word survives as `c${d`; words-mode cannot collapse a
    #                        PARAMETER splice the way it collapses `$( )` and backticks, because the
    #                        masker replaces the expansion (closing brace included) with fill.
    #   `$EDITOR /repo`      the command IS a variable. `EDITOR=cd` makes it a cd.
    #   `$(echo cd) /repo`   the substitution collapses to an EMPTY command word.
    # Collapsing them to `cd` would be worse than missing them: `c${HOME}d` is not a cd, and a guard
    # that guesses is a guard that refuses correct work. So this does not guess — it declines to
    # answer, which is the same answer an unreadable target already gets. (HARNESS-084, #1682)
    PS_CMD_UNRESOLVABLE=false
    _PS_SEEN_CMD=false
    while IFS= read -r _PS_CW; do
      [[ "$_PS_SEEN_CMD" == "true" ]] && break
      # An env-var assignment is a PREFIX, not the command — the same skip the word loop below makes.
      case "$_PS_CW" in *=*) continue ;; esac
      _PS_SEEN_CMD=true
      if [[ -z "$_PS_CW" || "$_PS_CW" == *'$'* || "$_PS_CW" == *'`'* ]]; then
        PS_CMD_UNRESOLVABLE=true
      fi
    done <<< "$PS_WORDS"
    if [[ "$PS_CMD_UNRESOLVABLE" == "true" ]]; then
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
    # A subshell opener `(` glues to the first word — `(cd <dir> && git push)` reads as `(cd` — and
    # an unstripped paren made the whole idiom invisible to this tracking: the push was judged
    # against the declared cwd, the exact wrong-repository answer this walk exists to end. Only `(`
    # is stripped here: it is a shell metacharacter that always tokenizes on its own, so `(cd` is
    # genuinely a cd.
    PS_FIRST="${PS_FIRST#"${PS_FIRST%%[!(]*}"}"
    # A BRACE group is different: `{` opens a group ONLY as its own space-delimited word (`{ cd
    # dir; …`), where the first word is bare `{` and the cd sits one word later — shift. A GLUED
    # `{cd` is NOT a group: bash runs it as the command `{cd`, which fails and changes no
    # directory, so it must stay a non-cd token, not be stripped to `cd`. Stripping `{` in the
    # same class as `(` read `{cd /reviewed-repo; git push` as a valid brace-group cd and judged
    # /reviewed-repo while the real push ran in the unreviewed cwd (fail-open). The empty case is
    # a bare `(` that stripped to nothing (`( cd dir …`). (#1667 review)
    if [[ -z "$PS_FIRST" || "$PS_FIRST" == "{" ]]; then
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
    # The same question after the prefixes are unwrapped: `command $EDITOR /repo` puts the
    # unresolvable word one position later, and `eval` runs text this hook never parses at all —
    # `eval "cd /repo"` is a directory change whose target lives inside a string. Both are unknown
    # commands, and unknown is unreadable. (HARNESS-084, #1682)
    if [[ "$PS_FIRST" == *'$'* || "$PS_FIRST" == *'`'* || "$PS_FIRST" == "eval" ]]; then
      LAST_CD_UNREADABLE=true
      continue
    fi
    # A `||`-guarded directory change runs only if the prior command failed, so whether it took
    # effect is unknowable — the base is uncertain, not the value it names. Only a cd/pushd/popd
    # matters here: a `||`-guarded NON-directory command (`foo || bar`) changes no directory, so
    # the base is unaffected and must not be poisoned. (#1667 review)
    if [[ "$PS_OR_GUARDED" == "true" && ( "$PS_FIRST" == "cd" || "$PS_FIRST" == "pushd" || "$PS_FIRST" == "popd" ) ]]; then
      # A `||`-guarded pushd/popd MIGHT have run, or might not — unlike a subshell'd one, which
      # certainly did not. Leaving the stack untouched let a later UNCONDITIONAL popd resolve a
      # frame with false confidence:
      #   `pushd /A; false || pushd /B; popd; git push`  — the pushd may have pushed a frame, and
      #   `pushd /A; pushd /B; false || popd; popd; git push` — the popd may have consumed one.
      # A `?` poison carries the uncertainty forward: a guarded pushd APPENDS one (the frame it may
      # have added), a guarded popd REPLACES the top (the frame it may have consumed), and either
      # way the next popd inherits the `?` and reads unreadable. (#1667 review)
      if [[ "$PS_FIRST" == "pushd" ]]; then
        PUSHD_STACK+=("?")
      elif [[ "$PS_FIRST" == "popd" && ${#PUSHD_STACK[@]} -gt 0 ]]; then
        PUSHD_STACK[$(( ${#PUSHD_STACK[@]} - 1 ))]="?"
      fi
      LAST_CD_UNREADABLE=true
      continue
    fi
    # A subshell'd cd/pushd/popd (either side of a `|`, or backgrounded with `&`) changed a
    # directory the parent shell never saw, so it is IGNORED — the base stays what it was, and a
    # later push resolves to that, not to this phantom. Distinct from `||` above, which is
    # UNCERTAIN (refuse): this one is certainly-no-effect. (#1667 review)
    if [[ "$PS_SUBSHELLED" == "true" && ( "$PS_FIRST" == "cd" || "$PS_FIRST" == "pushd" || "$PS_FIRST" == "popd" ) ]]; then
      continue
    fi
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
          # A `&&`-guarded popd is conditional like a `&&`-guarded cd. (#1667 review)
          LAST_CD_CONDITIONAL="$PS_AND_GUARDED"
          LAST_CD_UNREADABLE=false
        fi
      fi
    elif [[ "$PS_FIRST" == "pushd" && -z "$PS_SECOND" ]]; then
      # A bare `pushd` (no argument) does NOT go somewhere unknowable: bash swaps the top two
      # directory-stack entries and cd's to the new top — a directory this walk already knows.
      # Its model holds LAST_CD (the current dir) and PUSHD_STACK (the saved pre-pushd dirs),
      # so the swap exchanges LAST_CD with the stack top. Bash errors on a bare pushd with fewer
      # than two dirs on the stack (no prior pushd here), and a poisoned top or an unreadable
      # LAST_CD leaves the destination unknown — those refuse. Otherwise this is the ordinary
      # `pushd /a && pushd && git push` idiom that lands back where it began, and refusing it
      # was an over-refusal not covered by any earlier case. (#1667 review)
      if [[ ${#PUSHD_STACK[@]} -eq 0 || "$LAST_CD_UNREADABLE" == "true" ]]; then
        LAST_CD_UNREADABLE=true
      else
        _PUSHD_TOP=$(( ${#PUSHD_STACK[@]} - 1 ))
        _PUSHD_SWAP="${PUSHD_STACK[$_PUSHD_TOP]}"
        if [[ "$_PUSHD_SWAP" == "?" ]]; then
          LAST_CD_UNREADABLE=true
        else
          PUSHD_STACK[$_PUSHD_TOP]="${LAST_CD:-${HOOK_CWD:-.}}"
          LAST_CD="$_PUSHD_SWAP"
          LAST_CD_CONDITIONAL="$PS_AND_GUARDED"
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
      # NO raw occurrence at all is its own refusal: words-mode said this statement is a cd,
      # so a raw slice in which `cd `-followed-by-a-target cannot be found (`"cd" /x` — the
      # quoted builtin name breaks the adjacency the pattern needs) is a shape this reader
      # does not understand, and the target it failed to find is exactly the one it exists
      # to inspect. Measured: `"cd" /repo\`evil\`/path && git push` walked through with a
      # clean-looking PS_SECOND and a silently wrong LAST_CD. (#1667 review)
      if [[ -z "$RAW_TGT" ]]; then
        TARGET_HIDDEN=true
      fi
      # A target this hook cannot resolve, decided BEFORE the stack is touched: empty (quoted
      # away), `-`/flags, a variable or substitution (`$DIR`, or one EMBEDDED in the token —
      # TARGET_HIDDEN above), `~` (the hook does not expand another process's home), a `pushd`
      # stack rotation (`+N`/`-N`), a word still carrying a subshell paren — `(cd x) && push`
      # changes no directory the push will see — or a quote character, the tokenizer's mark of
      # hidden content (a quoted target with inner spaces words as bare quote marks).
      #
      # Closing a subshell is handled globally by the SUBSHELL_STACK save/restore above — a cd
      # inside `( … )`, however many statements the group spans, is discarded at its `)`. So the
      # per-target `)` tail check that used to live here is gone; what remains is the target itself
      # carrying a `(`/`)`, which is hidden content in the token, not a subshell boundary. (#1667)
      UNREADABLE_TARGET="$TARGET_HIDDEN"
      if [[ -z "$PS_SECOND" || "$PS_SECOND" == "-" || "$PS_SECOND" == -* || "$PS_SECOND" == *'$'* || "$PS_SECOND" == *'`'* || "$PS_SECOND" == '~'* || "$PS_SECOND" == *'('* || "$PS_SECOND" == *')'* || "$PS_SECOND" == *'"'* || "$PS_SECOND" == *"'"* ]] \
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
            # An ABSOLUTE cd does not depend on the base, so its conditionality is its OWN
            # connector alone — reset, not inherited. (#1667 review)
            LAST_CD_CONDITIONAL="$PS_AND_GUARDED"
            ;;
          *)
            # A RELATIVE hop resolves against where the shell already stands: the last tracked
            # `cd`, or the declared cwd when none. Resolving every hop against the declared cwd
            # sent the second hop of `cd .. && cd sibling && git push` to the wrong path — and
            # the fallback then judged the main clone, the exact pre-#1662 resolution, silently.
            # After an UNREADABLE cd the base is unknown, so a relative hop stays unreadable.
            if [[ "$LAST_CD_UNREADABLE" != "true" ]]; then
              LAST_CD="${LAST_CD:-${HOOK_CWD:-.}}/$PS_SECOND"
              # A relative hop INHERITS the base's conditionality — if the base cd may not have
              # run, neither did this hop off it — and adds its own. Never resets to certain.
              [[ "$PS_AND_GUARDED" == "true" ]] && LAST_CD_CONDITIONAL=true
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
# A push whose directory was named EXPLICITLY — a `-C` or a tracked `cd` — but which is not a git
# work tree at hook time is refused, not silently retargeted at the session checkout. `mkdir /x &&
# cd /x && git init && git push` names /x; `validated` mode, finding /x is not (yet) a repository,
# would fall back to CLAUDE_PROJECT_DIR and judge the MAIN checkout's branch and record — a false
# pass for a push that lands in an unreviewed new repo, the #1662 direction this hook exists to
# close. Every other unresolvable case here refuses; this one must too. Gated on PUSH_DIR_EXPLICIT
# so the bare-`git push`-in-session case (PUSH_DIR is only the HOOK_CWD fallback) keeps the
# existing "no git repository" handling at the PROJECT_DIR check below. (#1667 review)
if [[ "$PUSH_DIR_EXPLICIT" == "true" ]] && ! hook_is_work_tree "$PUSH_DIR"; then
  echo "[pre-push-check] Blocked: this push targets '$PUSH_DIR', which is not a git repository the" >&2
  echo "[pre-push-check] hook can read now (it may be created later in the same command). Its branch" >&2
  echo "[pre-push-check] and review record cannot be verified, and falling back to the session" >&2
  echo "[pre-push-check] checkout would judge the wrong repository. Push from an existing checkout." >&2
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

# --- a lockfile change nobody asked for ---------------------------------------------------------
#
# The checks above ask whether the lockfile is COMMITTED and IN SYNC. Neither asks the question that
# actually costs CI cycles: does this branch change `pnpm-lock.yaml` at all, when it changes no
# manifest?
#
# Measured on PR #1793 (2026-08-16). A local `pnpm install` dropped `dev: true` from the `sharp`
# family, moving it from a dev-only resolution into the production graph. No `package.json` on the
# branch differed from develop's, so nothing local looked wrong — but `dependency-review` refuses
# `@img/sharp-win32-*` (`LGPL-3.0-or-later`, outside the allowed set) the moment it becomes
# production-reachable. That cost TWO red CI runs and two re-reviews: one to fail, one to fail again
# after a fix aimed at the wrong cause.
#
# A lockfile diff with no manifest diff is churn, not intent. The remedy is one command and it is
# printed. `LOCKFILE_CHURN_ACK=1` is for the case where the resolution genuinely changed on purpose
# without a manifest edit (a registry republish, a pnpm upgrade) — state it, do not discover it in CI.
if [ -z "${LOCKFILE_CHURN_ACK:-}" ]; then
  merge_base="$(hook_git_in "$PROJECT_DIR" merge-base origin/develop HEAD 2>/dev/null || true)"
  if [ -n "$merge_base" ]; then
    lock_changed="$(hook_git_in "$PROJECT_DIR" diff --name-only "$merge_base" HEAD -- pnpm-lock.yaml 2>/dev/null || true)"
    manifests_changed="$(hook_git_in "$PROJECT_DIR" diff --name-only "$merge_base" HEAD -- '*package.json' 2>/dev/null || true)"
    if [ -n "$lock_changed" ] && [ -z "$manifests_changed" ]; then
      echo "[pre-push-check] Blocked: this branch changes pnpm-lock.yaml but no package.json." >&2
      echo "[pre-push-check] A lockfile diff with no manifest diff is install churn, not intent —" >&2
      echo "[pre-push-check] and a resolution moving a package into the production graph is what" >&2
      echo "[pre-push-check] dependency-review refuses, one CI cycle later." >&2
      echo "[pre-push-check] Restore it:  git checkout origin/develop -- pnpm-lock.yaml" >&2
      echo "[pre-push-check] Deliberate resolution change with no manifest edit: LOCKFILE_CHURN_ACK=1 inline." >&2
      exit 2
    fi
  fi
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
# The push detector IS RE_PUSH_STMT — the same spelling the per-statement walk uses, so the two
# cannot disagree. The earlier `push\b` copy differed from RE_PUSH_STMT's `push([^-[:alnum:]_]|$)`
# on `git push-x`: `\b` treats the `-` as a word boundary and matched, the explicit class does not.
# ACK_RE carries the `PRE_PUSH_ALLOW_UNREVIEWED=1` prefix so it cannot simply be RE_PUSH_STMT, but
# its push token uses the SAME boundary class now, not `\b`. (#1667 review)
PUSH_RE="$RE_PUSH_STMT"
ACK_RE='(^|[[:space:];&|(])PRE_PUSH_ALLOW_UNREVIEWED=1([[:space:]]+[[:alnum:]_]+=[^[:space:]]+)*[[:space:]]+git[[:space:]]+((-C|-c)[[:space:]]+[^[:space:]]+[[:space:]]+)*push([^-[:alnum:]_]|$)'
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
