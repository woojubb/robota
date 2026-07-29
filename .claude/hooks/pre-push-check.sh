#!/bin/bash
# pre-push-check.sh
# Before git push: cheap, fast branch-hygiene + lockfile gates ONLY.
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
# shellcheck source=lib/command-scan.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/command-scan.sh"

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

# Heredoc bodies and comments are text; only the rest is a command. Shared with the other Bash
# hooks so all three answer "what will run" the same way.
COMMAND_EXEC=$(hook_executable_part "$COMMAND")
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
printf '%s' "$COMMAND_VERBS" | grep -qE '(^|[;&|({"'"'"'`]|[[:space:]])[[:space:]]*(\S+=\S+[[:space:]]+)*git[[:space:]]+((-C|-c)[[:space:]]+\S+[[:space:]]+)*push([[:space:]]|$)' || exit 0

# Worktree-aware context resolution (parallel-wave lesson): judge the repo the command actually runs
# in — `git -C <path>` in the command > hook-input `cwd` > project dir — never blindly the main clone.
HOOK_CWD=$(hook_cwd_of "$INPUT" || true)
# One extractor, matched against a masked command so a quoted mention of `git -C` cannot
# redirect this guard at another repository. See lib/command-scan.sh.
GIT_C_PATH=$(hook_git_c_path "$COMMAND_EXEC" || true)
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
if [[ -n "$HOOK_CWD" ]] && git -C "$HOOK_CWD" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  PROJECT_DIR="$HOOK_CWD"
fi
if [[ -n "$GIT_C_PATH" ]] && git -C "$GIT_C_PATH" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  PROJECT_DIR="$GIT_C_PATH"
fi

echo "[pre-push-check] Running fast pre-push gates (branch hygiene, lockfile sync)..." >&2

# ── 0. Branch-base hygiene (git-branch.md: feature branches start from origin/develop) ──────────
# After a develop→main promotion, `main` sits AHEAD of `develop`. A branch cut from `main` (or that
# merged one in) and PR'd to develop carries the promotion's merge commits in its `origin/develop..HEAD`
# range, which land in the PR range and fail commitlint. A clean feature/docs branch has ZERO merge
# commits over origin/develop. Skip integration/detached branches and when origin/develop is absent.
CUR_BRANCH=$(git -C "$PROJECT_DIR" branch --show-current 2>/dev/null || echo "")
case "$CUR_BRANCH" in
  # release/* and hotfix/* are promotion branches — they LEGITIMATELY carry the `git merge --no-ff origin/main`
  # that records main's ancestry into a develop→main promotion (INFRA-051, built by
  # scripts/harness/promote.mjs), so exempt them from the "no foreign merge commits" check that targets
  # feature branches accidentally based on `main`.
  main | master | develop | release/* | hotfix/* | "") : ;;
  *)
    if git -C "$PROJECT_DIR" rev-parse --verify --quiet origin/develop >/dev/null 2>&1; then
      FOREIGN_MERGES=$(git -C "$PROJECT_DIR" log --merges --oneline origin/develop..HEAD 2>/dev/null || true)
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

if ! git -C "$PROJECT_DIR" diff --quiet pnpm-lock.yaml 2>/dev/null; then
  echo "[pre-push-check] Blocked: pnpm-lock.yaml has uncommitted changes. Commit the lockfile before pushing." >&2
  exit 2
fi

if ! git -C "$PROJECT_DIR" diff --cached --quiet pnpm-lock.yaml 2>/dev/null; then
  echo "[pre-push-check] Blocked: pnpm-lock.yaml is staged but not committed. Commit it first." >&2
  exit 2
fi

cd "$PROJECT_DIR"

pnpm install --prefer-offline --silent 2>/dev/null || pnpm install --silent 2>/dev/null || true

if ! git -C "$PROJECT_DIR" diff --quiet pnpm-lock.yaml 2>/dev/null; then
  echo "[pre-push-check] Blocked: pnpm-lock.yaml is out of sync with package.json files." >&2
  echo "[pre-push-check] Run: pnpm install && git add pnpm-lock.yaml && git commit -m 'chore: update lockfile'" >&2
  git -C "$PROJECT_DIR" checkout -- pnpm-lock.yaml 2>/dev/null || true
  exit 2
fi

echo "[pre-push-check] Branch hygiene + lockfile checks passed. Proceeding with push." >&2
# --- the review round belongs BEFORE this push -------------------------------------------------
#
# `pr-review-orchestration` used to wait for required checks to go green before its FIRST review
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
case "$CUR_BRANCH" in
  main | master | develop | gh-pages | release/promote-*) exit 0 ;;
esac

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
  echo "[pre-push-check] Blocked: ${REVIEW_STATE:-no local review recorded}." >&2
  echo "[pre-push-check] Review the local diff first (git diff origin/develop...HEAD), resolve every" >&2
  echo "[pre-push-check] MUST/SHOULD, then: pnpm harness:review:record -- --findings 0" >&2
  echo "[pre-push-check] A round here costs a minute; the same round after a push costs a CI cycle." >&2
  echo "[pre-push-check] Deliberate exception: PRE_PUSH_ALLOW_UNREVIEWED=1 inline." >&2
  exit 2
fi

exit 0
