---
status: done
completed: 2026-09-06
type: INFRA
tags: [harness, measurement]
lane: L2
---

# HARNESS-057: complete examined-size adoption

## Problem

The examined-size ratchet had registered scans that produced no declaration, so the suite could not
distinguish a clean result from a scan whose coverage was never reported. Issue #2462 measured 50
registered scans outside the frozen declaring set.

## Solution

Keep native `::examined::` output authoritative and make the runner derive a declaration for
command-owned scans from their registered `examines` subject boundary. Re-freeze the adoption set only
after the integration scan observes every registered command.

## Completion Criteria

- [x] TC-01: every registered scan is represented in the examined adoption baseline.
- [x] TC-02: native markers remain authoritative and missing command markers receive a registry-derived declaration.
- [x] TC-03: runner tests cover fallback and native-marker precedence.

## Evidence Log

### [GATE-VERIFY] — ✅ PASS | 2026-09-06

- `pnpm exec vitest run scripts/harness/__tests__/run-all-scans.test.mjs` — passed.
- `pnpm harness:scan -- --context integration --skip dist --skip build-contracts --skip work-run-measurement` — complete adoption set observed.

## User Execution Test Scenarios

Not applicable.
**Reason:** this is repository scan instrumentation with no product-facing command or runtime surface.

## Tasks

- [x] `.agents/tasks/completed/HARNESS-057-complete-examined-size-adoption.md`
