# @robota-sdk/agent-interface-analytics — documents

Usage and run-trace contracts for the Robota SDK. Type declarations only — no classes, no runtime
logic. This package declares the shape of a measurement; it measures nothing.

## Usage

```typescript
import type {
  IUsageSnapshot,
  IUsageSource,
  IUsageBySourceReport,
  IRunTraceTurn,
} from '@robota-sdk/agent-interface-analytics';
// Contract declarations only. Reports are assembled by `agent-session-analytics` and carried across
// the sidecar boundary by `agent-transport-protocol`.
```

## Documents

- [SPEC.md](./SPEC.md) — package contract, type ownership, boundaries, and why this package has an
  empty dependency set.
