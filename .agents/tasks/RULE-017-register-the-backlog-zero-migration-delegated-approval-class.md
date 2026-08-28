---
title: 'RULE-017: register the BACKLOG-ZERO-MIGRATION delegated approval class'
issue: https://github.com/woojubb/robota/issues/2404
status: todo
created: 2026-08-28
priority: high
urgency: now
area: delegated approval registry and standing-delegation evidence guard
depends_on: []
---

# RULE-017: register the BACKLOG-ZERO-MIGRATION delegated approval class

## Objective

Register the owner-authorized `BACKLOG-ZERO-MIGRATION` delegated approval class so bounded,
documentation-only batches can return the finite 2026-08-28 local backlog snapshot to canonical GitHub
issues or terminalize records whose outcomes were already delivered. The class must fail closed outside
that exact historical migration and must not authorize package/app source, public API, policy, workflow,
hook, workspace-topology, product-direction, or user-authored-document changes.

Source initiative: https://github.com/woojubb/robota/issues/2404.

Owner instruction (verbatim, 2026-08-28):

> DOCS-029 승인함. BACKLOG-ZERO-MIGRATION 클래스를 등록하고, 2026-08-28 기준 기존 backlog를
> GitHub issue로 이관하거나 이미 전달된 기록을 종결하는 문서 전용 배치를 자동 승인하도록
> 위임함. 패키지 소스/API/정책 변경은 제외.

Issue conversion: issue #2404 is a parent initiative with three independently verifiable causes. This
Task owns only the delegated-class registration and the evidence-form enforcement necessary for that
class to fail closed. The history-aware zero-nonterminal-record lifetime guard and the finite migration
batches remain separate work units under the same open issue.

## Plan

- [ ] Add one `BACKLOG-ZERO-MIGRATION` row to the delegated-class registry with the exact owner
      instruction and registration date `2026-08-28`, preserving the independently registered
      `LANE-L0-L1` row that landed first through PROC-016.
- [ ] Derive the eligible population directly from the exact Task/spec paths and blob OIDs at
      `2c875dd3ec6938d6eb0563b50c40d1f116fb4e7e`; do not depend on an ephemeral `/tmp` snapshot as
      authorization evidence.
- [ ] Require each batch spec to commit a `## Migration Manifest` section before approval, with at most
      six units and 15 tracked paths. A unit may contain a Task, a spec, or both; each row records its
      unit ID, original paths/blob OIDs, exact issue/comment or delivery evidence, criterion-level
      disposition, live ownership/reservation checks, and every frozen-baseline old-to-new key mapping.
      Any post-approval manifest change needs a new approval.
- [ ] Exclude only records with current branch/worktree/PR/session ownership or reservation, or whose
      source blob drifted from the manifest; status labels such as active or blocked do not by
      themselves exclude a stale legacy record. Reject related-only/umbrella issue matches, wildcard
      populations, deletion-only dispositions, and local terminalization before remote handoff
      read-back succeeds.
- [ ] Permit only Task/spec lifecycle documents, the batch's loop-run records, and no-growth rekeys of
      existing frozen-baseline paths; explicitly exclude package/app source, APIs/contracts, policy and
      gate documents, skills, workflows, hooks, workspace topology, product scope, and user-authored
      documents.
- [ ] Limit GitHub mutation to idempotent issue creation with read-back uniqueness and append-only
      evidence comments; exclude issue edit/delete/reopen/transfer/metadata changes and issue closure.
- [ ] Make the standing-delegation guard reject incomplete or duplicate registry rows, missing/blank
      DIRECT `Given`, missing/blank CLASS `Given` or `Evidence condition met`, and a CLASS instruction
      that does not exactly match its registry row, without attempting to infer semantic scope.
- [ ] Add red/green fixtures for live registration, registration-date ordering, incomplete/duplicate
      registry rows, DIRECT/CLASS provenance, CLASS instruction matching, and a complete
      post-registration CLASS approval; exercise every new refusal with applied-check mutation evidence.
- [ ] Run the focused guard suite, live standing-delegation scan, `pnpm harness:scan`, and
      `pnpm harness:verify-like-ci`.

## Recommendation Gate

- Finding depth: one Task. Registry declaration and its structural enforcement are one cause with one
  owner and one completion decision; the broader lifetime invariant and migration execution are not
  implementation steps of this cause.
- Proposal review round 1: `REVIEW VERDICT: REVISE` with 3 actionable findings on 2026-08-28.
- Proposal review round 2: `REVIEW VERDICT: ENDORSE`; `ACTIONABLE FINDINGS: 0` on 2026-08-28. The final
  design closes the full evidence form, replaces ephemeral snapshot evidence with a committed manifest
  derived from git, and supports legacy Task-only/spec-only and stale-status records.
- Approval gate: `GATE VERDICT: PASS` via Route `DIRECT` on 2026-08-28 after the final RULE-017
  Architecture Review and ID reallocation; implementation had not started. That pass was later
  withdrawn after PROC-016 landed first and invalidated the empty-registry/current-test premise.
- Integration refresh: rebased onto `origin/develop` `e93e1485a`; the revised design now preserves the
  live `LANE-L0-L1` row and tests exactly two live rows. Fresh independent recommendation review and
  DIRECT approval are required before GATE-IMPLEMENT.
- Lane refresh: the post-PROC full scan derived floor `L2` from the intended
  `.agents/rules/backlog-execution.md` edit; the revised spec declares `lane: L2`. Route CLASS remains
  forbidden because lane declaration and approval authority are separate mechanisms.
- Recommendation re-review round 1: `REVIEW VERDICT: REVISE`, `ACTIONABLE FINDINGS: 3`. The revision
  now defines the leading-quoted canonical instruction payload so the lane row's provenance suffix is
  preserved, requires rule-owner enforcement prose synchronization, and corrects the live count to
  `9 DIRECT` after withdrawal.
- Recommendation re-review round 2: `REVIEW VERDICT: ENDORSE`, `ACTIONABLE FINDINGS: 0`. The reviewer
  confirmed the live premise, canonical payload, owner-prose synchronization, L2 declaration, prior
  approval withdrawal, and PR #2421's semantically disjoint hunk.
- Fresh approval gate: `GATE VERDICT: PASS` via Route `DIRECT`; exact instruction `"끝까지 작업해줘"`
  given 2026-08-28 in this conversation after the revised design was presented. Latest-base revalidation
  on `origin/develop` `1d46006de` and the 146-pass full scan found no material design change.

## Test Plan

- `pnpm exec vitest run scripts/harness/__tests__/scan-standing-delegation-evidence.test.mjs`.
- `node scripts/harness/scan-standing-delegation-evidence.mjs`.
- Applied-check/mutation cases prove each new refusal is not a constant-green assertion.
- `pnpm harness:scan`.
- `pnpm harness:verify-like-ci`.

## User Execution Test Scenarios

**Not applicable.** This Task changes repository-internal approval policy and its harness validation.
It changes no runnable product command, UI flow, public SDK behavior, configuration contract, or runtime
output. Engineering evidence belongs in the Test Plan.
