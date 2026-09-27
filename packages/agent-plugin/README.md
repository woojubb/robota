# @robota-sdk/agent-plugin

Ready-made plugins for the Robota SDK: conversation history, error handling, execution analytics,
limits, logging, performance metrics, usage tracking and webhooks. Each plugin extends
`AbstractPlugin` from `@robota-sdk/agent-core` and receives the agent's lifecycle hooks (before and
after a run, on error, and so on).

Plugins are opt-in: neither the SDK nor the Robota CLI adds them by default. You pass plugin
instances to `Robota` in `plugins`.

## Installation

```bash
npm install @robota-sdk/agent-plugin @robota-sdk/agent-core
```

Requires Node.js 22.12 or later.

## Available Plugins

| Plugin                      | Purpose                                                    |
| --------------------------- | ---------------------------------------------------------- |
| `ConversationHistoryPlugin` | Persistent conversation history (Memory / File / Database) |
| `ErrorHandlingPlugin`       | Error recovery and retry strategies                        |
| `ExecutionAnalyticsPlugin`  | Execution metrics and analytics aggregation                |
| `LimitsPlugin`              | Rate limiting and quota enforcement                        |
| `LoggingPlugin`             | Multi-backend logging (Console / File / Remote / Silent)   |
| `PerformancePlugin`         | System performance metrics collection                      |
| `UsagePlugin`               | Token usage and cost tracking (Memory / File / Remote)     |
| `WebhookPlugin`             | HTTP webhook notifications with HMAC signing               |

## Quick Start

```typescript
import { Robota } from '@robota-sdk/agent-core';
import { ConversationHistoryPlugin, LoggingPlugin, UsagePlugin } from '@robota-sdk/agent-plugin';
import type { IAgentConfig } from '@robota-sdk/agent-core';

declare const base: IAgentConfig; // name, aiProviders, defaultModel, …
const agent = new Robota({
  ...base,
  plugins: [
    new ConversationHistoryPlugin({ storage: 'memory' }),
    new LoggingPlugin({ strategy: 'console', level: 'info' }),
    new UsagePlugin({ strategy: 'memory' }),
  ],
});
```

## Plugin Reference

### ConversationHistoryPlugin

Persists conversation history across sessions.

```typescript
import { ConversationHistoryPlugin } from '@robota-sdk/agent-plugin';

// storage: 'memory' | 'file' | 'database'
new ConversationHistoryPlugin({ storage: 'memory' });
```

The `database` strategy needs a `databaseDriver` you supply; this package ships no database driver.

### LoggingPlugin

Logs agent activity to one or more backends.

```typescript
import { LoggingPlugin } from '@robota-sdk/agent-plugin';

// strategy: 'console' | 'file' | 'remote' | 'silent'
new LoggingPlugin({ strategy: 'console', level: 'info' });
```

### UsagePlugin

Tracks token usage and estimates cost.

```typescript
import { UsagePlugin } from '@robota-sdk/agent-plugin';

// strategy: 'memory' | 'file' | 'remote' | 'silent'
new UsagePlugin({ strategy: 'memory' });
```

### LimitsPlugin

Enforces rate limits and usage quotas.

```typescript
import { LimitsPlugin } from '@robota-sdk/agent-plugin';

// strategy: 'token-bucket' | 'sliding-window' | 'fixed-window' | 'none'
new LimitsPlugin({ strategy: 'token-bucket', maxTokens: 100000, maxRequests: 60 });
```

### WebhookPlugin

Fires HTTP webhooks on agent lifecycle events with optional HMAC signing.

```typescript
import { WebhookPlugin } from '@robota-sdk/agent-plugin';

new WebhookPlugin({ endpoints: [{ url: 'https://example.com/hook' }] });
```

## Dependencies

- `@robota-sdk/agent-core` — `AbstractPlugin` and the core types
- `jssha` — HMAC signing for `WebhookPlugin`

## Documentation

- [docs/SPEC.md](./docs/SPEC.md) — package contract and the plugin list
- [Plugins guide](../../content/guide/plugins.md)

## License

Robota is dual-licensed under the [GNU AGPL-3.0](../../LICENSE) or a [commercial license](../../COMMERCIAL.md). See [LICENSING.md](../../LICENSING.md).
