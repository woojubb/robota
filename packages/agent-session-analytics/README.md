# @robota-sdk/agent-session-analytics

Session-log timing and personal-usage analysis for the Robota SDK.

Given persisted session records, it computes per-turn timing intervals (LLM wait vs. tool
execution), aggregates cross-session usage into complete local-calendar buckets, and renders text
reports. Pure functions — no file I/O, no `process.*`, no CLI concerns; callers load records and
write output.

## API

| Export                      | Description                                          |
| --------------------------- | ---------------------------------------------------- |
| `analyzeSession(record)`    | Compute the timing report for one session record     |
| `aggregateReports(reports)` | Aggregate multiple single-session reports            |
| `computeTimingIntervals(h)` | Classify a history array into timing intervals       |
| `gapMs(from, to)`           | Millisecond gap between two timestamps (string/Date) |
| `formatSingleSession(r)`    | Render a single-session report as text               |
| `formatAggregateReport(a)`  | Render an aggregate report as text                   |
| `summarizePersonalUsage(s, request)` | Build a deterministic 7- or 30-day personal-usage report from an immutable snapshot |
| `formatPersonalUsageReport(report)` | Render the personal-usage report as readable text |

Operates on the canonical `IInteractiveSessionRecord` projection and `IHistoryEntry` — owns no
duplicate record/history types.

See [docs/SPEC.md](./docs/SPEC.md) for the full contract.
