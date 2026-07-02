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

- `@robota-sdk/agent-core` — plugin interface, core types

## Links

- [npm](https://www.npmjs.com/package/@robota-sdk/agent-plugin)
- [GitHub](https://github.com/woojubb/robota)
