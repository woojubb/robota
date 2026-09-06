# agent-session-analytics Specification

## Scope

Owns session-log **timing and usage analysis and reporting** for the Robota SDK. Given persisted
session records or one immutable host snapshot, it computes per-turn timing intervals (LLM wait vs.
tool execution), aggregates cross-session personal usage into complete local-calendar buckets, and
renders text reports. It is a pure analysis/observability concern — distinct from
session lifecycle/persistence (`agent-session`) and from any CLI shell.

## Boundaries

- **Pure functions only — no file I/O, no `process.*`, no CLI/transport concerns.** Callers load
  records and write output.
- Operates on the canonical `IInteractiveSessionRecord` projection (`TSessionAnalysisInput`) and
  canonical `IHistoryEntry` — owns **no** duplicate session-record or history-entry type.
- Depends only on contract/record owners (`@robota-sdk/agent-interface-analytics`,
  `@robota-sdk/agent-interface-transport`) and `@robota-sdk/agent-core` for the history-entry
  contract. No dependency on `agent-session`, `agent-framework`, or any CLI package.
- Persisted timestamps arrive as ISO strings at runtime (JSON has no `Date`); all timestamp math
  routes through `new Date(...)`, so both `string` and `Date` inputs are handled.

## Architecture Overview

```
caller (e.g. agent-cli `session analyze`)
  └── loads IInteractiveSessionRecord[] via agent-framework session stores
        └── agent-session-analytics
              ├── analyzeSession(record) → ISessionTimingReport       (per session)
              ├── aggregateReports(reports) → IAggregateReport        (across sessions)
              ├── formatSingleSession(report) → string                (pure text)
              ├── formatAggregateReport(aggregate) → string           (pure text)
              ├── summarizePersonalUsage(snapshot, request) → IPersonalUsageReport
              └── formatPersonalUsageReport(report) → string
```

## Type Ownership

Types owned by this package (SSOT):

| Type                     | Kind      | File                | Description                                                        |
| ------------------------ | --------- | ------------------- | ------------------------------------------------------------------ |
| `TIntervalKind`          | type      | `types.ts`          | Union of the five timing-interval kinds                            |
| `ITimingInterval`        | interface | `types.ts`          | One classified interval (kind, from/to type+timestamp, durationMs) |
| `ITimingStats`           | interface | `types.ts`          | Aggregated LLM-wait / tool-exec / user→assistant stats             |
| `ISessionTimingReport`   | interface | `types.ts`          | Per-session report: intervals, slow intervals, stats               |
| `IAggregateReport`       | interface | `types.ts`          | Fleet-level summary across sessions                                |
| `IPersonalUsageSnapshot` | interface | `personal-usage.ts` | Immutable valid records plus explicit unreadable-record coverage   |

Reused (not owned): `TSessionAnalysisInput` is `Pick<IInteractiveSessionRecord, 'id' | 'cwd' |
'createdAt' | 'history'>` (agent-interface-transport SSOT); history entries are `IHistoryEntry`
(agent-core SSOT). The trace/cost read-model — `IUsageBySourceReport`, `IUsageSourceTotals`,
`IRunTraceSpan`, `IRunTraceTurn` (SELFHOST-004) — is a **boundary contract owned by
`agent-interface-analytics`** (it crosses the sidecar boundary via a `TServerMessage` carrier);
`summarizeUsageBySource` produces it and this package re-exports the types for co-located consumers.

## Public API Surface

| Export                      | Kind     | Description                                                                                    |
| --------------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `analyzeSession`            | function | Compute the timing report for one session record                                               |
| `aggregateReports`          | function | Aggregate multiple single-session reports                                                      |
| `computeTimingIntervals`    | function | Lower-level: classify a history array into timing intervals                                    |
| `gapMs`                     | function | Millisecond gap between two timestamps                                                         |
| `formatSingleSession`       | function | Render a single-session report as text                                                         |
| `formatAggregateReport`     | function | Render an aggregate report as text                                                             |
| `summarizeUsageBySource`    | function | Per-source token-usage breakdown from `usage-summary` history entries                          |
| `formatUsageReport`         | function | Render the per-session usage breakdown as text                                                 |
| `summarizePersonalUsage`    | function | Produce the versioned cross-session report with deterministic de-duplication and calendar bins |
| `formatPersonalUsageReport` | function | Render the cross-session report as readable terminal text                                      |
| `TSessionAnalysisInput`     | type     | Canonical session-record input projection                                                      |
| `TIntervalKind`             | type     | Timing-interval discriminator                                                                  |
| `ITimingInterval`           | type     | One classified timing interval                                                                 |
| `ITimingStats`              | type     | Aggregated timing statistics                                                                   |
| `ISessionTimingReport`      | type     | One session's timing report                                                                    |
| `IAggregateReport`          | type     | Multi-session timing summary                                                                   |
| `IPersonalUsageSnapshot`    | type     | Immutable valid records plus unreadable-record coverage                                        |
| `IPersonalUsageReport`      | type     | Provider-neutral cross-session usage report                                                    |
| `IPersonalUsageRequest`     | type     | Period/timezone report request                                                                 |
| `TUsageAnalysisInput`       | type     | Per-session usage reducer input                                                                |
| `IUsageSourceTotals`        | type     | Totals for one execution source                                                                |
| `IUsageBySourceReport`      | type     | Per-session usage report                                                                       |
| `IRunTraceSpan`             | type     | Trace span projection                                                                          |
| `IRunTraceTurn`             | type     | Trace spans grouped under one turn                                                             |

## Extension Points

New interval kinds are added to `TIntervalKind` and classified in `computeTimingIntervals`. New
report shapes extend the existing report interfaces; formatters are pure and independently testable.

## Error Taxonomy

This package does not throw on data shape — malformed/empty history yields an empty interval set and
a "no timing data" verdict. I/O and parsing errors are the caller's concern (records arrive already
loaded).

## Test Strategy

- `analyze.test.ts` — interval classification (TC-04a–e), `gapMs` precision (TC-03), `analyzeSession`
  slow-interval + stats integration.
- `report.test.ts` — single-session and aggregate formatting (TC-05), section presence/omission.
- `usage.test.ts` — `summarizeUsageBySource` per-source token aggregation (ANALYTICS-001); `formatUsageReport` output.
- `personal-usage.test.ts` — DST-safe interval boundaries, future exclusion, canonical-over-legacy
  attribution, global observation de-duplication, complete empty buckets, contributor session IDs,
  cost confidence/validation, content-free activity counts, privacy, and coverage diagnostics.

## Dependencies

- `@robota-sdk/agent-interface-analytics` — usage observation and report contracts.
- `@robota-sdk/agent-interface-transport` — `IInteractiveSessionRecord` (input projection SSOT).
- `@robota-sdk/agent-core` — `IHistoryEntry` (history-entry SSOT).

## Consumption Posture (INFRA-025)

`agent-framework` no longer carries this package as a runtime dependency: the scripted
session harness exposes a neutral `sessionLog()` accessor and tests compose
`summarizeUsageBySource` themselves. Runtime consumers today: `agent-cli`
(`session-analyze-command`). This package stays a leaf analysis library — it must not be
re-absorbed into assembly-layer runtime dependencies for convenience helpers.
