# agent-telemetry-otel Docs

`@robota-sdk/agent-telemetry-otel` turns Robota's provider calls and tool bodies into OpenTelemetry
spans, with either Robota's `agent.*` names or the OpenTelemetry GenAI semantic conventions: recorded
on the host's tracer for a run, or projected as data from a live prompt trace batch. The same batch also
projects onto the GenAI metrics as plain samples.

```typescript
import {
  createOtelTracing,
  createStructuralIdGenerator,
  projectLivePromptMetricSamples,
  projectLivePromptTrace,
} from '@robota-sdk/agent-telemetry-otel';
```

## Documents

- [Package README](../README.md) — tracing a run, projecting a batch, modes and metrics.
- [SPEC.md](./SPEC.md) — package contract, invariants and design decisions.
