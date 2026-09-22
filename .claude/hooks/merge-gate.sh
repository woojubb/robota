#!/bin/bash
# Before `gh pr merge`: the questions the rules already require, asked mechanically. Two are
# git-branch.md's; the third, asked first, is finding-depth.md's.
#
# fail-direction: refuse — it answers questions about a pull request's state, and every unreadable or
# unrecognised answer is a question it did not get to ask. An unknown state is not a clean one, so it
# refuses and names what it could not read.
#
# `git-branch.md` § Pre-Merge Code-Review Gate says it plainly: "No CONFIRMED/PLAUSIBLE finding may
# be left silently unaddressed. **Only after all findings are resolved** may the PR be merged."
# `pr-finding-resolution-loop` owns the loop that drives a PR to that state, and three agents implement
# it. All of that existed on 2026-07-28 — and it did not stop two merges past unread findings in one
# session (#1503, whose MUST needed #1507 to fix; #1510, whose High needed #1517).
#
# Written down was not enough, which is the finding of the recurrence audit (PROC-003). This hook is
# the missing half: the rule asks two questions, so the merge command must answer them before it runs.
#
#   0. Was this change WITHDRAWN? A `re-plan` disposition on the PR (`finding-depth.md`, PROC-007).
#   1. Is CI green?  `mergeStateStatus == CLEAN`.
#   2. Has the review been read and resolved?
#
# (0) is asked first because a withdrawn change is not to be merged whatever CI and the review say —
# a gate that asked it last would only ever fire where some other check had already blocked.
#
# On (2) the hook cannot judge whether a finding was ADDRESSED — that is the reviewer's call, and a
# hook pretending to make it would be a guard checking the wrong thing. What it CAN establish is that
# a review exists, that it names the exact current head, that its historical base remains an ancestor
# of the live target, that the exact live base/head pair has no conflict, and that nobody is merging
# while the reviewer's
# own machine-readable count says findings remain. File overlap alone is not a new review trigger. A
# timestamp cannot identify the comparison because the base may move while the child head does not.
#
# Override: MERGE_GATE_ACK=1 INLINE in the same command. It must be inline because this hook reads
# the command string — an `export` in an earlier statement never reaches it, the same property
# BRANCH_GUARD_ALLOW_DELETE has and for the same reason. An override is a visible choice; its use
# prints the reason it was needed.
set -euo pipefail

INPUT=$(cat)
# shellcheck source=lib/command-scan.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/command-scan.sh"
# shellcheck source=lib/bounded-gh.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/bounded-gh.sh"
# shellcheck source=lib/hook-facts.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/hook-facts.sh"

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
  echo "[merge-gate] Override: MERGE_GATE_ACK=1 — disposition, CI and review state NOT verified." >&2
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
  PR=$(bounded_gh pr view --json number --jq '.number' || true)
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

# --- 0. Disposition ---------------------------------------------------------------------------
# PROC-007. A foundational finding takes one of two dispositions (`finding-depth.md`): `re-plan`
# WITHDRAWS the change rather than patching it, and `containment` lets it land under a labelled
# hold. Either way that is a decision ABOUT THIS PR, so it is read here by $PR like every other
# check in this file — from GitHub, where the number is the key.
#
# #1557 kept it in `.agents/local-reviews/<branch>.json` instead: gitignored, per-working-tree,
# keyed by the LOCAL checkout's branch and HEAD. `worktree-parallel-orchestration` §5 has the
# orchestrator merge and never the implementer, so the checkout holding the record is by
# construction not the one running the merge. Measured while judging that PR: one worktree held
# the only record for its branch while the merging clone held a record for a DIFFERENT branch — so
# the gate did not merely fail to block, it answered one PR's merge with another PR's disposition.
# INFRA-048 and INFRA-057 had already established the general form of that: a merge decision held
# anywhere but the PR does not stop a merge.
#
#
# One name per line, matched with `grep -qx` — whole-line equality, the same construction
# `review-gate.yml` uses for the same question, so the two enforcement points cannot disagree.
# A delimiter-joined string matched by substring was the first version and is wrong twice over:
# GitHub permits `|` in a label name, so ONE label called `pre|disposition-re-plan|post` would both
# forge the withdrawal and refuse a PR nobody withdrew — the false refusal that teaches everyone to
# pass MERGE_GATE_ACK=1, installed by the gate itself.
#
# The `__labels__` sentinel line is what keeps two answers apart: a PR carrying no labels still
# answers one line, an unreadable response answers the empty string. Without it "I could not read
# the labels" would silently mean "not withdrawn".
LABELS=$(bounded_gh pr view "$PR" --json labels --jq '"__labels__", (.labels[].name)' || echo "")
if [[ -z "$LABELS" ]]; then
  echo "[merge-gate] Blocked: could not read the labels on #$PR, so a withdrawal cannot be ruled out." >&2
  echo "[merge-gate] Verify by hand, then override inline: MERGE_GATE_ACK=1 gh pr merge $PR --merge" >&2
  exit 2
fi

# `gh pr view --json labels` reads `labels(first: 100)` on the PULL REQUEST and does not paginate.
# GitHub caps an issue or PR at 100 labels, so a SHORT page is provably the whole set — but a FULL
# one is the single state where that reasoning stops, and it is checked rather than argued. Review
# raised the page size as an assumption living only in a comment; a comment is not enforcement, and
# "the withdrawal might be on a page I did not read" is not "not withdrawn".
#
# Minus one for the `__labels__` sentinel line, which is not a label.
LABEL_COUNT=$(( $(printf '%s\n' "$LABELS" | wc -l) - 1 ))
if (( LABEL_COUNT >= 100 )); then
  echo "[merge-gate] Blocked: #$PR returned a full page of $LABEL_COUNT labels, so this read may be" >&2
  echo "[merge-gate] truncated and a 'disposition-re-plan' beyond it would be invisible." >&2
  echo "[merge-gate] Check by hand, then override inline: MERGE_GATE_ACK=1 gh pr merge $PR --merge" >&2
  exit 2
fi

if printf '%s\n' "$LABELS" | grep -qx 'disposition-re-plan'; then
  echo "[merge-gate] Blocked: #$PR carries 'disposition-re-plan'. A foundational finding withdrew" >&2
  echo "[merge-gate] this change rather than patching it (finding-depth.md), so it is not to be" >&2
  echo "[merge-gate] merged: close it and work the root item instead." >&2
  echo "[merge-gate] If the disposition was overturned, REMOVE THE LABEL — that is what un-withdraws" >&2
  echo "[merge-gate] the change. Deliberate exception: MERGE_GATE_ACK=1 gh pr merge $PR --merge" >&2
  exit 2
fi

if printf '%s\n' "$LABELS" | grep -qx 'disposition-containment'; then
  # Containment IS a resolution, so it does not block. It is printed because the person running the
  # merge is the last one who can see the hold before it lands on the integration branch.
  echo "[merge-gate] Note: #$PR carries 'disposition-containment' — it lands under a labelled hold." >&2
fi

STATE=$(bounded_gh pr view "$PR" --json mergeStateStatus --jq '.mergeStateStatus' || echo "")
if [[ -z "$STATE" ]]; then
  echo "[merge-gate] Blocked: could not read PR #$PR's merge state." >&2
  exit 2
fi

# --- 1. CI ------------------------------------------------------------------------------------
# BLOCKED means a required check has not passed. UNSTABLE means a non-required check failed — still
# a refusal here, because "a check failed and I merged anyway" is a decision, not a default. BEHIND
# is different: with strict freshness disabled it means only that the target advanced. The exact
# checks, historical review ancestry and live mergeability are judged below (issue #2826 / H13).
case "$STATE" in
  CLEAN | BEHIND) ;;
  *)
    echo "[merge-gate] Blocked: PR #$PR is $STATE, not CLEAN or conflict-free BEHIND." >&2
    FAILING=$(bounded_gh pr checks "$PR" | grep -E "$(printf '\t')fail$(printf '\t')" | head -3 | cut -f1 | tr '\n' ' ' || true)
    [[ -n "$FAILING" ]] && echo "[merge-gate]   failing: $FAILING" >&2
    echo "[merge-gate] Wait for CI, or fix what failed. Deliberate exception: MERGE_GATE_ACK=1 inline." >&2
    exit 2
    ;;
esac

# --- 1b. CI EXISTS ----------------------------------------------------------------------------
# CLEAN is not the same answer as "the checks passed". GitHub reports CLEAN when no required check is
# FAILING, and a pull request with no checks at all satisfies that vacuously. Measured on PR #2803, a
# child opened against `integration/agreement-014` before INFRA-2804 widened the workflow triggers:
# `mergeStateStatus: CLEAN`, `mergeable: MERGEABLE`, and a check list of three Cloudflare Pages deploy
# previews plus one skipped job — no build, no test, no scans, no format-check. The gate above said
# CLEAN and would have let it through. This header's own first line says an unknown state is not a
# clean one; an EMPTY state is not one either, and until now nothing here said so.
#
# The discriminator is `workflowName`: a check produced by a workflow in THIS repository carries one,
# while an external provider posting a commit check (Cloudflare Pages) leaves it empty. SKIPPED is
# excluded because a skipped job ran nothing — on PR #2803 the single repository check was
# `Claude review`, SKIPPED, which is precisely the shape that must not read as coverage. A healthy
# develop-base pull request measured 15 non-skipped repository checks against that 0.
GATE_CHECKS=$(bounded_gh pr view "$PR" --json statusCheckRollup \
  --jq '[.statusCheckRollup[] | select((.workflowName // "") != "" and (.conclusion // "") != "SKIPPED")] | length' || echo "")
if [[ -z "$GATE_CHECKS" ]]; then
  echo "[merge-gate] Blocked: could not read PR #$PR's check list." >&2
  echo "[merge-gate] An unreadable check list is not an empty one, and neither is a pass." >&2
  exit 2
fi
# Contained — HARNESS-2804 (issue #2804). This asserts a non-empty COUNT. The spec that authorised
# it specified a non-empty, NAME-MATCHED required-check set, and the difference is real: `ci.yml`'s
# `changes` job carries no condition, so that one job satisfies this gate on its own, and a lone
# gitleaks pass satisfies it while `ci.yml` never dispatched at all. Ten of develop's eleven declared
# required contexts could be absent here and this would still report coverage.
#
# It ships as a count because there is nothing to match against. `.github/required-status-checks.json`
# can key an EXACT branch name paired with a live ruleset and nothing else, so `integration/**` — a
# branch class with no ruleset — has no required-check contract anywhere. Hardcoding the names here
# would make this hook a second owner of that fact; HARNESS-2804 owns deciding where it belongs.
#
# What this block does close is the case it was built for: a pull request with NO repository check at
# all, which is what PR #2803 was.
if [[ "$GATE_CHECKS" -eq 0 ]]; then
  echo "[merge-gate] Blocked: PR #$PR ran NO repository gate check." >&2
  echo "[merge-gate]   Not a failure — an absence. Nothing verified this pull request." >&2
  echo "[merge-gate]   Every check on it is external or skipped, so the merge state above is" >&2
  echo "[merge-gate]   vacuous rather than green." >&2
  echo "[merge-gate]   Usual cause: no workflow's trigger matches this base branch. Check that" >&2
  echo "[merge-gate]   .github/workflows/ci.yml lists it under on.pull_request.branches (INFRA-2804)." >&2
  echo "[merge-gate] Verify by hand, then override inline: MERGE_GATE_ACK=1 gh pr merge <n> --merge" >&2
  exit 2
fi

# --- 2. Review --------------------------------------------------------------------------------
# WHO THE REVIEWER IS, asked once, up front (INFRA-2631 / issue: MERGE-GATE-REVIEWER-BOT-RETIRED).
# Every check below this point assumes a comment or review from this identity exists to check —
# none of them can be satisfied by construction once that identity has gone silent for good, which
# is now the permanent case: `.github/workflows/claude-code-review.yml` (the only writer of
# `github-actions[bot]` review comments) carries `if: false` and a `CLAUDE-CODE-REVIEW: RETIRED`
# marker as of 2026-09-06, by owner direction. Reproduced directly on PR #2649: CI green, an
# independent internal review posted with `ACTIONABLE FINDINGS: 0` under the `woojubb` login (the
# authenticated `gh` account, not the retired bot), and this gate refused anyway — the only path
# through was the GitHub web-UI Merge button, which this local hook never sees. Left as-is, every
# `gh pr merge` refuses forever regardless of CI or content, and `MERGE_GATE_ACK=1` becomes the
# routine override — the exact erosion this hook's own header warns about.
#
# So: if NO comment or review anywhere on the PR is from this identity, the gate takes the canonical
# clean-PR receipt path after resolving the live base/head pair below. It never skips review evidence:
# the receipt binds the one local Round A zero, the empty remote-feedback observation, CI ownership,
# and explicit merge authority to that exact pair. The moment the reviewer identity speaks again,
# the existing automated-review path re-engages unchanged.
REVIEWER_RE='^github-actions(\\[bot\\])?$'
REVIEWER_RE_GREP="${REVIEWER_RE//\\\\/\\}"
ALL_AUTHORS=$(bounded_gh pr view "$PR" --json comments,reviews --jq '([.comments[].author.login] + [.reviews[].author.login]) | unique | join(", ")' || echo "")
REVIEWER_EVER_SPOKE=false
if [[ -n "$ALL_AUTHORS" ]]; then
  while IFS= read -r _AUTHOR; do
    _AUTHOR="${_AUTHOR# }"
    [[ -z "$_AUTHOR" ]] && continue
    printf '%s' "$_AUTHOR" | grep -qE "$REVIEWER_RE_GREP" && REVIEWER_EVER_SPOKE=true
  done <<< "${ALL_AUTHORS//,/$'\n'}"
fi
# The review identity is the ordered current base/head pair. A timestamp can say when somebody
# wrote a comment; it cannot say which base comparison they reviewed.
OID_PAIR=$(bounded_gh pr view "$PR" --json baseRefOid,headRefOid,baseRefName --jq '"\(.baseRefOid) \(.headRefOid) \(.baseRefName)"' || echo "")
# `|| true`: on an empty answer `read` returns non-zero at EOF, and under `set -e` a bare failing
# builtin ends the hook with exit 1 — which the protocol reads as NOT blocking. The validation
# below is what refuses an unreadable answer, and it must be reached.
read -r CURRENT_BASE_OID CURRENT_HEAD_OID BASE_REF_NAME _ <<< "$OID_PAIR" || true
if [[ ! "$CURRENT_BASE_OID" =~ ^[0-9a-f]{40}$ ]] || [[ ! "$CURRENT_HEAD_OID" =~ ^[0-9a-f]{40}$ ]]; then
  echo "[merge-gate] Blocked: could not read PR #$PR's current 40-hex base/head OIDs." >&2
  echo "[merge-gate] Verify by hand, then override inline: MERGE_GATE_ACK=1 gh pr merge $PR --merge" >&2
  exit 2
fi

# --- the base is the BRANCH, not the API's cached field (issue #2309) ---------------------------
# `baseRefOid` is what GitHub last recorded for the pull request, and it LAGS the branch. Measured
# on an open PR with its head untouched: develop moved twice while the field sat unchanged for 1542
# seconds, then jumped straight to current when a push landed. PR #2307 merged on a verdict whose
# REVIEWED BASE matched that field exactly — while origin/develop was one commit ahead. Two values
# that move together can agree with each other and still disagree with the branch the change lands
# on, and a gate comparing them enforces exactly what it claims and not what the reader assumes.
#
# So the branch is asked directly. `git ls-remote origin refs/heads/<base>` is one round-trip that
# needs no fetch and reads the ref as GitHub serves it now. It is bounded the way the moved-base
# fetch below is, and an unreadable answer REFUSES: "could not read the tip" is not "the tip did not
# move", and falling back to the lagging field would reinstall the defect on the path where the
# network is flaky — the one where a stale read is likeliest. The live OID then feeds the
# descendant/mergeability judgement below unchanged.
if [[ -z "$BASE_REF_NAME" || "$BASE_REF_NAME" == "null" ]]; then
  echo "[merge-gate] Blocked: could not read PR #$PR's base branch name, so its live tip cannot be read." >&2
  echo "[merge-gate] Verify by hand, then override inline: MERGE_GATE_ACK=1 gh pr merge $PR --merge" >&2
  exit 2
fi
REPO_DIR="${CLAUDE_PROJECT_DIR:-.}"
LIVE_BASE_OID=$(hook_git_in "$REPO_DIR" -c http.lowSpeedLimit=1000 -c "http.lowSpeedTime=$HOOK_GH_DEADLINE_SECONDS" \
  ls-remote --quiet --exit-code origin "refs/heads/$BASE_REF_NAME" 2>/dev/null | awk 'NR == 1 { print $1 }' || true)
if [[ ! "$LIVE_BASE_OID" =~ ^[0-9a-f]{40}$ ]]; then
  echo "[merge-gate] Blocked: could not read the live tip of origin/$BASE_REF_NAME (git ls-remote), so the" >&2
  echo "[merge-gate] base this PR lands on is unknown — and GitHub's baseRefOid is not it (it lags the" >&2
  echo "[merge-gate] branch by minutes; issue #2309). Verify by hand, then override inline:" >&2
  echo "[merge-gate]   MERGE_GATE_ACK=1 gh pr merge $PR --merge" >&2
  exit 2
fi
if [[ "$LIVE_BASE_OID" != "$CURRENT_BASE_OID" ]]; then
  echo "[merge-gate] Note: GitHub's baseRefOid for #$PR is $CURRENT_BASE_OID; origin/$BASE_REF_NAME is at $LIVE_BASE_OID." >&2
  echo "[merge-gate] The branch is what this PR lands on, so the branch is what the review is judged against." >&2
  CURRENT_BASE_OID="$LIVE_BASE_OID"
fi

verify_historical_base() {
  local reviewed_base="$1"

  # A review or merge decision remains bound to its historical base/head pair. A target branch
  # moving forward does not create new source changes, so only rewriting/retargeting or an actual
  # merge conflict invalidates it (issue #2826 / H13).
  local oid
  for oid in "$CURRENT_BASE_OID" "$CURRENT_HEAD_OID" "$reviewed_base"; do
    if ! hook_git_in "$REPO_DIR" cat-file -e "${oid}^{commit}" 2>/dev/null; then
      hook_git_in "$REPO_DIR" -c http.lowSpeedLimit=1000 -c "http.lowSpeedTime=$HOOK_GH_DEADLINE_SECONDS" \
        fetch --quiet origin "$oid" >/dev/null 2>&1 || true
    fi
    if ! hook_git_in "$REPO_DIR" cat-file -e "${oid}^{commit}" 2>/dev/null; then
      echo "[merge-gate] Blocked: base identity cannot be verified because commit $oid is unavailable." >&2
      return 2
    fi
  done

  if [[ "$reviewed_base" != "$CURRENT_BASE_OID" ]]; then
    local ancestry_rc=0
    hook_git_in "$REPO_DIR" merge-base --is-ancestor "$reviewed_base" "$CURRENT_BASE_OID" 2>/dev/null || ancestry_rc=$?
    if [[ "$ancestry_rc" -ne 0 ]]; then
      echo "[merge-gate] Blocked: current base is not a readable descendant of reviewed base $reviewed_base." >&2
      echo "[merge-gate] The PR may have been retargeted or the base rewritten; obtain a review of the real pair." >&2
      return 2
    fi
  fi

  # Bind the conflict proof to the exact live base/head pair. GitHub's `mergeable` field is computed
  # against its cached `baseRefOid`, which can lag the branch tip read above and therefore cannot
  # prove that this live pair is conflict-free.
  local merge_tree_rc=0 merge_tree_output
  merge_tree_output=$(hook_git_in "$REPO_DIR" merge-tree --write-tree "$CURRENT_BASE_OID" "$CURRENT_HEAD_OID" 2>&1) || merge_tree_rc=$?
  if [[ "$merge_tree_rc" -eq 1 ]]; then
    echo "[merge-gate] Blocked: the live target/head pair has a real merge conflict." >&2
    echo "[merge-gate] Resolve the conflict and verify the affected resolution." >&2
    return 2
  fi
  if [[ "$merge_tree_rc" -ne 0 ]]; then
    echo "[merge-gate] Blocked: mergeability of live pair $CURRENT_BASE_OID/$CURRENT_HEAD_OID could not be verified." >&2
    [[ -n "$merge_tree_output" ]] && echo "[merge-gate] git merge-tree: $merge_tree_output" >&2
    return 2
  fi

  if [[ "$reviewed_base" != "$CURRENT_BASE_OID" ]]; then
    echo "[merge-gate] Note: base advanced $reviewed_base -> $CURRENT_BASE_OID. The reviewed comparison stands because the exact live base/head pair merges without conflict; no rebase, push, retest or review is requested." >&2
    BASE_VERDICT="base advanced without conflict"
  else
    BASE_VERDICT="exact base"
  fi
}

if [[ "$REVIEWER_EVER_SPOKE" == "false" ]]; then
  DECISION_COMMENTS=$(bounded_gh pr view "$PR" --json comments --jq '.comments' || echo "")
  DECISION_RESULT=""
  if [[ -n "$DECISION_COMMENTS" ]] && command -v node >/dev/null 2>&1; then
    DECISION_RESULT=$(printf '%s' "$DECISION_COMMENTS" |
      node "$REPO_DIR/scripts/harness/post-findings-authorization.mjs" \
        --select-merge-decision --pr "$PR" --head "$CURRENT_HEAD_OID" \
        --base "$BASE_REF_NAME" 2>/dev/null || true)
  fi
  if [[ "$(printf '%s' "$DECISION_RESULT" | jq -r '.ok // false' 2>/dev/null)" != "true" ]]; then
    DECISION_REASON=$(printf '%s' "$DECISION_RESULT" | jq -r '.reason // "unreadable-merge-decision"' 2>/dev/null || echo "unreadable-merge-decision")
    echo "[merge-gate] Blocked: retired reviewer is silent and no unique trusted PR_MERGE_DECISION" >&2
    echo "[merge-gate] binds PR #$PR to exact base/head $CURRENT_BASE_OID/$CURRENT_HEAD_OID ($DECISION_REASON)." >&2
    exit 2
  fi
  DECISION_BASE=$(printf '%s' "$DECISION_RESULT" | jq -r '.mergeDecision.baseOid // ""' 2>/dev/null || echo "")
  if [[ ! "$DECISION_BASE" =~ ^[0-9a-f]{40}$ ]]; then
    echo "[merge-gate] Blocked: trusted PR_MERGE_DECISION has no readable historical base." >&2
    exit 2
  fi
  verify_historical_base "$DECISION_BASE" || exit $?
  if [[ "$BASE_VERDICT" == "exact base" ]]; then
    echo "[merge-gate] PR #$PR: CI CLEAN, exact base/head PR_MERGE_DECISION, remote feedback empty, authority recorded." >&2
  else
    echo "[merge-gate] PR #$PR: CI CLEAN, historical base/current head PR_MERGE_DECISION ($BASE_VERDICT), remote feedback empty, authority recorded." >&2
  fi
  exit 0
fi

# The newest comment BY THE REVIEWER, not the newest comment. Reading `comments[-1]` unconditionally
# meant anyone — including the person merging — could post a remark after the review and satisfy both
# the recency check and the findings check with text that is not a review at all. A gate a single
# comment disarms is not a gate.
# Measured on this repository: `gh` reports the reviewing bot as `github-actions`, four matches to
# zero against the `[bot]` spelling. Both are accepted anyway — the exact normalisation is gh's to
# change, and a gate that silently stops recognising reviews would block every merge and teach
# everyone to pass MERGE_GATE_ACK=1, which is the bypass it exists to prevent.
# `REVIEWER_RE` is now defined earlier, at the top of this section (INFRA-201), so the never-spoke
# early exit above can test it before any of this runs.
# The newest VERDICT, not the newest comment from the right author — #1661's composition defect.
# The reviewing bot posts more than reviews under one login: review-gate notices, thread replies,
# and (measured on #1651) pull-request reviews with a ZERO-LENGTH body. Selecting by author alone
# made whichever of those was newest stand in for the verdict: a fresh notice lent its timestamp to
# a stale verdict (recency passed on silence), and a verdict-less newest entry turned into the
# "carries no ACTIONABLE FINDINGS" refusal on a PR whose real verdict said zero — which is how the
# override became routine, the exact erosion this gate exists to prevent.
#
# So the selection asks for the marker ITSELF, across BOTH channels the reviewer writes to (issue
# comments, where the summary lands, and pull-request reviews). Recency is then judged on the
# verdict — the only entry whose age means anything. Keep the complete verdict list as evidence too:
# a single zero is not the same fact as corroborating zeroes from every verdict that ran. The former
# remains mergeable for now, but the output must say that corroboration is absent (#2247).
REVIEW_VERDICTS=$(bounded_gh pr view "$PR" --json comments,reviews \
  --jq "([.comments[] | {login: (.author.login // \"\"), body: (.body // \"\"), at: (.createdAt // \"\")}] + [.reviews[] | {login: (.author.login // \"\"), body: (.body // \"\"), at: (.submittedAt // \"\")}]) | map(select(.login | test(\"$REVIEWER_RE\"))) | map(select(.body | test(\"ACTIONABLE FINDINGS:[[:space:]]*[0-9]+\"; \"i\"))) | sort_by(.at)" || echo '[]')
VERDICT_COUNT=$(printf '%s' "$REVIEW_VERDICTS" | jq -r 'length' 2>/dev/null || echo "")
if [[ ! "$VERDICT_COUNT" =~ ^[0-9]+$ ]]; then
  echo "[merge-gate] Blocked: could not count reviewer verdicts on #$PR." >&2
  echo "[merge-gate] The difference between one zero and corroborated zeroes is unknown." >&2
  exit 2
fi
LAST_REVIEW=$(printf '%s' "$REVIEW_VERDICTS" | jq -c 'last // {}' 2>/dev/null || echo '{}')
LAST_REVIEW_AT=$(printf '%s' "$LAST_REVIEW" | jq -r '.at // ""' 2>/dev/null || echo "")

if [[ -z "$LAST_REVIEW_AT" ]]; then
  # Distinguish three silences, because they are diagnosed differently: nobody spoke at all; the
  # reviewer is not who this gate thinks it is; the reviewer spoke and never delivered a verdict.
  # BOTH channels, like the verdict selection above — the reviewer sometimes posts only a
  # pull-request review, and a diagnostic that reads one channel misdiagnoses exactly the third
  # silence this branch exists to name. (#1668 review)
  AUTHORS=$(bounded_gh pr view "$PR" --json comments,reviews --jq '([.comments[].author.login] + [.reviews[].author.login]) | unique | join(", ")' || echo "")
  if [[ -n "$AUTHORS" ]]; then
    # Judged login by login against the SAME anchored expression the selection uses — an
    # unanchored substring would route a login merely containing the reviewer's name into
    # "never delivered a verdict" instead of "wrong reviewer" below. (#1668 review)
    # REVIEWER_RE doubles its backslashes because it is written for embedding in a jq string;
    # grep reads them singly, so the doubled form is collapsed here rather than copied by hand.
    REVIEWER_RE_GREP="${REVIEWER_RE//\\\\/\\}"
    REVIEWER_SPOKE=false
    # A herestring, not a piped printf: without the trailing newline the herestring supplies,
    # `read` returns non-zero on the final login and the loop never judges it at all.
    while IFS= read -r _AUTHOR; do
      _AUTHOR="${_AUTHOR# }"
      [[ -z "$_AUTHOR" ]] && continue
      printf '%s' "$_AUTHOR" | grep -qE "$REVIEWER_RE_GREP" && REVIEWER_SPOKE=true
    done <<< "${AUTHORS//,/$'\n'}"
    if [[ "$REVIEWER_SPOKE" == "true" ]]; then
      echo "[merge-gate] Blocked: the reviewer has commented on #$PR but never delivered a verdict" >&2
      echo "[merge-gate] ('ACTIONABLE FINDINGS: <n>'). Gate notices and replies are not reviews." >&2
      echo "[merge-gate] Run the review, or read the PR yourself and override inline:" >&2
      echo "[merge-gate]   MERGE_GATE_ACK=1 gh pr merge $PR --merge" >&2
      exit 2
    fi
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

# EVERY INLINE FINDING IS ANSWERED WHERE IT WAS RAISED (2026-08-04, owner).
#
# The gate already asked "has the review been read and resolved?" and answered it from the summary
# comment's findings count. That misses the half a reader actually sees. Measured across one session:
# 27 inline review threads were left OPEN on 18 merged pull requests — every one of them genuinely
# fixed, with the reasoning in a commit message the thread does not link to. To anyone opening the
# pull request afterwards, a finding answered in a commit and a finding ignored look identical, and
# the skill this loop follows says so in as many words.
#
# So: reply on the thread AND resolve it — both, and the count below requires both. Anyone can click
# "Resolve conversation" on a thread with no reply under it, and a gate reading only `isResolved`
# would accept exactly the state it was built to end: a finding with no answer, indistinguishable
# from one that was handled. A thread satisfies this gate when it is resolved and carries more than
# the reviewer's own opening comment.
#
# The reply is where the decision lives — accepted and how, or refuted and on what evidence.
#
# Scoped to threads the REVIEWER opened, by the same pattern this gate already uses to find the
# review. A human's inline question or aside is a conversation, not a finding, and blocking a merge on
# one would make the override routine — which is how a gate stops being read at all, a failure this
# file warns about a hundred lines down and would otherwise have re-created here.
#
# Unknown is not zero. If the thread state cannot be read, the gate refuses, the same way it refuses
# unreadable current OIDs.
# Only GraphQL exposes thread resolution — `gh pr view --json` has no such field. The repository is
# READ from the checkout rather than reconstructed: a hook that guessed an owner or a name would ask
# about the wrong repository and answer confidently.
REPO_NWO=$(bounded_gh repo view --json nameWithOwner --jq '.nameWithOwner' || echo "")
THREADS=""
if [[ -n "$REPO_NWO" ]]; then
  # One read, two numbers: how many threads came back, and how many of THOSE are the reviewer's and
  # still open. Asking twice would let the page shift between the questions.
  THREADS=$(bounded_gh api graphql -f query="
{ repository(owner: \"${REPO_NWO%%/*}\", name: \"${REPO_NWO##*/}\") {
    pullRequest(number: $PR) {
      reviewThreads(first: 100) {
        nodes { isResolved comments(first: 1) { totalCount nodes { author { login } } } }
      }
    }
} }" --jq '.data.repository.pullRequest.reviewThreads.nodes
      | "\(length) \([.[]
          | select((.comments.nodes[0].author.login // "") | test("'"$REVIEWER_RE"'"))
          | select(.isResolved == false or .comments.totalCount < 2)] | length)"' || echo "")
fi
TOTAL_THREADS="${THREADS%% *}"
UNRESOLVED="${THREADS##* }"

# A FULL page is the one state where "the rest are resolved" stops being provable — the same
# reasoning the label read above spells out, and the same check. Without it a pull request with more
# than 100 threads could carry an open finding on a page this never read and merge on a count of 0,
# which is precisely the "unknown is not zero" this block is built on.
if [[ -n "$TOTAL_THREADS" ]] && (( TOTAL_THREADS >= 100 )); then
  echo "[merge-gate] Blocked: #$PR returned a full page of $TOTAL_THREADS review threads, so this" >&2
  echo "[merge-gate] read may be truncated and an unanswered finding beyond it would be invisible." >&2
  echo "[merge-gate] Check by hand, then override inline: MERGE_GATE_ACK=1 gh pr merge $PR --merge" >&2
  exit 2
fi

if [[ -z "$UNRESOLVED" ]]; then
  echo "[merge-gate] Blocked: could not read PR #$PR's review threads, so whether every inline" >&2
  echo "[merge-gate] finding was answered is unknown. Verify by hand, then override inline:" >&2
  echo "[merge-gate] MERGE_GATE_ACK=1 gh pr merge $PR --merge" >&2
  exit 2
fi

if [[ "$UNRESOLVED" != "0" ]]; then
  echo "[merge-gate] Blocked: PR #$PR has $UNRESOLVED unresolved REVIEW finding thread(s)." >&2
  echo "[merge-gate] Fixing a finding is not answering it. Reply on the thread with the decision —" >&2
  echo "[merge-gate] accepted and how, or refuted and on what evidence — then resolve it, so the" >&2
  echo "[merge-gate] next reader can tell a finding that was handled from one that was ignored." >&2
  echo "[merge-gate] Deliberate exception: MERGE_GATE_ACK=1 gh pr merge $PR --merge" >&2
  exit 2
fi

BODY=$(printf '%s' "$LAST_REVIEW" | jq -r '.body // ""' 2>/dev/null || echo "")
BASE_MARKER_COUNT=$(printf '%s\n' "$BODY" | grep -Ec '^REVIEWED BASE: [0-9a-f]{40}$' || true)
HEAD_MARKER_COUNT=$(printf '%s\n' "$BODY" | grep -Ec '^REVIEWED HEAD: [0-9a-f]{40}$' || true)
COUNT_MARKER_COUNT=$(printf '%s\n' "$BODY" | grep -Ec '^ACTIONABLE FINDINGS: [0-9]+$' || true)
if [[ "$BASE_MARKER_COUNT" != "1" ]] || [[ "$HEAD_MARKER_COUNT" != "1" ]] || [[ "$COUNT_MARKER_COUNT" != "1" ]]; then
  echo "[merge-gate] Blocked: the review on #$PR must carry exactly one REVIEWED BASE, REVIEWED HEAD," >&2
  echo "[merge-gate] and ACTIONABLE FINDINGS marker; found $BASE_MARKER_COUNT/$HEAD_MARKER_COUNT/$COUNT_MARKER_COUNT." >&2
  exit 2
fi

REVIEWED_BASE=$(printf '%s\n' "$BODY" | sed -nE 's/^REVIEWED BASE: ([0-9a-f]{40})$/\1/p')
REVIEWED_HEAD=$(printf '%s\n' "$BODY" | sed -nE 's/^REVIEWED HEAD: ([0-9a-f]{40})$/\1/p')
COUNT=$(printf '%s\n' "$BODY" | sed -nE 's/^ACTIONABLE FINDINGS: ([0-9]+)$/\1/p')

verify_historical_base "$REVIEWED_BASE" || exit $?
if [[ "$REVIEWED_HEAD" != "$CURRENT_HEAD_OID" ]]; then
  echo "[merge-gate] Blocked: reviewed head $REVIEWED_HEAD does not match current head $CURRENT_HEAD_OID." >&2
  exit 2
fi
if [[ "$COUNT" != "0" ]]; then
  echo "[merge-gate] Blocked: the review on #$PR reports ACTIONABLE FINDINGS: $COUNT." >&2
  echo "[merge-gate] Resolve them, then re-review. git-branch.md: only after ALL findings are resolved." >&2
  exit 2
fi

if [[ "$VERDICT_COUNT" == "1" ]]; then
  REVIEW_EVIDENCE="1 verdict, 0 findings — no corroborating review"
else
  REVIEW_EVIDENCE="$VERDICT_COUNT verdicts, 0 findings"
fi

# The gate stops here on purpose. Whether a finding written in prose was addressed is the reviewer's
# judgement, and a hook guessing at it would be a check measuring the wrong thing. What it has
# established: CI is green, every inline finding is answered, the latest verdict names the exact
# current head with zero findings, and its historical base is an ancestor of the live target whose
# exact base/head pair merges without conflict.
echo "[merge-gate] PR #$PR: CI CLEAN, exact head review, $BASE_VERDICT, ACTIONABLE FINDINGS: 0, $REVIEW_EVIDENCE. READ IT." >&2
exit 0
