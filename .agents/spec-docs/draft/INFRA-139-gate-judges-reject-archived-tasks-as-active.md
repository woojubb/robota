---
status: draft
type: INFRA
tags: [harness, gate]
lane: L2
---

# INFRA-139: Gate judges reject archived Tasks as active

Paired with `.agents/tasks/INFRA-139-gate-judges-reject-archived-tasks-as-active.md`. Arising from [issue #2467](https://github.com/woojubb/robota/issues/2467).

## Problem

When a spec's `## Tasks` section names an existing archived path such as
`.agents/tasks/completed/INFRA-138-...md`, the gate's active-task criteria currently pass because
the common reader checks existence without enforcing the active root path. This reproduced in the
DOCS-038 correction: the archived Task was accepted by fresh GATE-IMPLEMENT and later
GATE-COMPLETE. The issue is tracked in [#2467](https://github.com/woojubb/robota/issues/2467).

<!-- Symptom + reproduction condition: the command, the output that is wrong, and when it occurs.
     Replace the seed above if it does not name both. -->

## Prior Art Research

Waived: this is an internal path-contract correction; external products cannot establish the
repository's canonical active-vs-archived Task path, and the governing evidence is the existing
gate implementation plus the DOCS-038 regression.

## Architecture Review

### Affected Scope

`scripts/harness/gate.mjs` (canonical gate reader); `scripts/harness/__tests__/gate.test.mjs`
(regression fixtures); the paired Task/spec and gate evidence only.

### Alternatives Considered

1. Keep existence-only validation.
   - Pro: no code change.
   - Con: archived records can still satisfy active gates.
2. Reject only paths containing the literal `completed` segment.
   - Pro: small patch.
   - Con: other nested/non-canonical paths remain ambiguous.
3. Require the exact root active form `.agents/tasks/<basename>.md` and reject every nested path.
   - Pro: matches the repository contract and is easy to falsify with fixtures.
   - Con: requires updating the shared gate criterion and tests.

### Decision

Choose alternative 3. Exact root-path validation prevents both known archived paths and future
nested aliases while preserving valid active Task behavior; tests cover the adversarial archived
case and the normal root case.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: internal fix with no contract change; the remedy is the repository's own precedent
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None

## Solution

1. Add archived-path and root-path gate fixtures in `scripts/harness/__tests__/gate.test.mjs`.
2. Update `scripts/harness/gate.mjs` so active-task checks reject any path other than the exact
   `.agents/tasks/<ID>.md` form.
3. Run focused tests, harness scans, and CI-equivalent verification.

## Affected Files

`scripts/harness/gate.mjs`
`scripts/harness/__tests__/gate.test.mjs`
`.agents/tasks/INFRA-139-gate-judges-reject-archived-tasks-as-active.md`
`.agents/spec-docs/draft/INFRA-139-gate-judges-reject-archived-tasks-as-active.md`

## Completion Criteria

- [ ] TC-01: `pnpm exec vitest run scripts/harness/__tests__/gate.test.mjs` has a RED archived-path
      regression before the fix and exits 0 after it.
- [ ] TC-02: `pnpm harness:scan` exits 0.
- [ ] TC-03: `pnpm harness:verify-like-ci` exits 0.

## Test Plan

| TC-ID | Test Type | Tool / Approach                                                | Notes                              |
| ----- | --------- | -------------------------------------------------------------- | ---------------------------------- |
| TC-01 | Unit      | `pnpm exec vitest run scripts/harness/__tests__/gate.test.mjs` | RED/GREEN regression and full file |
| TC-02 | Suite     | `pnpm harness:scan`                                            | Repository mechanical gates        |
| TC-03 | CI-like   | `pnpm harness:verify-like-ci`                                  | Full CI-equivalent gate            |

## User Execution Test Scenarios

Not applicable — no runnable user-facing behaviour changes; verification evidence is recorded in the engineering test plan (TC-01 to TC-03).

Recorded as the rule's required choice rather than skipped.

## Tasks

- [ ] `.agents/tasks/INFRA-139-gate-judges-reject-archived-tasks-as-active.md` — todo

## Evidence Log
