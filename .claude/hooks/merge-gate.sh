#!/bin/bash
# Before `gh pr merge`: the two questions git-branch.md already requires, asked mechanically.
#
# `git-branch.md` § Pre-Merge Code-Review Gate says it plainly: "No CONFIRMED/PLAUSIBLE finding may
# be left silently unaddressed. **Only after all findings are resolved** may the PR be merged."
# `pr-review-orchestration` owns the loop that drives a PR to that state, and three agents implement
# it. All of that existed on 2026-07-28 — and it did not stop two merges past unread findings in one
# session (#1503, whose MUST needed #1507 to fix; #1510, whose High needed #1517).
#
# Written down was not enough, which is the finding of the recurrence audit (PROC-003). This hook is
# the missing half: the rule asks two questions, so the merge command must answer them before it runs.
#
#   1. Is CI green?  `mergeStateStatus == CLEAN`.
#   2. Has the review been read and resolved?
#
# On (2) the hook cannot judge whether a finding was ADDRESSED — that is the reviewer's call, and a
# hook pretending to make it would be a guard checking the wrong thing. What it CAN establish is that
# a review exists, that it is newer than the head commit it judges, and that nobody is merging while
# the reviewer's own machine-readable count says findings remain. A review older than the commit has
# not seen what is being merged.
#
# Override: MERGE_GATE_ACK=1 INLINE in the same command. It must be inline because this hook reads
# the command string — an `export` in an earlier statement never reaches it, the same property
# BRANCH_GUARD_ALLOW_DELETE has and for the same reason. An override is a visible choice; its use
# prints the reason it was needed.
set -euo pipefail

INPUT=$(cat)
# shellcheck source=lib/command-scan.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/command-scan.sh"

# The shared parser, for the reason it exists: the hand-rolled grep this replaces stopped at the
# first quote inside the command, and a `gh pr merge` written after any quoted argument was never
# examined. Refusing when it cannot decode is the same rule the other hooks follow — a gate that
# cannot read its subject must not wave it through.
if ! COMMAND=$(hook_command_of "$INPUT"); then
  echo "[merge-gate] Blocked: the tool command could not be decoded, so the merge cannot be judged." >&2
  echo "[merge-gate] Install jq or python3 so this gate can read what it is judging." >&2
  exit 2
fi
COMMAND_VERBS=$(hook_verb_scan "$COMMAND")

# Statement boundaries, not a start-anchor. A `^`-anchored matcher only fires when the whole command
# begins with the verb, and nearly every command here begins with `cd <repo>` — that defect made
# `pre-push-check` unreachable for an entire session. `\n` is the two literal characters that survive
# JSON extraction, which was the exact form that slipped through.
printf '%s' "$COMMAND_VERBS" |
  grep -qE '(^|[;&|({"'"'"'`]|[[:space:]])[[:space:]]*(\S+=\S+[[:space:]]+)*gh[[:space:]]+pr[[:space:]]+merge\b' || exit 0

# Deliberate bypass, stated in the output so it is never mistaken for the gate having passed.
# The override must be an env prefix OF THE MERGE, not a token loose in the command. Matched
# anywhere, `MERGE_GATE_ACK=1 date; gh pr merge 7 --merge` disarmed the gate while the assignment
# belonged to an unrelated statement — which is not the visible, deliberate choice the override is
# documented to be. Other assignments may sit between; a `;` or `&&` may not.
if printf '%s' "$COMMAND_VERBS" |
  grep -qE '(^|[[:space:];&|(])MERGE_GATE_ACK=1([[:space:]]+[[:alnum:]_]+=[^[:space:]]+)*[[:space:]]+gh[[:space:]]+pr[[:space:]]+merge\b'; then
  echo "[merge-gate] Override: MERGE_GATE_ACK=1 — CI and review state NOT verified by this hook." >&2
  exit 0
fi

# `|| true` on every extraction: under `set -e` a grep that matches nothing exits 1 and the command
# substitution aborts the whole hook — exit 1, no output, before a single check runs. A total bypass
# wearing the costume of a working guard. That is not hypothetical; it is what this hook did on its
# first run, and the same trap the hook audit hit hours earlier.
PR=$(printf '%s' "$COMMAND_VERBS" | grep -oE 'gh[[:space:]]+pr[[:space:]]+merge[[:space:]]+[0-9]+' |
  grep -oE '[0-9]+$' | head -1 || true)

# Fail closed. Every branch below that cannot answer refuses, because "I could not check" and
# "it is fine" are the two states a guard must never conflate — the whole subject of PROC-003.
# `gh pr merge` with no number means "the PR for the current branch", which is how it is usually
# written. Refusing that outright made the gate friction rather than a check, so it resolves the
# same way gh does. A failure to resolve is still a refusal: not knowing which PR is being merged
# and merging anyway are the two states this hook exists to keep apart.
if [[ -z "$PR" ]] && command -v gh >/dev/null 2>&1; then
  PR=$(gh pr view --json number --jq '.number' 2>/dev/null || true)
fi

if [[ -z "$PR" ]]; then
  echo "[merge-gate] Blocked: could not tell which PR this merges." >&2
  echo "[merge-gate] No number in the command, and no PR resolves for the current branch." >&2
  echo "[merge-gate] Pass it explicitly: gh pr merge <n> --merge" >&2
  exit 2
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "[merge-gate] Blocked: 'jq' is unavailable, so the review cannot be identified." >&2
  echo "[merge-gate] Verify by hand, then override inline: MERGE_GATE_ACK=1 gh pr merge <n> --merge" >&2
  exit 2
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "[merge-gate] Blocked: 'gh' is unavailable, so CI and review state cannot be read." >&2
  echo "[merge-gate] Verify by hand, then override inline: MERGE_GATE_ACK=1 gh pr merge $PR --merge" >&2
  exit 2
fi

STATE=$(gh pr view "$PR" --json mergeStateStatus --jq '.mergeStateStatus' 2>/dev/null || echo "")
if [[ -z "$STATE" ]]; then
  echo "[merge-gate] Blocked: could not read PR #$PR's merge state." >&2
  exit 2
fi

# --- 1. CI ------------------------------------------------------------------------------------
# BLOCKED means a required check has not passed. UNSTABLE means a non-required check failed — still
# a refusal here, because "a check failed and I merged anyway" is a decision, not a default.
if [[ "$STATE" != "CLEAN" ]]; then
  echo "[merge-gate] Blocked: PR #$PR is $STATE, not CLEAN." >&2
  FAILING=$(gh pr checks "$PR" 2>/dev/null | grep -E "$(printf '\t')fail$(printf '\t')" | head -3 | cut -f1 | tr '\n' ' ' || true)
  [[ -n "$FAILING" ]] && echo "[merge-gate]   failing: $FAILING" >&2
  echo "[merge-gate] Wait for CI, or fix what failed. Deliberate exception: MERGE_GATE_ACK=1 inline." >&2
  exit 2
fi

# --- 2. Review --------------------------------------------------------------------------------
# A review that predates the head commit has not seen what is about to be merged.
HEAD_AT=$(gh pr view "$PR" --json commits --jq '.commits[-1].committedDate' 2>/dev/null || echo "")

# The newest comment BY THE REVIEWER, not the newest comment. Reading `comments[-1]` unconditionally
# meant anyone — including the person merging — could post a remark after the review and satisfy both
# the recency check and the findings check with text that is not a review at all. A gate a single
# comment disarms is not a gate.
# Measured on this repository: `gh` reports the reviewing bot as `github-actions`, four matches to
# zero against the `[bot]` spelling. Both are accepted anyway — the exact normalisation is gh's to
# change, and a gate that silently stops recognising reviews would block every merge and teach
# everyone to pass MERGE_GATE_ACK=1, which is the bypass it exists to prevent.
REVIEWER_RE='^github-actions(\\[bot\\])?$'
LAST_REVIEW=$(gh pr view "$PR" --json comments \
  --jq "[.comments[] | select(.author.login | test(\"$REVIEWER_RE\"))] | last // {}" 2>/dev/null || echo '{}')
LAST_REVIEW_AT=$(printf '%s' "$LAST_REVIEW" | jq -r '.createdAt // ""' 2>/dev/null || echo "")

if [[ -z "$LAST_REVIEW_AT" ]]; then
  # Distinguish "nobody reviewed" from "the reviewer is not who this gate thinks it is". Reported
  # identically, a name mismatch reads as a missing review forever and is diagnosed by nobody.
  AUTHORS=$(gh pr view "$PR" --json comments --jq '[.comments[].author.login] | unique | join(", ")' 2>/dev/null || echo "")
  if [[ -n "$AUTHORS" ]]; then
    echo "[merge-gate] Blocked: no comment on #$PR is from the reviewer this gate looks for." >&2
    echo "[merge-gate]   looked for: $REVIEWER_RE   comments are from: $AUTHORS" >&2
    echo "[merge-gate] If the reviewer's login changed, fix REVIEWER_RE — do not route around it." >&2
    exit 2
  fi
  echo "[merge-gate] Blocked: PR #$PR carries no review comment." >&2
  echo "[merge-gate] git-branch.md requires findings resolved before merge; there is nothing to resolve" >&2
  echo "[merge-gate] against. Run the review, or override inline if this PR is out of that gate's scope." >&2
  exit 2
fi

# Fail closed on an unreadable head date. `-n "$HEAD_AT" && …` skipped the whole recency check when
# the extraction returned empty — reading "I could not tell" as "it is fine", which is the exact
# conflation this hook's own header forbids. Review's MUST, and correct.
if [[ -z "$HEAD_AT" ]]; then
  echo "[merge-gate] Blocked: could not read PR #$PR's head commit date, so review recency is unknown." >&2
  echo "[merge-gate] Verify by hand, then override inline: MERGE_GATE_ACK=1 gh pr merge $PR --merge" >&2
  exit 2
fi

if [[ "$LAST_REVIEW_AT" < "$HEAD_AT" ]]; then
  echo "[merge-gate] Blocked: the newest review on #$PR predates its head commit." >&2
  echo "[merge-gate]   review: $LAST_REVIEW_AT   head: $HEAD_AT" >&2
  echo "[merge-gate] It judged code that is no longer what would merge. Wait for the re-review." >&2
  exit 2
fi

# The reviewer's own machine-readable count, when it emitted one. `pr-review-reviewer` declares
# `ACTIONABLE FINDINGS: <n>` as its output contract precisely so a pipeline can route on it.
BODY=$(printf '%s' "$LAST_REVIEW" | jq -r '.body // ""' 2>/dev/null || echo "")
# The LAST numeric match, not the first: the contract puts the count on the summary's final line,
# and a review quoting an earlier round carries that round's number ahead of its own.
COUNT=$(printf '%s' "$BODY" | grep -oiE 'ACTIONABLE FINDINGS:[[:space:]]*[0-9]+' | grep -oE '[0-9]+' | tail -1 || true)
if [[ -n "$COUNT" && "$COUNT" != "0" ]]; then
  echo "[merge-gate] Blocked: the review on #$PR reports ACTIONABLE FINDINGS: $COUNT." >&2
  echo "[merge-gate] Resolve them, then re-review. git-branch.md: only after ALL findings are resolved." >&2
  exit 2
fi

# The gate stops here on purpose. Whether a finding written in prose was addressed is the reviewer's
# judgement, and a hook guessing at it would be a check measuring the wrong thing. What it has
# established: CI is green, a review exists, and it is newer than what is being merged.
#
# An absent count is a refusal, like every other unreadable state in this file. It was a warning and
# an exit 0, on the argument that only 4 of the 38 most recent reviews carried the marker and a
# refusal would make the override routine. That argument is spent: the count is now required of the
# reviewer in claude-code-review.yml, and the review that produced this change carried it. What
# remains is the script's own rule, which the findings check was the single exception to — "I could
# not check" and "it is fine" are the two states a guard must never conflate, and a review with real
# findings written only in prose is exactly the merge-past-findings incident (#1503, #1510) this
# hook exists to stop.
if [[ -z "$COUNT" ]]; then
  echo "[merge-gate] Blocked: the review on #$PR carries no 'ACTIONABLE FINDINGS: <n>' line, so" >&2
  echo "[merge-gate] this gate cannot tell whether findings remain. Re-run the review, or read it" >&2
  echo "[merge-gate] and override deliberately: MERGE_GATE_ACK=1 gh pr merge $PR --merge" >&2
  exit 2
fi

# The local round's DISPOSITION, for a foundational finding. `finding-depth.md` allows exactly two:
# `containment` — the change lands with a labelled hold naming the root item — and `re-plan`, which
# means the change is WITHDRAWN or reduced. Until this line existed, only one of them did anything:
# containment left a code comment and a commit body, while re-plan was a word in a note that nothing
# read, so a change recorded as withdrawn merged like any other. A disposition nothing acts on is a
# decision with no actor.
#
# The verdict is the recorder's, not this hook's — same split as the review record itself.
RECORDER="$(dirname "${BASH_SOURCE[0]}")/../../scripts/harness/record-local-review.mjs"
# The checkout the merge is about — the hook payload's cwd when it names a work tree, else the
# project dir. The recorder resolves its repository from the directory it RUNS in, so pointing it
# at the wrong one would read another checkout's record while judging this one.
RECORD_DIR_FOR_MERGE="${CLAUDE_PROJECT_DIR:-.}"
MERGE_CWD=$(hook_cwd_of "$INPUT" || true)
if [[ -n "$MERGE_CWD" ]] && git -C "$MERGE_CWD" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  RECORD_DIR_FOR_MERGE="$MERGE_CWD"
fi
# Fail closed when the recorder cannot be consulted at all, like every other unreadable state in
# this file — a missing `jq`, a missing `gh`, an unreadable head date all refuse. Skipping silently
# would make "I could not read the disposition" indistinguishable from "there is none", which is the
# pair this hook is built not to conflate.
if ! command -v node >/dev/null 2>&1 || [[ ! -f "$RECORDER" ]]; then
  echo "[merge-gate] Blocked: cannot read the local round's disposition (node or the recorder is" >&2
  echo "[merge-gate] missing), so whether this change was withdrawn is unknown. Override inline:" >&2
  echo "[merge-gate] MERGE_GATE_ACK=1 gh pr merge $PR --merge" >&2
  exit 2
fi
if git -C "$RECORD_DIR_FOR_MERGE" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if ! DISPOSITION_STATE=$(cd "$RECORD_DIR_FOR_MERGE" && node "$RECORDER" --merge-blocked 2>&1); then
    echo "[merge-gate] Blocked: ${DISPOSITION_STATE:-the local round withdrew this change}." >&2
    echo "[merge-gate] Comment the decision on the PR and close it, or record \`containment\` if the" >&2
    echo "[merge-gate] change must land with a labelled hold. Deliberate exception: MERGE_GATE_ACK=1" >&2
    exit 2
  fi
fi

echo "[merge-gate] PR #$PR: CI CLEAN, review newer than head, ACTIONABLE FINDINGS: 0. READ IT." >&2
exit 0
