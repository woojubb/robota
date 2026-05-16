# @robota-sdk/agent-plugin — Package Specification

## Overview

Consolidated plugin package providing 8 official plugin implementations for the Robota SDK.
All plugins implement the `IPlugin` interface from `@robota-sdk/agent-core`.

## Layer Position

```
agent-plugin → agent-core (only)
```

`agent-plugin` depends exclusively on `agent-core`. It must never depend on
`agent-framework`, `agent-session`, `agent-tools`, or `agent-provider`.

## Available Plugins

| Export Class                | Purpose                                                                         |
| --------------------------- | ------------------------------------------------------------------------------- |
| `ConversationHistoryPlugin` | Persistent conversation history with pluggable storage (Memory, File, Database) |
| `ErrorHandlingPlugin`       | Error recovery and retry strategies                                             |
| `ExecutionAnalyticsPlugin`  | Execution metrics and analytics aggregation                                     |
| `LimitsPlugin`              | Rate limiting and quota enforcement                                             |
| `LoggingPlugin`             | Multi-backend logging (Console, File, Remote, Silent)                           |
| `PerformancePlugin`         | System performance metrics collection                                           |
| `UsagePlugin`               | Token usage and cost tracking (Memory, File, Remote, Silent)                    |
| `WebhookPlugin`             | HTTP webhook notifications with HMAC signing                                    |

## Export Surface

All plugins are exported from the root entry point:

```ts
import {
  ConversationHistoryPlugin,
  LoggingPlugin,
  UsagePlugin,
  LimitsPlugin,
  ErrorHandlingPlugin,
  ExecutionAnalyticsPlugin,
  PerformancePlugin,
  WebhookPlugin,
} from '@robota-sdk/agent-plugin';
```

## Source Structure

```
src/
├── index.ts                     # Root re-export of all plugins
├── conversation-history/        # ConversationHistoryPlugin + 3 storage backends
├── error-handling/              # ErrorHandlingPlugin
├── execution-analytics/         # ExecutionAnalyticsPlugin
├── limits/                      # LimitsPlugin
├── logging/                     # LoggingPlugin + 4 storage backends + formatters
├── performance/                 # PerformancePlugin + system metrics collector
├── usage/                       # UsagePlugin + 4 storage backends
└── webhook/                     # WebhookPlugin + HTTP client + queue
```

## Dependency Rules

### Allowed

- `@robota-sdk/agent-core` — plugin interface and base class
- `jssha` — HMAC signing for webhook (used only within `webhook/`)

### Forbidden

- `@robota-sdk/agent-framework` — orchestration layer, must not be imported
- `@robota-sdk/agent-session` — session layer, must not be imported
- `@robota-sdk/agent-tools` — tool infrastructure, must not be imported
- Cross-submodule imports — `logging/` must not import from `usage/`

## Circular Dependency Prevention

Plugin sub-modules must not import from each other. Shared utilities (if any) live
in a `shared/` directory within `src/`. Dependency direction:

```
agent-core ← agent-plugin submodule (each independently)
```

Detection:

- `pnpm madge --circular --ts-config tsconfig.json src/`
- `grep -r "agent-plugin" packages/agent-core/src/` — must return empty

## Custom Plugin Extension

Users extend the system via `agent-core` interfaces, not by modifying this package:

```ts
import type { IPlugin } from '@robota-sdk/agent-core';

const myPlugin: IPlugin = {
  name: 'my-plugin',
  hooks: {
    beforeExecution: async (input) => {
      /* ... */
    },
  },
};
robota.use(myPlugin);
```

## Build

- Bundler: tsdown (ESM + CJS dual output)
- Output: `dist/node/index.{js,cjs,d.ts}`
- Tree-shaking: enabled — unused plugins are excluded from consumer bundles
