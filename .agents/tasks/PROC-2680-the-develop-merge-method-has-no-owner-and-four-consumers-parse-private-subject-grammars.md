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

**Spec:** `.agents/spec-docs/draft/PROC-2680-the-develop-merge-method-has-no-owner-and-four-consumers-parse-private-subject-grammars.md`

**Lane:** L1 — the implementation changes internal scripts; no L2 path or external product contract
is changed. The merge hook and live ruleset remain unchanged.

## Objective

Give the method that lands a pull request on `develop` one owner, and give the delivery-critical
closeout and promotion consumers one shared reader instead of a private subject grammar. Resolve the
delivering PR without parsing the subject, using exact base plus the pull request's
`mergeCommit.oid`; keep the distinct release-topology and workflow-authentication cause as a
separate follow-up on issue #2680 whose Task is allocated when selected.

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

Independent proposal review established that the release consumer is not the same implementation
unit: tagged releases traverse `main` promotion topology, not `develop` first-parent arrivals, and
the two release workflows currently promise network-free generation. Issue #2680 retains that
separate L2 workflow/topology follow-up; this item owns the shared selector and the consumers that
immediately block #2664.

## Source Constraints

- `main` keeps `allowed_merge_methods: ["merge"]` and the promotion-ancestry gate unchanged; this
  item is about `develop`.
- A shared reader must not infer a landing from a subject mention: a merged PR that names an issue is
  usually registering work, not delivering it (`git-branch.md` "Work that reaches `develop` is
  resolved").
- Historical `develop` landings of both shapes stay readable; no history rewrite.
- The closeout and promotion consumers read one fact from one owner, never private subject grammars.
- The release-note parser is unchanged by this L1 item; issue #2680 retains the separate follow-up,
  whose Task is allocated only when that work is selected and will depend on this shared selector.

## Plan

- [ ] TC-01 — Add one exact base/OID commit-to-PR selector and bounded GitHub adapter, red-proofed for
      squash, two-parent, missing, mismatched, unmerged, and ambiguous projections.
- [ ] TC-02 — Replace the two post-merge subject checks with an authoritative GitHub read while
      preserving the existing Task Result/comment shape, local commit-existence check, and
      target-ancestry proof.
- [ ] TC-03 — Make promotion-close derivation resolve every first-parent landing through the shared
      selector before reading pull-request bodies in both `promote.mjs` and the required check.
- [ ] TC-04 — Correct squash-only rule prose, document why the unrestricted develop ruleset and the
      hook's permitted `--merge` hint require no mutation, and record the separate release cause on
      issue #2680 without allocating its Task early.
- [ ] TC-05 — Run the focused tests and affected scan, then record the PR #2805 receipt that
      `MANIFEST-2664` closeout depends on.

## Test Plan

Focused injected GitHub projections and temporary repositories carry one squash landing and one
two-parent landing. Tests prove exact OID/base selection, authoritative closeout binding, retained
ancestry checks, promotion body lookup, the `promote.mjs` loud fallback, and required-check failure;
the affected scan supplies the integration regression proof.

## Recommendation

Use one shared landing-PR reader keyed by exact `mergeCommit.oid` and expected base. Do not enforce a
single merge method on `develop`: that policy would not make historical mixed landings readable and
would add an external ruleset mutation without removing any of this implementation. Three independent
read-only reviews reached the same selector result. The revised design uses live authoritative reads
for closeout, includes both promotion callers, and transfers release topology/authentication to a
separate #2680 follow-up after independent review disproved one first-parent algorithm across
`develop` and `main`.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This changes the repository's merge-landing contract, harness scripts under
`scripts/harness/`, and a rule document; no Robota CLI, TUI, browser, SDK, configuration, or
installed-package surface an end user can execute is involved.

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
