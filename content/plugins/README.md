---
title: Plugin Directory
description: Official and community plugins for Robota SDK — extend your agent with logging, monitoring, notifications, and more.
---

# Plugin Directory

Plugins extend the Robota agent lifecycle without modifying core packages. Every plugin in this directory implements the `IPlugin` interface from `@robota-sdk/agent-core`.

**→ [Build your own plugin](/guide/plugins)**

---

## Official Plugins

These plugins are maintained by the Robota team. The eight cross-cutting lifecycle plugins ship
consolidated in `@robota-sdk/agent-plugin`; the pub/sub `EventEmitterPlugin` is part of the core
runtime in `@robota-sdk/agent-core`. All are registered via the `Robota` constructor `plugins` array.

| Plugin                      | Import                     | Description                                                                                                  |
| --------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `LoggingPlugin`             | `@robota-sdk/agent-plugin` | Structured logging of agent activity                                                                         |
| `UsagePlugin`               | `@robota-sdk/agent-plugin` | Token usage accounting                                                                                       |
| `LimitsPlugin`              | `@robota-sdk/agent-plugin` | Token / turn / cost limits                                                                                   |
| `ErrorHandlingPlugin`       | `@robota-sdk/agent-plugin` | Typed error classification with retry / recovery stats                                                       |
| `ExecutionAnalyticsPlugin`  | `@robota-sdk/agent-plugin` | Per-execution analytics                                                                                      |
| `PerformancePlugin`         | `@robota-sdk/agent-plugin` | Timing and performance metrics                                                                               |
| `WebhookPlugin`             | `@robota-sdk/agent-plugin` | Emit lifecycle events to a webhook                                                                           |
| `ConversationHistoryPlugin` | `@robota-sdk/agent-plugin` | Persist / restore conversation history                                                                       |
| `EventEmitterPlugin`        | `@robota-sdk/agent-core`   | Pub/sub event subscriptions — listen to `EXECUTION_START`, `TOOL_BEFORE_EXECUTE`, `ERROR_OCCURRED`, and more |

```typescript
import { Robota, type IAIProvider } from '@robota-sdk/agent-core';
import { LoggingPlugin, UsagePlugin, LimitsPlugin } from '@robota-sdk/agent-plugin';

declare const provider: IAIProvider;

const agent = new Robota({
  name: 'my-agent',
  aiProviders: [provider],
  defaultModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  plugins: [
    new LoggingPlugin({ strategy: 'console' }),
    new UsagePlugin({ strategy: 'memory' }),
    new LimitsPlugin({ strategy: 'token-bucket', maxTokens: 100_000 }),
  ],
});
```

---

## Community Plugins

> Community plugins are third-party packages. Review their source and trust level before use.

_No community plugins listed yet. [Submit yours](#submitting-a-plugin)._

---

## Submitting a Plugin

To list your plugin here:

1. Publish it to npm following the naming convention: `@your-scope/robota-plugin-<name>`
2. Open a PR to `content/plugins/README.md` with a one-line entry in the table above
3. The entry should include: package name, npm link, and a one-sentence description

**Naming convention:**

```
@your-scope/robota-plugin-<name>
# Examples:
@acme/robota-plugin-slack
@acme/robota-plugin-datadog
@acme/robota-plugin-linear
```

**Requirements for listing:**

- Published to npm
- TypeScript types included
- Peer dependency on `@robota-sdk/agent-core` (not a direct dependency)
- README with install instructions and usage example

---

## Related

- [Building Plugins — guide](/guide/plugins)
- [Agent core abstractions](/packages/agent-core/)
