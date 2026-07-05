# agent-session-analytics Specification

## Scope

Owns session-log **timing analysis and reporting** for the Robota SDK. Given persisted session
records, it computes per-turn timing intervals (LLM wait vs. tool execution), aggregates across
sessions, and renders text reports. It is a pure analysis/observability concern — distinct from
session lifecycle/persistence (`agent-session`) and from any CLI shell.

## Boundaries

- **Pure functions only — no file I/O, no `process.*`, no CLI/transport concerns.** Callers load
  records and write output.
- Operates on the canonical `IInteractiveSessionRecord` projection (`TSessionAnalysisInput`) and
  canonical `IHistoryEntry` — owns **no** duplicate session-record or history-entry type.
- Depends only on `@robota-sdk/agent-interface-transport` (record contract) and
  `@robota-sdk/agent-core` (history-entry contract). No dependency on `agent-session`,
  `agent-framework`, or any CLI package.
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
              └── formatAggregateReport(aggregate) → string           (pure text)
```

## Type Ownership

Types owned by this package (SSOT):

| Type                   | Kind      | File       | Description                                                        |
| ---------------------- | --------- | ---------- | ------------------------------------------------------------------ |
| `TIntervalKind`        | type      | `types.ts` | Union of the five timing-interval kinds                            |
| `ITimingInterval`      | interface | `types.ts` | One classified interval (kind, from/to type+timestamp, durationMs) |
| `ITimingStats`         | interface | `types.ts` | Aggregated LLM-wait / tool-exec / user→assistant stats             |
| `ISessionTimingReport` | interface | `types.ts` | Per-session report: intervals, slow intervals, stats               |
| `IAggregateReport`     | interface | `types.ts` | Fleet-level summary across sessions                                |

Reused (not owned): `TSessionAnalysisInput` is `Pick<IInteractiveSessionRecord, 'id' | 'cwd' |
'createdAt' | 'history'>` (agent-interface-transport SSOT); history entries are `IHistoryEntry`
(agent-core SSOT).

## Public API Surface

| Export                          | Kind     | Description                                                                                    |
| ------------------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `analyzeSession(record)`        | function | Compute the timing report for one session record                                               |
| `aggregateReports(reports)`     | function | Aggregate multiple single-session reports                                                      |
| `computeTimingIntervals(hist)`  | function | Lower-level: classify a history array into timing intervals                                    |
| `gapMs(from, to)`               | function | Millisecond gap between two timestamps (string or Date)                                        |
| `formatSingleSession(report)`   | function | Render a single-session report as text (returns string)                                        |
| `formatAggregateReport(agg)`    | function | Render an aggregate report as text (returns string)                                            |
| `summarizeUsageBySource(input)` | function | ANALYTICS-001: per-source token-usage breakdown from `usage-summary` history entries           |
| `formatUsageReport(report)`     | function | Render the usage breakdown as text (returns string)                                            |
| `TSessionAnalysisInput` + types | types    | See Type Ownership (incl. `TUsageAnalysisInput`, `IUsageBySourceReport`, `IUsageSourceTotals`) |

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

## Dependencies

- `@robota-sdk/agent-interface-transport` — `IInteractiveSessionRecord` (input projection SSOT).
- `@robota-sdk/agent-core` — `IHistoryEntry` (history-entry SSOT).

## Consumption Posture (INFRA-025)

`agent-framework` no longer carries this package as a runtime dependency: the scripted
session harness exposes a neutral `sessionLog()` accessor and tests compose
`summarizeUsageBySource` themselves. Runtime consumers today: `agent-cli`
(`session-analyze-command`). This package stays a leaf analysis library — it must not be
re-absorbed into assembly-layer runtime dependencies for convenience helpers.
