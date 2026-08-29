---
title: 'PROC-017: combine issue conversion, approved PLAN, and implementation into one ordered PR lifecycle'
issue: https://github.com/woojubb/robota/issues/2514
status: in-progress
created: 2026-08-29
priority: critical
urgency: now
area: repository workflow, harness scripts, backlog gates
depends_on: []
---

# PROC-017: combine issue conversion, approved PLAN, and implementation into one ordered PR lifecycle

## Objective

Reduce the eligible Issue-to-Task delivery path from two complete PR lifecycles to one ordered
topic-branch PR without weakening the repository's fail-closed planning, review, CI, merge, or
issue-writeback gates. Source issue: https://github.com/woojubb/robota/issues/2514.

The measured baseline from #2512 is one merged conversion PR (#2501) plus one merged implementation
PR (#2507) for #2082; #2506 was closed without merge and is excluded:
conversion-start to merge was 23m 14s, PR-open to merge was 11m 34s, and no runtime source changed
during the 44m 48s observed pre-implementation interval. This is evidence of duplicated ceremony, not
proof that this child alone solves the full queue-growth problem; B/C/D/E/F remain outside this Task.

Independent depth verdict: `DEPTH: SYSTEMIC` (2026-08-29). Independent recommendation verdict,
round 1: `REVIEW VERDICT: REVISE` (2026-08-29); the revised recommendation must be independently
reviewed again before implementation.

## Plan

- [ ] Define the eligibility predicate and ordered, resumable lifecycle while preserving existing owner boundaries.
- [ ] Add the conversion-evidence binding guard and focused failure-injection tests with RED proof.
- [ ] Update the governing workflow skills/rules and command documentation with the new owner map.
- [ ] Run affected harness scans, tests, and typecheck; this internal workflow change has no product CLI scenario.
- [ ] Complete independent review, CI/review-thread resolution, merge verification, and issue writeback.
- [ ] TC-01 — implement and run the missing-evidence parser test plus isolated RED proof.
- [ ] TC-02 — implement and run the deterministic affected-path classification fixture and affected scans.
- [ ] TC-03 — implement and run conversion/checkpoint refusal fixtures and preserve downstream guardians.
- [ ] TC-04 — wire all four owner documents and both harness owners, then run exact path scans.
- [ ] TC-05 — run pure parser and existing `finalizeIssueConversion` read-back failure tests plus #2514 read-back.
- [ ] TC-06 — record/compare baseline and candidate lifecycle JSON evidence and verify both artifacts are tracked.

## Test Plan

- Unit/integration tests cover successful ordered execution, duplicate retry idempotency, unreadable or
  failed Issue writeback, malformed/untriaged/security/data/user-decision refusal, missing/retrospective
  PLAN checkpoint refusal, implementation-before-checkpoint refusal, stale base/head, red verification,
  unresolved review threads, failed merge verification, and final writeback.
- Harness scans verify lane, task/spec binding, plan-order ancestry, task lifecycle, PR body, and
  no-session-link rules.
- The affected package/script test suite, typecheck, build, and CI-equivalent verification run before
  the PR is opened.

## Conversion Evidence Contract

Conversion evidence: issue=https://github.com/woojubb/robota/issues/2514; task=PROC-017; marker=https://github.com/woojubb/robota/issues/2514#issuecomment-5462112669; marker-readback=2026-08-29T11:29:05Z; priority-removed=2026-08-29T11:29:16Z; base=develop; base-oid=1ac4161df1cd6638c22b8ec63fe80b431001a6ec

Combined lifecycle eligibility: eligible; work-kind=enhancement; priority=P0; issue-state=OPEN; child-causes=0; security=none; data-correctness=none; user-decision=none; contract-change=none; owner-count=1

The eligibility line is the recommendation-gate output, not a claim inferred from labels. The guard
accepts only the exact values above (with the issue number/Task ID bound to this record); any refused
case records `Combined lifecycle eligibility: refused; reason=<...>` and stays on the normal guarded
route.

The planning checkpoint Task must contain exactly one line with this grammar:

`Conversion evidence: issue=https://github.com/woojubb/robota/issues/<N>; task=<ID>; marker=https://github.com/woojubb/robota/issues/<N>#issuecomment-<ID>; marker-readback=<UTC ISO-8601>; priority-removed=<UTC ISO-8601>; base=<ref>; base-oid=<40-hex>`.

The plan-order guard compares issue number, Task ID/path, marker issue number, and base OID against the
current Task/spec and branch. It refuses zero or multiple lines, malformed URLs/timestamps, a marker for
another Issue/Task, a missing priority-removal timestamp, or a base OID not reachable from the declared
base. The triage command remains the owner of whether the marker was actually read back and whether the
priority label was removed; the guard only consumes the recorded evidence and never synthesizes it.

After a crash following priority removal but before the planning checkpoint, rerun triage read-only. An
exact marker resumes at the existing Task/spec pair; the missing `Conversion evidence:` line is then
written once before PLAN. If the marker, Task path, Issue, or base identity differs, the run stops and
requires human reconciliation. No second Task/spec/comment/label/branch/PR is created.

## User Execution Test Scenarios

**Not applicable.** This Task changes repository-internal issue triage, planning gates, branch ancestry,
and harness enforcement only. It changes no `robota` runtime command, TUI/browser flow, public SDK/example,
configuration contract, or product output. The exact governance procedure and engineering evidence are
covered in `## Test Plan`; an internal harness command is not a canonical product surface.

`SCENARIO DRAFTED: not-applicable | 0` — author verdict, 2026-08-29.
**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`
Reason: not applicable because this work changes only repository-internal issue triage, planning gates,
branch ancestry, and harness enforcement; it changes no runtime command, TUI/browser flow, public SDK,
configuration contract, or product output.
