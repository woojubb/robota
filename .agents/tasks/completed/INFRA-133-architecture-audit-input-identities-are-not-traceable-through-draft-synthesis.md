---
title: 'INFRA-133: architecture audit input identities are not traceable through draft synthesis'
issue: https://github.com/woojubb/robota/issues/2149
status: skipped
completed: 2026-08-29
returned_to_issue: https://github.com/woojubb/robota/issues/2149#issuecomment-5456693151
created: 2026-08-22
priority: medium
urgency: now
area: harness architecture audit evidence model
depends_on: []
---

# INFRA-133: architecture audit input identities are not traceable through draft synthesis

## Objective

Make every raw finding from the four dimensional architecture reports and the separate conformance
report identity-bearing before draft synthesis, so the runtime floor can prove that no candidate was
silently lost while findings were merged, rejected, promoted, or severity-normalized.

The defect was independently reproduced during INFRA-131's mandatory local review: a complete nested
fanout reporting seven high findings plus a conformance report with five actionable findings could be
paired with a zero-material, zero-rejected draft synthesis and still pass the current signal scan. The
current aggregate terminal signals cannot distinguish legitimate deduplication from silent loss, so a
count-only special case at the scanner would patch the symptom rather than establish provenance.

## Plan

- [ ] Specify stable source-finding identity, severity, channel, and provenance records for dimensional
      and conformance inputs.
- [ ] Extend the canonical architecture ledger/recorder so every source identity is recorded before
      synthesis and every identity has exactly one draft disposition.
- [ ] Validate survivors, merge targets, rejections, severity normalization, and promoted
      cross-dimension findings against the recorded draft identities and aggregate terminal counts.
- [ ] Add red/green fixtures for total loss, partial loss, duplicate merges, rejection, severity changes,
      and promoted findings; run the focused and full harness gates.

## Test Plan

- Extend `scan-architecture-refresh-signals.test.mjs` with identity-preserving transformation fixtures
  that fail on any missing, duplicate, orphaned, or count-inconsistent source/draft record.
- Extend recorder and loop-run tests for the new persisted fields and command ownership.
- Run focused Vitest coverage, `pnpm harness:scan`, and `pnpm harness:verify-like-ci`.

## User Execution Test Scenarios

Not applicable: this is an internal governance proof-model change with no runnable user-facing behavior.
