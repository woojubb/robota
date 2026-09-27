# agent-plugin Docs

`@robota-sdk/agent-plugin` owns the ready-made plugins of the Robota SDK: `ConversationHistoryPlugin`,
`ErrorHandlingPlugin`, `ExecutionAnalyticsPlugin`, `LimitsPlugin`, `LoggingPlugin`,
`PerformancePlugin`, `UsagePlugin` and `WebhookPlugin`. Each extends `AbstractPlugin` from
`@robota-sdk/agent-core`; the plugin host and lifecycle belong to `agent-core`.

```typescript
import { ConversationHistoryPlugin, UsagePlugin } from '@robota-sdk/agent-plugin';
```

## Documents

- [Package README](../README.md) — usage and per-plugin options.
- [SPEC.md](./SPEC.md) — package contract, available plugins and ownership boundaries.
