# @robota-sdk/agent-session-analytics

Timing and usage analysis over persisted agent session records.

Given session records, it computes per-turn timing intervals (LLM wait vs. tool execution), attributes
token usage and cost to the source that spent it (main thread, subagents, background tasks, tools,
commands, skills), aggregates cross-session personal usage into
complete local-calendar days, projects usage into OpenTelemetry (OTLP) payloads, and renders text
reports. Everything is a pure function: no file I/O, no `process.*`, no network. Callers load the
records and write or send the output; a host CLI's `usage` command is one such caller.

## Installation

```bash
npm install @robota-sdk/agent-session-analytics
```

## Usage

```typescript
import {
  analyzeSession,
  formatSingleSession,
  formatUsageReport,
  summarizeUsageBySource,
} from '@robota-sdk/agent-session-analytics';
import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

declare const record: IInteractiveSessionRecord; // loaded by the caller

process.stdout.write(formatSingleSession(analyzeSession(record)) + '\n');
process.stdout.write(formatUsageReport(summarizeUsageBySource(record)) + '\n');
```

## API

### Timing

| Export                      | Description                                          |
| --------------------------- | ---------------------------------------------------- |
| `analyzeSession(record)`    | Compute the timing report for one session record     |
| `aggregateReports(reports)` | Aggregate multiple single-session reports            |
| `computeTimingIntervals(h)` | Classify a history array into timing intervals       |
| `gapMs(from, to)`           | Millisecond gap between two timestamps (string/Date) |
| `formatSingleSession(r)`    | Render a single-session report as text               |
| `formatAggregateReport(a)`  | Render an aggregate report as text                   |

### Usage and cost

| Export                              | Description                                                                         |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| `summarizeUsageBySource(record)`    | Token and cost totals per source, the top consumer, and the per-turn span timeline  |
| `formatUsageReport(report)`         | Render the per-source usage report as text                                          |
| `summarizePersonalUsage(snapshot)`  | Build a deterministic 7- or 30-day personal-usage report from an immutable snapshot |
| `formatPersonalUsageReport(report)` | Render the personal-usage report as text                                            |

### OTLP export

These build OTLP/JSON payloads from session records; sending them to a collector is the caller's job
(a host CLI's `usage export` command does it). The payloads are content-free: no prompt or reply text, no session
identity.

| Export                                                 | Description                                                                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `createOtlpUsageSnapshot(records, at, version)`        | Usage metrics as Gauges, so re-exporting a snapshot never counts the same usage twice                         |
| `createOtlpPromptRootTraces(records, version)`         | Prompt-root trace spans, only for roots whose identity validates; returns coverage counts for what it skipped |
| `createOtlpPromptEvents(records, version, observedAt)` | One outcome-only completion log event per accepted span                                                       |

Unknown cost or token splits stay visible as unknown rather than being reported as zero.

The record and history types are the canonical `IInteractiveSessionRecord` and `IHistoryEntry`; this
package defines no duplicates. The usage and trace report types (`IUsageBySourceReport`,
`IUsageSourceTotals`, `IRunTraceSpan`, `IRunTraceTurn`) are owned by
`@robota-sdk/agent-interface-analytics` and re-exported here for convenience.

See [docs/SPEC.md](./docs/SPEC.md) for the full contract.
