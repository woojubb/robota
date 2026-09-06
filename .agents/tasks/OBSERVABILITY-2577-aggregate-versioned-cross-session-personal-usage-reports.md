---
title: 'OBSERVABILITY-2577: Aggregate versioned cross-session personal usage reports'
issue: https://github.com/woojubb/robota/issues/2577
status: todo
created: 2026-09-06
priority: high
urgency: soon
area: agent-interface-analytics, agent-session-analytics, agent-session, agent-cli
depends_on: [DATA-2577]
---

# OBSERVABILITY-2577: Aggregate versioned cross-session personal usage reports

## Objective

Define one provider-neutral, pure cross-session report for local personal usage. It must merge canonical
session inputs deterministically, produce complete 7/30-day calendar buckets and named breakdowns, retain
cost confidence and missing-data coverage, and identify contributing sessions for existing trace
drill-down without exposing stored content. `turns` comes only from persisted started-turn observations,
not from usage-bearing messages or inferred provider requests.

## Existing Evidence

- `summarizeUsageBySource` is a pure single-session reducer and assumes its usage entries are already
  canonical.
- Existing CLI loading can see both user and project stores and currently gives the project record
  precedence for duplicate session IDs.
- Store enumeration distinguishes valid, missing, corrupt, and unsupported records, but the current
  analyzer skips invalid entries rather than reporting coverage.
- Tool-start history and `skillActivationEvents` are separate canonical sources; activation history
  mirrors must not be counted twice.

## Plan

- [ ] Define the report request/result contracts, metric-scope vocabulary, period bounds, timezone,
      cost confidence, breakdowns, drill-down IDs, and structured coverage diagnostics.
- [ ] Accept one immutable, already-enumerated user/project-store snapshot; keep store discovery and I/O
      in host adapters, then apply one deterministic merge and canonical normalization stage.
- [ ] Aggregate sessions, top-level turns, tokens, cost, model, surface, execution source, canonical
      tool-starts, and started skill/plugin activations into complete daily buckets.
- [ ] Represent legacy/missing attribution as `unknown`, current-day buckets as partial, and corrupt or
      unsupported records as visible partial coverage.
- [ ] Add fixture-based tests for empty periods, inclusive-start/exclusive-end bounds, IANA zones, DST,
      dedupe, mixed confidence, and privacy-safe output.

## Constraints

- Default period is 7 local calendar days including the current partial day; 30 days and explicit IANA
  timezone use the same inclusive-start/exclusive-end semantics.
- Store-level duplicate session IDs retain the existing project-over-user precedence.
- The reducer is a functional core with no filesystem, network, process, or transport I/O.
- `turns` counts only canonical started top-level turn observations, including no-usage, failed, and
  `interrupted` outcomes; never-run submissions, provider invocations, and nested rounds are separate
  scopes.
- Corrupt/unsupported records may yield a successful partial report only when trustworthy valid input
  remains; enumeration failure or no trustworthy report is an explicit error.
- Tool activity counts canonical `tool-start`; skill/plugin activity counts only activation events with
  `status: started` and the existing source discriminator.
- The report contains no prompt/response text, file path, tool argument/result, or activation error.

## Test Plan

- Unit/property tests for bucket boundaries, zero buckets, timezone/DST, grouped totals, and cost-status
  roll-up.
- Fixture tests for user/project precedence, duplicate logical usage IDs, legacy unknowns, corrupt and
  unsupported records, and one-source-only activity counting.
- Contract tests proving drill-down IDs resolve to the existing per-session usage/trace report.
- Privacy assertions over the complete serialized report fixture.
- Affected package builds and governing `docs/SPEC.md` conformance checks.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This Task owns a shared analytics contract and reducer, not a directly runnable product
surface; FLOW-2577 and SCREEN-2577 consume it and provide the executable CLI and GUI scenarios.
