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

Track: `iteration = 0` (cap 3), and `last_findings = {}` (set of finding identities `file:line + severity`).

1. **Review.** Dispatch `pr-review-reviewer` on the PR. Read its terminal line `ACTIONABLE FINDINGS: <n>` and its
   finding set. (Do NOT judge the findings yourself — take the count as given.)
2. **Converged?** If `n == 0` → go to **Merge path**.
3. **Progress detection.** If the current finding-identity set equals `last_findings` (the same findings recurred
   unchanged) → **STOP and escalate to the user** (the loop is stuck; do not spin). Else set `last_findings` to it.
4. **Cap.** If `iteration >= 3` → **STOP and escalate to the user** (bounded; do not exceed the cap).
5. **Record + fix.** Dispatch `pr-review-writer` (posts the review to the PR), then `pr-review-fixer` (applies the
   MUST/SHOULD fixes). Increment `iteration`. Go to step 1 (re-review).

## Merge path (on `ACTIONABLE FINDINGS: 0`)

Hand to the gated merge path (detailed wiring is HARNESS-018d). It MUST honor [git-branch.md](../../rules/git-branch.md):

- Merge allowed only when there is **no unresolved MUST** and **every SHOULD is fixed or filed-and-linked** as a
  justified backlog item (never silently deferred), AND required CI checks are green.
- `develop`: gated admin-merge, then dispatch `merge-verifier` and require `MERGE VERIFIED: PASS`.
- `main`: **do NOT merge.** Enable auto-merge / mark ready and hand to the user — the agent never merges `main`.
- Delete the branch only after the merge is confirmed MERGED (branch-guard enforces this).

## What This Skill Does NOT Do

| Not this skill's job             | Owner                                      |
| -------------------------------- | ------------------------------------------ |
| Judge findings / assign severity | `pr-review-reviewer` (guardian)            |
| Post the review to the PR        | `pr-review-writer` (worker)                |
| Edit/fix code                    | `pr-review-fixer` (worker)                 |
| Decide the PR is "good"          | the reviewer's `ACTIONABLE FINDINGS` count |
| Merge `main`                     | the user (never the agent)                 |

If you find yourself reviewing, writing, or fixing inside this skill, stop — route to the owning agent instead.
