---
status: done
completed: 2026-09-06
type: INFRA
tags: [harness, typescript]
lane: L2
---

# HARNESS-2253: promote the five-axis SSOT checker to a harness scan

## Problem

The five-axis SSOT checker described by issue #2253 existed only as branch-local work, so a future
change could break SSOT agreement without a repository scan reporting it.

## Prior Art Research

Waived: the user explicitly authorized skipping procedural research and prioritizing rapid local issue
processing; the local issue snapshot supplies the bounded prior-art and falsification requirements.

## Architecture Review

### Affected Scope

- `scripts/harness/scan-ssot-five-axis.mjs`
- `scripts/harness/__tests__/scan-ssot-five-axis.test.mjs`
- `scripts/harness/examined-adoption-baseline.json`
- `scripts/harness/measurement-provenance-pending.json`

### Alternatives Considered

1. Keep the checker manual. Pro: no CI cost. Con: regressions remain invisible.
2. Add one derived scan with pure axis helpers and fixture probes. Pro: one owner and measurable output. Con: adds a scan process.

### Decision

Choose the derived scan. Its helpers are independently testable, and malformed inputs fail closed.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: repository harness scan, not a product command family
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None

## Solution

Implement five pure checks over explicit inputs, run the root-export/SPEC axis against tracked package
sources, and expose a discoverable scan declaration with examined-size evidence.

## Affected Files

scripts/harness/scan-ssot-five-axis.mjs
scripts/harness/__tests__/scan-ssot-five-axis.test.mjs
scripts/harness/examined-adoption-baseline.json
scripts/harness/measurement-provenance-pending.json

## Completion Criteria

- [x] TC-01: each axis has a failing fixture and a passing control.
- [x] TC-02: the real repository scan exits 0 with a positive denominator.
- [x] TC-03: the scan is discovered by the full harness suite and adoption is frozen.

## Test Plan

| TC-ID | Test Type | Tool / Approach | Notes |
| --- | --- | --- | --- |
| TC-01 | Unit | Vitest fixture probes | refusal and control per axis |
| TC-02 | Scan | Node scan entrypoint | tracked repository |
| TC-03 | Integration | `pnpm harness:scan -- --context pr` | discovery and adoption |

## User Execution Test Scenarios

Not applicable.
**Reason:** This is a repository governance scan and adds no product-facing command, API, or runtime behavior.

## Tasks

- [x] `.agents/tasks/completed/HARNESS-2253-promote-five-axis-ssot-checker.md` — done

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-09-06

**Approval route:** `DIRECT`
**Instruction (verbatim):** "모두 생략 허용합니다."
**Given:** 2026-09-06, this conversation

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-06

**Status upgrade:** approved → in-progress

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "gateImplementFirst",
  "taskPath": ".agents/tasks/HARNESS-2253-promote-five-axis-ssot-checker.md",
  "specPath": ".agents/spec-docs/todo/HARNESS-2253-promote-five-axis-ssot-checker.md",
  "taskItems": [
    { "kind": "tc-id", "value": "TC-01" },
    { "kind": "tc-id", "value": "TC-02" },
    { "kind": "tc-id", "value": "TC-03" }
  ],
  "plan": { "outcome": "not-applicable", "count": 0 },
  "worktreePaths": [
    ".agents/spec-docs/todo/HARNESS-2253-promote-five-axis-ssot-checker.md",
    ".agents/tasks/HARNESS-2253-promote-five-axis-ssot-checker.md"
  ]
}
```

<!-- checkpoint-evidence:v1:end -->

### [GATE-VERIFY] — ✅ PASS | 2026-09-06

- `pnpm exec vitest run scripts/harness/__tests__/scan-ssot-five-axis.test.mjs` — 6 tests passed.
- `node scripts/harness/scan-ssot-five-axis.mjs` — examined 61 package SPEC/root pairs; passed.
- `pnpm harness:scan -- --context pr --skip dist --skip build-contracts` — all non-Work-Run scans passed; the Work-Run failure was the expected terminalization ordering and is closed by the receipt-only step.
