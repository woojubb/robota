# Agent Plugin

Consolidated plugin package providing 8 official plugin implementations for the Robota SDK.

## Installation

```bash
npm install @robota-sdk/agent-plugin
```

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

const agent = new Robota({
  // ...provider config...
  plugins: [
    new ConversationHistoryPlugin({ storage: 'memory' }),
    new LoggingPlugin({ backend: 'console', level: 'info' }),
    new UsagePlugin({ storage: 'memory' }),
  ],
});
```

## Plugin Reference

### ConversationHistoryPlugin

Persists conversation history across sessions.

```typescript
new ConversationHistoryPlugin({ storage: 'memory' | 'file' | 'database' });
```

### LoggingPlugin

Logs agent activity to one or more backends.

```typescript
new LoggingPlugin({
  backend: 'console' | 'file' | 'remote' | 'silent',
  level: 'info' | 'debug' | 'warn' | 'error',
});
```

### UsagePlugin

Tracks token usage and estimates cost.

```typescript
new UsagePlugin({ storage: 'memory' | 'file' | 'remote' | 'silent' });
```

### LimitsPlugin

Enforces rate limits and usage quotas.

```typescript
new LimitsPlugin({ maxTokensPerMinute: 100000, maxRequestsPerMinute: 60 });
```

### WebhookPlugin

Fires HTTP webhooks on agent lifecycle events with optional HMAC signing.

```typescript
new WebhookPlugin({ url: 'https://example.com/hook', secret: 'my-secret' });
```

## Dependencies

- `@robota-sdk/agent-core` — plugin interface, core types

## Links

- [npm](https://www.npmjs.com/package/@robota-sdk/agent-plugin)
- [GitHub](https://github.com/woojubb/robota)
