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
# a review exists, that it names the exact current head, that the base it named either IS the current
# base or moved only over files this PR never touches while the merge stays clean (PROC-016, #2386),
# and that nobody is merging while the reviewer's own machine-readable count says findings remain. A
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
# a refusal here, because "a check failed and I merged anyway" is a decision, not a default.
if [[ "$STATE" != "CLEAN" ]]; then
  echo "[merge-gate] Blocked: PR #$PR is $STATE, not CLEAN." >&2
  FAILING=$(bounded_gh pr checks "$PR" | grep -E "$(printf '\t')fail$(printf '\t')" | head -3 | cut -f1 | tr '\n' ' ' || true)
  [[ -n "$FAILING" ]] && echo "[merge-gate]   failing: $FAILING" >&2
  echo "[merge-gate] Wait for CI, or fix what failed. Deliberate exception: MERGE_GATE_ACK=1 inline." >&2
  exit 2
fi

# --- 2. Review --------------------------------------------------------------------------------
# The review identity is the ordered current base/head pair. A timestamp can say when somebody
# wrote a comment; it cannot say which base comparison they reviewed.
OID_PAIR=$(bounded_gh pr view "$PR" --json baseRefOid,headRefOid --jq '"\(.baseRefOid) \(.headRefOid)"' || echo "")
CURRENT_BASE_OID="${OID_PAIR%% *}"
CURRENT_HEAD_OID="${OID_PAIR##* }"
if [[ ! "$CURRENT_BASE_OID" =~ ^[0-9a-f]{40}$ ]] || [[ ! "$CURRENT_HEAD_OID" =~ ^[0-9a-f]{40}$ ]]; then
  echo "[merge-gate] Blocked: could not read PR #$PR's current 40-hex base/head OIDs." >&2
  echo "[merge-gate] Verify by hand, then override inline: MERGE_GATE_ACK=1 gh pr merge $PR --merge" >&2
  exit 2
fi

# The newest comment BY THE REVIEWER, not the newest comment. Reading `comments[-1]` unconditionally
# meant anyone — including the person merging — could post a remark after the review and satisfy both
# the recency check and the findings check with text that is not a review at all. A gate a single
# comment disarms is not a gate.
# Measured on this repository: `gh` reports the reviewing bot as `github-actions`, four matches to
# zero against the `[bot]` spelling. Both are accepted anyway — the exact normalisation is gh's to
# change, and a gate that silently stops recognising reviews would block every merge and teach
# everyone to pass MERGE_GATE_ACK=1, which is the bypass it exists to prevent.
REVIEWER_RE='^github-actions(\\[bot\\])?$'
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
# verdict — the only entry whose age means anything.
LAST_REVIEW=$(bounded_gh pr view "$PR" --json comments,reviews \
  --jq "([.comments[] | {login: (.author.login // \"\"), body: (.body // \"\"), at: (.createdAt // \"\")}] + [.reviews[] | {login: (.author.login // \"\"), body: (.body // \"\"), at: (.submittedAt // \"\")}]) | map(select(.login | test(\"$REVIEWER_RE\"))) | map(select(.body | test(\"ACTIONABLE FINDINGS:[[:space:]]*[0-9]+\"; \"i\"))) | sort_by(.at) | last // {}" || echo '{}')
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

# THE BASE IS JUDGED BY INTERACTION, NOT IDENTITY (PROC-016, issue #2386).
#
# This used to refuse whenever the reviewed base was not the current base. RULE-015 measured what
# that bought: fixtures B (#2385) and C (#2382) were each rebased onto a base that had moved over
# 15 files while the branch touched 2 — file overlap 0, rebase conflicts 0, `range-diff` identical —
# and each rebase cost a push, a CI cycle and a fresh review that could only say what the last one
# said. A verdict is a statement about a comparison; the base moving over files the comparison never
# contained does not change the comparison. So the question is whether the two changes INTERACT:
#
#   1. which files did the base move over?    git diff <reviewed-base> <current-base>, locally
#   2. which files does this PR touch?         the PR's own file list
#   3. is the merge clean?                     the PR's `mergeable`, read NOW, not remembered
#
# Disjoint AND MERGEABLE is accepted. Any overlap is refused naming every file, because that is the
# case the review has not seen. Anything unreadable is refused: unknown is not zero, the same rule
# the thread block above applies. This is the non-strict policy the host already runs under
# ("require branches to be up to date" is off), asked mechanically at the one moment it matters.
#
# (1) IS COMPUTED IN THE CHECKOUT, NOT ASKED OF THE COMPARE API. The first version read
# `repos/…/compare/<reviewed>...<current>` with `--paginate`. That endpoint paginates over COMMITS
# and caps `files` at 300 with no truncation signal — measured: a 1597-file range answered 301
# unique files and said nothing about the rest. So a base that had moved over more than 300 files
# hid every overlap past the cap, and the gate accepted the merge on a list it did not know was
# short. Silent truncation is the exact failure the `__labels__` full-page check above exists to
# refuse, and here it could not even be detected. A local `git diff` is the whole diff.
#
# So both commits are made present first — `cat-file -e`, and a `fetch origin <oid>` for one the
# checkout lacks (GitHub serves any reachable commit by its full OID) — and a commit that is still
# absent after that is refused BY NAME, because "could not list what moved" and "nothing moved" are
# the two answers this block must never conflate. Ancestry is asked of the same objects:
# `merge-base --is-ancestor <reviewed> <current>` is exactly "did the base move FORWARD", and
# anything else (a force-pushed or retargeted base) is a state where a two-commit diff lists both
# sides' changes rather than what moved, so it is refused rather than half-measured. Renames are
# read on both sides (`--name-status -M` prints the old AND the new name on one line), because a
# file the PR edits under a name the base has since moved is an interaction the new name alone
# would hide. `core.quotePath=false` keeps a non-ASCII path in the same bytes GitHub lists it in —
# quoted, it would never match the PR's file and the overlap would fail OPEN.
#
# Every git call goes through `hook_git_in` (lib/hook-facts.sh), which scrubs the ambient
# `GIT_DIR`-family pointers that would otherwise make these questions about a different repository.
#
# The `__files__` sentinel line is the `__labels__` construction: a readable answer with no files
# still answers one line, an unreadable one answers nothing.
if [[ "$REVIEWED_BASE" != "$CURRENT_BASE_OID" ]]; then
  REPO_DIR="${CLAUDE_PROJECT_DIR:-.}"
  # The fetch is bounded the way the gh calls are: a transfer that stalls below 1 KB/s for the same
  # deadline is abandoned, and an abandoned fetch is a refusal below, not a silent "nothing moved".
  for _OID in "$CURRENT_BASE_OID" "$REVIEWED_BASE"; do
    if ! hook_git_in "$REPO_DIR" cat-file -e "${_OID}^{commit}" 2>/dev/null; then
      hook_git_in "$REPO_DIR" -c http.lowSpeedLimit=1000 -c "http.lowSpeedTime=$HOOK_GH_DEADLINE_SECONDS" \
        fetch --quiet origin "$_OID" >/dev/null 2>&1 || true
    fi
    if ! hook_git_in "$REPO_DIR" cat-file -e "${_OID}^{commit}" 2>/dev/null; then
      echo "[merge-gate] Blocked: reviewed base $REVIEWED_BASE does not match current base $CURRENT_BASE_OID," >&2
      echo "[merge-gate] and commit $_OID is not in this checkout and could not be fetched from origin," >&2
      echo "[merge-gate] so what the base moved over cannot be listed — and unknown is not zero." >&2
      echo "[merge-gate] Fetch it (git fetch origin $_OID) and retry, rebase and re-review, or verify by" >&2
      echo "[merge-gate] hand and override inline: MERGE_GATE_ACK=1 gh pr merge $PR --merge" >&2
      exit 2
    fi
  done

  # 0 = ancestor, 1 = not, anything else = git could not answer. The three are kept apart: "no" is a
  # base that did not move forward, and "could not tell" is a refusal on its own evidence.
  ANCESTRY_RC=0
  hook_git_in "$REPO_DIR" merge-base --is-ancestor "$REVIEWED_BASE" "$CURRENT_BASE_OID" 2>/dev/null || ANCESTRY_RC=$?
  if [[ "$ANCESTRY_RC" -eq 1 ]]; then
    echo "[merge-gate] Blocked: reviewed base $REVIEWED_BASE does not match current base $CURRENT_BASE_OID," >&2
    echo "[merge-gate] and the current base is not a descendant of the reviewed one (git merge-base --is-ancestor: no)," >&2
    echo "[merge-gate] so what moved between them cannot be listed from one side." >&2
    echo "[merge-gate] Rebase and re-review, or verify by hand and override inline:" >&2
    echo "[merge-gate]   MERGE_GATE_ACK=1 gh pr merge $PR --merge" >&2
    exit 2
  elif [[ "$ANCESTRY_RC" -ne 0 ]]; then
    echo "[merge-gate] Blocked: reviewed base $REVIEWED_BASE does not match current base $CURRENT_BASE_OID," >&2
    echo "[merge-gate] and whether the current base descends from the reviewed one could not be read" >&2
    echo "[merge-gate] (git merge-base exit $ANCESTRY_RC). Verify by hand, then override inline:" >&2
    echo "[merge-gate]   MERGE_GATE_ACK=1 gh pr merge $PR --merge" >&2
    exit 2
  fi

  if ! MOVED_RAW=$(hook_git_in "$REPO_DIR" -c core.quotePath=false diff --name-status -M "$REVIEWED_BASE" "$CURRENT_BASE_OID" 2>/dev/null); then
    echo "[merge-gate] Blocked: reviewed base $REVIEWED_BASE does not match current base $CURRENT_BASE_OID," >&2
    echo "[merge-gate] and what the base moved over could not be read, so whether it touches this PR's" >&2
    echo "[merge-gate] files is unknown — and unknown is not zero. Rebase and re-review, or verify by" >&2
    echo "[merge-gate] hand and override inline: MERGE_GATE_ACK=1 gh pr merge $PR --merge" >&2
    exit 2
  fi
  # `--name-status` is one status column and then every path column: one for a modification, two
  # (old, new) for a rename or copy. Every path column is a name the base moved over.
  MOVED_FILES=$(printf '%s\n' "$MOVED_RAW" |
    awk -F'\t' 'NF >= 2 { for (i = 2; i <= NF; i++) if ($i != "") print $i }' | LC_ALL=C sort -u || true)

  # The REST list rather than `gh pr view --json files`: the latter reads `files(first: 100)` and
  # does not paginate, so a PR wider than a page would have to be refused as a possibly-truncated
  # read — the exact wide PR this check exists to stop rebasing needlessly. `--paginate` follows
  # the Link headers to the end, and a page that fails to load fails the whole call.
  PR_FILES_RAW=$(bounded_gh api "repos/$REPO_NWO/pulls/$PR/files?per_page=100" --paginate \
    --jq '"__files__", (.[] | .filename, (.previous_filename // empty))' || echo "")
  if ! printf '%s\n' "$PR_FILES_RAW" | grep -qx '__files__'; then
    echo "[merge-gate] Blocked: reviewed base $REVIEWED_BASE does not match current base $CURRENT_BASE_OID," >&2
    echo "[merge-gate] and PR #$PR's own file list could not be read, so whether the base moved over" >&2
    echo "[merge-gate] any of them is unknown. Verify by hand, then override inline:" >&2
    echo "[merge-gate]   MERGE_GATE_ACK=1 gh pr merge $PR --merge" >&2
    exit 2
  fi
  PR_FILES=$(printf '%s\n' "$PR_FILES_RAW" | grep -vx '__files__' | LC_ALL=C sort -u || true)

  # Both lists are sorted under the same collation, so `comm` is exact set intersection.
  OVERLAP=$(LC_ALL=C comm -12 <(printf '%s\n' "$MOVED_FILES") <(printf '%s\n' "$PR_FILES") | grep . || true)
  MOVED_COUNT=$(printf '%s\n' "$MOVED_FILES" | grep -c . || true)
  PR_FILE_COUNT=$(printf '%s\n' "$PR_FILES" | grep -c . || true)
  if [[ -n "$OVERLAP" ]]; then
    OVERLAP_COUNT=$(printf '%s\n' "$OVERLAP" | grep -c . || true)
    echo "[merge-gate] Blocked: reviewed base $REVIEWED_BASE does not match current base $CURRENT_BASE_OID," >&2
    echo "[merge-gate] and the base moved over $OVERLAP_COUNT of the $PR_FILE_COUNT file(s) this PR touches:" >&2
    while IFS= read -r _FILE; do
      echo "[merge-gate]   $_FILE" >&2
    done <<< "$OVERLAP"
    echo "[merge-gate] The review never saw that interaction. Rebase onto the current base and" >&2
    echo "[merge-gate] re-review. Deliberate exception: MERGE_GATE_ACK=1 gh pr merge $PR --merge" >&2
    exit 2
  fi

  # Read NOW rather than inferred from the CLEAN state above: GitHub recomputes mergeability lazily
  # after the base moves, and `UNKNOWN` is what it answers while it is still computing — which is
  # precisely the moment this gate tends to run. UNKNOWN is not MERGEABLE.
  MERGE_PAIR=$(bounded_gh pr view "$PR" --json mergeable,mergeStateStatus --jq '"\(.mergeable // "") \(.mergeStateStatus // "")"' || echo "")
  MERGEABLE="${MERGE_PAIR%% *}"
  case "$MERGEABLE" in
    MERGEABLE) ;;
    CONFLICTING | UNKNOWN)
      echo "[merge-gate] Blocked: reviewed base $REVIEWED_BASE does not match current base $CURRENT_BASE_OID." >&2
      echo "[merge-gate] The base moved over none of this PR's $PR_FILE_COUNT file(s), but GitHub reports" >&2
      echo "[merge-gate] mergeable: $MERGEABLE (merge state: ${MERGE_PAIR#* }). A disjoint file set that does" >&2
      echo "[merge-gate] not merge cleanly is an interaction the file lists cannot see." >&2
      if [[ "$MERGEABLE" == "UNKNOWN" ]]; then
        echo "[merge-gate] UNKNOWN is GitHub still computing — wait and retry; it is not MERGEABLE yet." >&2
      else
        echo "[merge-gate] Rebase onto the current base, resolve the conflict, and re-review." >&2
      fi
      echo "[merge-gate] Deliberate exception: MERGE_GATE_ACK=1 gh pr merge $PR --merge" >&2
      exit 2
      ;;
    *)
      echo "[merge-gate] Blocked: reviewed base $REVIEWED_BASE does not match current base $CURRENT_BASE_OID," >&2
      echo "[merge-gate] and PR #$PR's mergeability could not be read (got '${MERGE_PAIR}'). Verify by" >&2
      echo "[merge-gate] hand, then override inline: MERGE_GATE_ACK=1 gh pr merge $PR --merge" >&2
      exit 2
      ;;
  esac
  echo "[merge-gate] Note: base moved $REVIEWED_BASE -> $CURRENT_BASE_OID over $MOVED_COUNT file(s), none of" >&2
  echo "[merge-gate] PR #$PR's $PR_FILE_COUNT; GitHub reports MERGEABLE. The reviewed comparison stands." >&2
  BASE_VERDICT="base moved disjointly"
else
  BASE_VERDICT="exact base"
fi
if [[ "$REVIEWED_HEAD" != "$CURRENT_HEAD_OID" ]]; then
  echo "[merge-gate] Blocked: reviewed head $REVIEWED_HEAD does not match current head $CURRENT_HEAD_OID." >&2
  exit 2
fi
if [[ "$COUNT" != "0" ]]; then
  echo "[merge-gate] Blocked: the review on #$PR reports ACTIONABLE FINDINGS: $COUNT." >&2
  echo "[merge-gate] Resolve them, then re-review. git-branch.md: only after ALL findings are resolved." >&2
  exit 2
fi

# The gate stops here on purpose. Whether a finding written in prose was addressed is the reviewer's
# judgement, and a hook guessing at it would be a check measuring the wrong thing. What it has
# established: CI is green, every inline finding is answered, the latest verdict names the exact
# current head with zero findings, and its base is either the current base or an ancestor of it
# whose local `git diff` to the current base — the whole diff, both names of every rename, no API
# page cap — names no file this PR touches, with GitHub reporting the merge clean now.
echo "[merge-gate] PR #$PR: CI CLEAN, exact head review, $BASE_VERDICT, ACTIONABLE FINDINGS: 0. READ IT." >&2
exit 0
