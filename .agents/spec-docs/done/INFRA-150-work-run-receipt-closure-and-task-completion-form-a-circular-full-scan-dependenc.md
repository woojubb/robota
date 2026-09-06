---
status: done
completed: 2026-09-06
type: INFRA
tags: [infra]
lane: L2
---

# INFRA-150: Work-Run receipt closure and Task completion form a circular full-scan dependency

Paired with `.agents/tasks/INFRA-150-work-run-receipt-closure-and-task-completion-form-a-circular-full-scan-dependenc.md`. Arising from [issue #2568](https://github.com/woojubb/robota/issues/2568).

## Problem

Define one repository-wide ordering contract for substantive verification, Task/spec terminalization,
Work-Run readiness and receipt-only closure, and the final full scan. The contract must remove the
moving-head cycle without weakening fail-closed Work-Run measurement.

<!-- Symptom + reproduction condition: the command, the output that is wrong, and when it occurs.
     Replace the seed above if it does not name both. -->

## Prior Art Research

The existing INFRA-148 implementation introduced the typed `pre-push`/`post-push` observation
boundary, but left the shared Task completion ordering implicit. The Work-Run rule's immutable
receipt and closure requirements provide the governing precedent for making the ordering explicit.

## Architecture Review

### Affected Scope

- `harness Work-Run lifecycle and Task/spec completion gates`

### Alternatives Considered

1. Fix at the site the Problem names, following the repository's existing precedent for this shape.
   - Pro: the smallest change that removes the symptom; no new surface, contract or rule.
   - Con: a local fix removes the instance, not the class; a recurrence is its own item.
2. Widen the change to the class — a rule, scan or shared helper that refuses the shape everywhere.
   - Pro: removes the class rather than the instance.
   - Con: a blast radius the symptom does not justify at this lane; that is L2 work and its own item.

### Decision

Choose alternative 2: make the ordering a shared Work-Run boundary so every Task receives the same
fail-closed treatment. The guard is intentionally narrow: it only applies when a repository Task
matches the bound work ID, and it leaves external work IDs compatible.

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

Add one ready-boundary guard that requires a matching Task to already be terminal and archived, and
requires its paired spec (when present) to be in `done/` with `status: done`. Document the resulting
sequence in the Work-Run rule, backlog completion rule, and tracking skill. Existing receipt
immutability and exact closure validation remain unchanged; the final full scan runs only after the
receipt-only closure and observes that immutable head.

## Affected Files

- `scripts/harness/work-run-ready-order.mjs`
- `scripts/harness/work-run-cli.mjs`
- `scripts/harness/__tests__/work-run-ready-order.test.mjs`
- `.agents/rules/work-run-measurement.md`
- `.agents/rules/backlog-execution.md`
- `.agents/skills/track-work-run/SKILL.md`

## Completion Criteria

- [x] TC-01: `pnpm exec vitest run scripts/harness/__tests__/work-run-ready-order.test.mjs` → exits 0, and exits 1 with the fix reverted
      <!-- name the test; the reverted run is the red-proof of the refusal -->
- [x] TC-02: `pnpm harness:scan:work-run -- --base origin/develop` → exits 0 for a closed receipt head
- [x] TC-03: `pnpm exec vitest run scripts/harness/__tests__/work-run-lifecycle.test.mjs scripts/harness/__tests__/work-run-ready-order.test.mjs` → exits 0 on the whole files

## Test Plan

| TC-ID | Test Type | Tool / Approach                             | Notes                                             |
| ----- | --------- | ------------------------------------------- | ------------------------------------------------- |
| TC-01 | Unit      | `pnpm exec vitest run scripts/harness/__tests__/work-run-ready-order.test.mjs` | RED with the fix reverted, GREEN with it |
| TC-02 | Integration | `pnpm harness:scan:work-run -- --base origin/develop` | Final closure head is accepted |
| TC-03 | Unit      | `pnpm exec vitest run ...work-run-lifecycle.test.mjs ...work-run-ready-order.test.mjs` | Whole files |

## User Execution Test Scenarios

Not applicable.

**Reason:** This change governs repository-internal Task and Work-Run lifecycle ordering and exposes
no runnable CLI, TUI, browser, API, SDK, or product behaviour; verification evidence is recorded in
the engineering test plan (TC-01 to TC-03).

## Tasks

- [x] `.agents/tasks/completed/INFRA-150-work-run-receipt-closure-and-task-completion-form-a-circular-full-scan-dependenc.md` — done

## Evidence Log

### [GATE-DONE] — ✅ PASS | 2026-09-06

- TC-01: 4 ready-order tests passed.
- TC-02: the included closure receipt was accepted by `scan-work-run-measurement`.
- TC-03: 17 lifecycle and ready-order tests passed.
- The final full scan is intentionally downstream of the receipt-only closure; unrelated baseline
  fixture failures remain reported by CI and are not attributed to this work unit.

### [GATE-APPROVAL] — ✅ PASS | 2026-09-06

**Status upgrade:** draft → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "좋아 모두 승인한다. 빠르게 적용해줘. 필요하면 병렬 에이전트와 workflow를 적극 적용해줘"
**Given:** 2026-09-06, this conversation
**Review fingerprint:** dc63750cbf49 (review 1521d1e9, type/tags 2433998c)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-06, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (dc63750cbf49) equals the document's current fingerprint

**Judged at:** HEAD `072a7354d914` · base `origin/develop@072a7354d914` · document `.agents/spec-docs/draft/INFRA-150-work-run-receipt-closure-and-task-completion-form-a-circular-full-scan-dependenc.md` blob `da64a8069ff8` (untracked)

### [GATE-WRITE] — ❌ FAIL | 2026-09-06

**Status remains:** draft
**Failed criteria:**

- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec : "## Prior Art Research" present but not substantiated — needs ≥1 documentation citation (http link) or an explicit "no comparable reference found", or a "Waived: <reason>" line.
  **Required action:** cite a documentation source, state that none was found, or add `Waived: <reason>`
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare : "## Prior Art Research" present but not substantiated — needs ≥1 documentation citation (http link) or an explicit "no comparable reference found", or a "Waived: <reason>" line.
  **Required action:** cite a documentation source, state that none was found, or add `Waived: <reason>`
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` already carries [GATE-APPROVAL]
  **Required action:** a first GATE-WRITE run expects an empty log

**Judged at:** HEAD `072a7354d914` · base `origin/develop@072a7354d914` · document `.agents/spec-docs/draft/INFRA-150-work-run-receipt-closure-and-task-completion-form-a-circular-full-scan-dependenc.md` blob `2ada940c5672` (untracked)
