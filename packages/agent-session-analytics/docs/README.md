# agent-session-analytics — Documentation

`@robota-sdk/agent-session-analytics` computes timing analysis and renders reports from persisted
Robota session records. Pure functions — no file I/O, no CLI concerns.

```typescript
import {
  analyzeSession,
  aggregateReports,
  formatSingleSession,
  formatAggregateReport,
} from '@robota-sdk/agent-session-analytics';

const report = analyzeSession(record); // record: IInteractiveSessionRecord-shaped
process.stdout.write(formatSingleSession(report));
```

## Documents

- [SPEC.md](./SPEC.md) — package contract, type ownership, public API, and boundaries.
