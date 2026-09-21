---
title: 'PROC-2680: The develop merge method has no owner, and four consumers parse private subject grammars'
issue: https://github.com/woojubb/robota/issues/2680
status: todo
created: 2026-09-21
priority: high
urgency: soon
area: harness merge landing and post-merge receipts
depends_on: []
---

# PROC-2680: The develop merge method has no owner, and four consumers parse private subject grammars

## Objective

Give the method that lands a pull request on `develop` one owner, and give every consumer that must
answer "which pull request landed this commit" one shared reader instead of a private subject
grammar: either declare and enforce one landing method for `develop` (the `protect-develop` ruleset's
`allowed_merge_methods`, the rule text, and the merge-gate hint agreeing), or resolve the landing PR
without parsing the subject at all (the pull request's `mergeCommit.oid`, or a receipt that carries
it) — one of these, decided by its own recommendation gate.

## Problem

`.agents/rules/git-branch.md` states in two places (the enforcement table under "Promotion —
develop → main" and "Delete Merged Branches") that feature pull requests into `develop` squash; `.claude/hooks/merge-gate.sh`
prescribes `gh pr merge <n> --merge` in every hint it prints; the `protect-develop` ruleset restricts no
method (`allowed_merge_methods` exists only on `protect-main`,
`scripts/harness/scan-promotion-ancestry.mjs`); and practice flipped on 2026-09-19 with no rule
amendment — from 2026-09-11 to 09-15 all 33 first-parent landings on `develop` were squashes, from
2026-09-19 to 09-21 27 were merge commits and 5 squashes. Four consumers hardcode the squash subject
grammar and already disagree: `validateRemoteCompletionReceipt` in
`scripts/harness/scan-user-execution-plan-order.mjs` accepts a `(#N)` subject only, while its sibling
`validatePostMergeRecord` in the same file also accepts `pull request #N`;
`scripts/harness/promotion-closes.mjs` derives the issues a promotion closes from a trailing `(#N)`
only; `scripts/release/generate-release-notes.mjs` `parseConventional` returns `null` for every
merge-commit subject. The rule names this class itself ("Delete Merged Branches": encoding a
contingent fact about tooling as a property of merged branches makes the rule unsatisfiable the
moment the method changes, and the failure is silent). Measured cost on 2026-09-21: `MANIFEST-2664`,
delivered by PR #2805 as merge commit `79698d78d`, cannot pass the post-merge completion closeout
door; roughly 27 of the last 60 `develop` landings are invisible to promotion-closes and reach the
release notes unattributed to a pull request and outside its `(#N)` de-duplication.

## Source Constraints

- `main` keeps `allowed_merge_methods: ["merge"]` and the promotion-ancestry gate unchanged; this
  item is about `develop`.
- A shared reader must not infer a landing from a subject mention: a merged PR that names an issue is
  usually registering work, not delivering it (`git-branch.md` "Work that reaches `develop` is
  resolved").
- Historical `develop` landings of both shapes stay readable; no history rewrite.
- Whichever direction the recommendation gate chooses, the four consumers end up reading one fact
  from one owner, never four private grammars.

## Plan

- [ ] TC-01 — Measure and record the current mix of arrival shapes on `develop` (first-parent commits
      since the 2026-09-11 baseline, squash vs two-parent) and enumerate every consumer that parses an arrival
      subject, with the grammar each accepts.
- [ ] TC-02 — Decide, through the recommendation gate, between one enforced method for `develop` and
      one shared landing-PR reader; specify it in the paired spec, including how existing
      merge-commit landings are read.
- [ ] TC-03 — Implement the decision so the four named consumers agree, red-proofed against a fixture
      holding one squash landing and one merge-commit landing of the same PR number.
- [ ] TC-04 — Bring `git-branch.md`, the hook hints, and the `protect-develop` ruleset into agreement
      with the decision, and record the receipt `PROC-2664` TC-04 depends on.

## Test Plan

Fixture repositories under `make-temp.mjs` with a base branch carrying one squash landing
(`subject (#N)`) and one merge-commit landing (`Merge pull request #N from …`) of known PR numbers;
assert each consumer's answer before and after the change. The ruleset half, if chosen, is verified
by reading the live ruleset through `gh api` and recording the JSON, never by a merge attempt.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This changes the repository's merge-landing contract, harness scripts under
`scripts/harness/` and `scripts/release/`, a rule document, and a hook hint; no Robota CLI, TUI,
browser, SDK, configuration, or installed-package surface an end user can execute is involved.

## Finding Evidence

- Filed 2026-09-21 as the root item beneath the second facet of `PROC-2664`, from a
  `DEPTH VERDICT: FOUNDATIONAL` returned by `finding-depth-triager` (orchestrator run
  `r20260921144518`, halted for the owner's re-scoping decision). Repeat trail the triager assembled:
  `validateRemoteCompletionReceipt` written 2026-09-15 (`4c790a7c5`, HARNESS-2724) into a squash-only
  repository; the landing mix flipped 2026-09-19; `validatePostMergeRecord` diverged from it in the
  same file; `promotion-closes.mjs` and `generate-release-notes.mjs` share the assumption.
  Reconciled against the Task registry and the issue tracker: no prior item names the develop merge
  method or a shared landing reader (issue #2135 covered deleting squash-merged branches, closed).
  Registered on the umbrella issue #2680:
  https://github.com/woojubb/robota/issues/2680#issuecomment-5762510054.
- `PROC-2664` TC-04 depends on this item instead of widening one of the four grammars.
