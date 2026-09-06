---
status: draft
type: INFRA
tags: [harness, governance]
lane: L2
---

# HARNESS-2269: require gate verdict attribution

## Problem

Gate evidence records frequently contain a PASS or FAIL without identifying who or what judged it.
Issue #2269 measured 0 independent attributions across 1578 entries, making self-assessment and
silence indistinguishable in later audits.

## Prior Art Research

Waived: the local issue snapshot supplies the bounded evidence, and the existing gate recorder and
scan patterns are the relevant repository-local prior art.

## Architecture Review

### Affected Scope

- `scripts/harness/gate.mjs`
- `scripts/harness/scan-gate-verdict-attribution.mjs`
- `scripts/harness/__tests__/scan-gate-verdict-attribution.test.mjs`
- `scripts/harness/examined-adoption-baseline.json`

### Alternatives Considered

1. Rewrite all historical entries. Pro: immediate completeness. Con: mutates immutable evidence.
2. Require attribution for new entries and measure a dated historical baseline. Pro: preserves history
   and prevents new debt. Con: legacy debt remains visible until separately migrated.

### Decision

Select the migration baseline. Gate recorders emit a canonical `Judged by` line, while the scan
reports the complete denominator and rejects new evidence that lacks attribution.

### Architecture Review Checklist

- [x] affected harness surfaces identified
- [x] sibling scan and recorder inspected
- [x] alternatives and trade-off documented
- [x] no product or package boundary introduced

## Fallback & Degradation Declaration

None

## Solution

Add a canonical attribution line to generated gate evidence and a hermetic scan that parses every
done spec Evidence Log, reports total/attributed/missing counts, and enforces the post-migration floor.

## Completion Criteria

- [ ] TC-01: generated gate entries contain one canonical `Judged by` line.
- [ ] TC-02: the scan prints a positive denominator and attribution counts and exits zero on the migrated tree.
- [ ] TC-03: fixture mutation of either the recorder or the scan makes its test fail.

## Test Plan

| TC-ID | Test Type | Tool / Approach | Notes |
| --- | --- | --- | --- |
| TC-01 | Unit | Vitest recorder/fixture assertions | canonical attribution |
| TC-02 | Scan | Node entrypoint | full done evidence population |
| TC-03 | Integration | harness scan plus mutation fixtures | fail-closed enforcement |

## User Execution Test Scenarios

Not applicable.
**Reason:** repository governance only; no user-facing command or runtime behavior.

## Tasks

- [ ] `.agents/tasks/HARNESS-2269-gate-verdict-attribution.md` — implement TC-01 through TC-03

## Evidence Log
