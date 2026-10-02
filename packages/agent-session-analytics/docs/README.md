# agent-session-analytics — Documentation

`@robota-sdk/agent-session-analytics` analyzes persisted agent session records: per-turn timing (LLM
wait vs. tool execution), token usage and cost per source, cross-session personal usage, and
content-free OTLP projections of that usage. It renders text reports and builds OTLP payloads, but
performs no file I/O and no network delivery — callers load records and send or print the output.

```typescript
import {
  aggregateReports,
  analyzeSession,
  formatAggregateReport,
  formatSingleSession,
} from '@robota-sdk/agent-session-analytics';

// records: IInteractiveSessionRecord[] the caller has loaded
const reports = records.map((record) => analyzeSession(record));
for (const report of reports) process.stdout.write(formatSingleSession(report) + '\n');
process.stdout.write(formatAggregateReport(aggregateReports(reports)) + '\n');
```

The [package README](../README.md) lists the full API, including the usage-by-source and OTLP export
functions.

## Documents

- [SPEC.md](./SPEC.md) — package contract, type ownership, OTLP export guarantees, and boundaries.
