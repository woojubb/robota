---
title: 'INFRA-144: progress percentages are not enforced before message emission'
issue: https://github.com/woojubb/robota/issues/2511
status: todo
created: 2026-08-29
priority: medium
urgency: soon
area: agent message emission and harness progress quantification
depends_on: []
---

# INFRA-144: progress percentages are not enforced before message emission

## Objective

Ensure a countable progress ratio carries its percentage before an assistant message is emitted into
append-only transcript history. Post-hoc scanning and the reasoned acknowledgment ledger remain audit
evidence, but unrelated branches must not be the first place an already-immutable conduct defect is
discovered and cleared.

This Task is registered by [issue #2511](https://github.com/woojubb/robota/issues/2511). It owns one
cause: quantified-progress enforcement runs after emission, when the original message can no longer
be corrected.

## Existing Evidence

- `node scripts/harness/scan-progress-report-quantification.mjs` found two genuine messages at
  `2026-08-27T16:51:00.832Z` and `2026-08-28T00:15:56.907Z` that reported `147/148` without the
  required percentage.
- The checked-in ledger already records 19 real violations visible on this host, yet the same output
  defect continued because the ledger is necessarily post-hoc.
- The scan is advisory in PR context and blocking in integration context; a host-specific immutable
  message therefore creates unrelated integration work until its acknowledgment lands.
- A depth guardian classified the repeated late-enforcement shape as FOUNDATIONAL.

## Scope Boundary

- Own the assistant response formatting or pre-emission validation boundary available to this repo.
- Reuse the quantified-progress policy and tested recognition vocabulary rather than inventing a
  divergent percentage rule.
- Preserve the transcript scan and anti-rot acknowledgment ledger as independent audit mechanisms.
- Do not rewrite transcript history, suppress real violations, or globally move the enforcement date.

## Plan

- [ ] Establish which response-emission boundary can observe assistant narrative before persistence.
- [ ] Add a failing fixture for a partial ratio without a percentage and a passing fixture for the
      same ratio with its computed percentage.
- [ ] Implement the smallest pre-emission formatter or refusal that covers countable progress reports.
- [ ] Prove code spans, dates, versions, completed ratios, and the existing false-positive classes do
      not acquire misleading percentages.
- [ ] Remove `Contained — INFRA-144.` acknowledgments only when anti-rot permits and the root lands.

## Completion Criteria

- A mid-work assistant message containing `3/7 done` cannot be emitted unchanged; its observable
  output includes the percentage or the emission is refused with a specific diagnostic.
- A correct `3/7 done = 43%` message passes unchanged.
- Existing non-progress ratio suppressions retain their deliberate verdicts.
- The transcript scan and acknowledgment anti-rot suite remain green and independent.
- A newly emitted violating message cannot make an unrelated integration scan responsible for first
  discovering the defect.

## Test Plan

- Add red/green fixtures at the selected pre-emission boundary.
- Run `pnpm exec vitest run scripts/harness/__tests__/scan-progress-report-quantification.test.mjs`.
- Run `node scripts/harness/scan-progress-report-quantification.mjs` against a synthetic transcript
  and the current host transcript.
- Run `pnpm harness:test:contracts` and CI-equivalent verification before completing the Task.

## User Execution Test Scenarios

Not applicable. This Task changes internal agent-conduct enforcement and exposes no CLI, TUI,
browser, or public SDK behavior. Its observable proof belongs to emission fixtures and harness scans.
