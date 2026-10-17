# agent-telemetry-otel Docs

`@robota-sdk/agent-telemetry-otel` projects one live prompt trace batch onto OpenTelemetry span
shapes, with either Robota's `agent.*` names or the OpenTelemetry GenAI semantic conventions.

```typescript
import { projectLivePromptTrace } from '@robota-sdk/agent-telemetry-otel';
```

## Documents

- [Package README](../README.md) — usage and modes.
- [SPEC.md](./SPEC.md) — package contract, invariants and design decisions.
