---
name: pr-review-orchestration
description: Orchestrator for the PR-review loop (HARNESS-018). Sequences the pr-review-reviewer (guardian) → pr-review-writer → pr-review-fixer agents on a PR, loops until the reviewer reports ACTIONABLE FINDINGS 0, bounded by a max-iteration cap + progress detection, then hands to the gated merge path. It manages ONLY the pipeline flow — it does not review, write, fix, or judge quality itself. Synchronous today (async firing is HARNESS-018a).
---

# PR Review Orchestration

Route-only orchestrator for reviewing a PR to convergence. This skill manages ONLY the loop — it does not review,
post, fix, or judge; it routes on the reviewer's machine signal. All judgment lives in `pr-review-reviewer`; all
work lives in `pr-review-writer` / `pr-review-fixer`.

## Rule Anchor

- [enforcement-architecture.md](../../rules/enforcement-architecture.md) — worker / guardian / orchestrator; hybrid loop-back.
- [git-branch.md](../../rules/git-branch.md) — Pre-Merge Code-Review Gate; agent never merges `main`; delete-after-confirm.
- Reviewer/writer/fixer agents in `.claude/agents/pr-review-*.md`.

## When to Use

Invoke on an open PR that needs review → converge → merge.

## Invocation — async (018a) and its honest limit

Run this loop in the **trusted local session** (it holds the checkout + keys; the fixer must never run
untrusted fork code in a privileged CI runner — that is the `pull_request_target` pwn surface the design
rejects). Two modes:

- **Async execution (available now).** The calling session spawns this orchestration as a **background Agent**
  (the Agent tool's `run_in_background`), so the caller is not blocked while the reviewer→fixer loop runs.
  This is the same background-agent mechanism used elsewhere in the harness.
- **Automatic on-PR triggering (out of scope).** There is no server-side webhook that fires this without a
  running agent host, because the only server-side option (`pull_request_target` executing fork code with
  secrets) is rejected on security. So firing is: the calling session (or a human) starts it when a PR is up.
  GitHub Actions on the plain `pull_request` event remains only the required-check floor (`ci.yml`).

## The Loop (route-only)

The loop runs in TWO places, and which one comes first is the whole point.

### Round A — on the LOCAL DIFF, before any push (required)

Measured across one session (2026-07-28), PRs #1514/#1518/#1519/#1520/#1521: 38 review rounds, 24 of them
carrying a blocking finding, at 6–10 minutes of CI each. Not one of those findings needed CI to be visible —
every one was read out of the diff. Several were regressions introduced by the previous round's fix, which a
review of the NEXT diff would have caught just as cheaply. This loop used to wait for required checks to go
green before its first review round, so the reviewer only ever saw a diff that had already been pushed,
opened as a PR and run through CI: every finding cost a round trip before anyone could look at it.

`pr-review-reviewer` already accepts a local diff (`git diff origin/<base>...HEAD`) — only the precondition
forced the trip. So:

A1. **Review the local diff.** Dispatch `pr-review-reviewer` with `git diff origin/<base>...HEAD`. No PR, no
CI, no push. Read its terminal `ACTIONABLE FINDINGS: <n>`.
A2. **Not zero?** Dispatch `finding-depth-triager` on the findings and route on its `DEPTH:` verdicts —
the judgement is the guardian's, the routing is this skill's, and neither does the other's job. Required by
[finding-depth.md](../../rules/finding-depth.md), which owns the three questions and what each verdict requires:

- **LOCAL** → fix (`pr-review-fixer` or directly), commit, and repeat A1. A round here costs about a
  minute. The same round after a push costs a CI cycle.
- **INVALID** → the premise does not hold. Nothing to fix; record what the code actually does, and do not
  let a wrong finding drive a change.
- **FOUNDATIONAL** → do NOT send it back into the fix loop. Route to `backlog-writer` for the root item,
  register its GitHub issue, then take the disposition: **re-plan** (the change is withdrawn or reduced) or
  **labelled containment** (the smallest hold, naming the item's ID in a code comment and the commit body).
  Record the IDs with the round: `pnpm harness:review:record -- --findings 0 --foundational <ID>[,<ID>...]`.
  Then **return to A1**: the containment is a change like any other, and the next round reads it.
  Push is A3's, and only once a round comes back zero.

A loop that fixes every finding where it was reported converges just as cleanly as one that does not, which
is why the depth question has to be asked before the fix rather than noticed afterwards.

A3. **Zero?** Record it — `pnpm harness:review:record -- --findings 0` — and push.

`pre-push-check` enforces A3: a feature-branch push whose HEAD has no matching record is refused, naming
`PRE_PUSH_ALLOW_UNREVIEWED=1` for a deliberate exception. The record says a review RAN at this commit and
reported zero gating findings; it does not claim the review was good, which is the reviewer's job and not a
hook's. Integration branches and `release/promote-*` are exempt — a promotion carries develop's
already-reviewed content and no diff of its own.

### Round B — on the open PR, before merge

Track: `iteration = 0` (cap 3), and `last_findings = {}` (set of finding identities `file:line + severity`).

0. **Wait for the gate precondition** the rule sets (required checks green): dispatch
   [ci-gate-watch](../ci-gate-watch/SKILL.md) on the PR's checks. `GREEN` → step 1. `RED` or `STALLED` →
   **leave the loop** and route it as a build/test failure under the verification rules, not as a review
   finding; re-enter here once the head is green. This precondition belongs HERE and only here: the merge
   round must judge what will actually merge, and `merge-gate` requires a review newer than the head commit.
1. **Review.** Dispatch `pr-review-reviewer` on the PR at the diff scope the rule's gate preconditions
   define. Read its terminal line `ACTIONABLE FINDINGS: <n>` and its finding set. (Do NOT judge the
   findings yourself — take the count as given.)
2. **Converged?** If `n == 0` → go to **Merge path**.
3. **Progress detection.** If the current finding-identity set equals `last_findings` (the same findings recurred
   unchanged) → **STOP and escalate to the user** (the loop is stuck; do not spin). Else set `last_findings` to it.
4. **Cap.** If `iteration >= 3` → **STOP and escalate to the user** (bounded; do not exceed the cap).
5. **Record + fix.** Dispatch `pr-review-writer` (posts the review to the PR), then `pr-review-fixer` (applies the
   MUST/SHOULD fixes). Each fix returns to **Round A** — review the new local diff and record it before pushing
   again — then increment `iteration` and go to step 1.

## Merge path (on `ACTIONABLE FINDINGS: 0`)

Hand to the gated merge path (detailed wiring is HARNESS-018d). The gate is mechanical:
`.claude/hooks/merge-gate.sh` refuses `gh pr merge` unless CI is `CLEAN` and a review newer than the
head commit exists, and refuses outright while `ACTIONABLE FINDINGS: <n>` is non-zero — so a step of
this pipeline cannot be skipped by merging directly. It MUST honor [git-branch.md](../../rules/git-branch.md):

- Merge allowed only when there is **no unresolved MUST** and **every SHOULD is fixed or filed-and-linked** as a
  justified backlog item (never silently deferred), AND required CI checks are green.
- `develop`: gated admin-merge, then hand to [post-merge-cycle](../post-merge-cycle/SKILL.md) — which
  requires `merge-verifier`'s `MERGE VERIFIED: PASS` before it will delete anything, and owns the branch
  deletion and base-reset steps. Do not verify, delete, or re-base here.
- `main`: **do NOT merge.** Enable auto-merge / mark ready and hand to the user — the agent never merges `main`.

## What This Skill Does NOT Do

| Not this skill's job                   | Owner                                            |
| -------------------------------------- | ------------------------------------------------ |
| Judge findings / assign severity       | `pr-review-reviewer` (guardian)                  |
| Post the review to the PR              | `pr-review-writer` (worker)                      |
| Edit/fix code                          | `pr-review-fixer` (worker)                       |
| Decide the PR is "good"                | the reviewer's `ACTIONABLE FINDINGS` count       |
| Merge `main`                           | the user (never the agent)                       |
| Verify the landing / delete the branch | [post-merge-cycle](../post-merge-cycle/SKILL.md) |

If you find yourself reviewing, writing, or fixing inside this skill, stop — route to the owning agent instead.
