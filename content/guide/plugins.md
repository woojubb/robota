---
title: Building Plugins
description: Extend Robota with custom plugins — logging, monitoring, cost tracking, notifications, and more.
---

# Building Plugins

Robota's plugin system lets you hook into the agent execution lifecycle without modifying core packages. Plugins are the right tool for cross-cutting concerns: logging, metrics, cost tracking, notifications, and audit trails.

---

## Plugin Types

There are two ways to extend Robota:

| Approach                         | When to use                                                       |
| -------------------------------- | ----------------------------------------------------------------- |
| **AbstractPlugin**               | Full lifecycle access — before/after each run, tool calls, errors |
| **EventEmitterPlugin listeners** | Subscribe to named events without subclassing                     |

---

## Quick Start — AbstractPlugin

```typescript
import { AbstractPlugin, PluginCategory, PluginPriority } from '@robota-sdk/agent-core';
import type {
  IPluginExecutionContext,
  IPluginExecutionResult,
  IPluginErrorContext,
  IPluginOptions,
  IPluginStats,
} from '@robota-sdk/agent-core';

interface IMyPluginOptions extends IPluginOptions {
  logLevel?: 'info' | 'debug';
}

interface IMyPluginStats extends IPluginStats {
  requestCount: number;
}

export class MyPlugin extends AbstractPlugin<IMyPluginOptions, IMyPluginStats> {
  name = 'MyPlugin';
  version = '1.0.0';
  category = PluginCategory.MONITORING;
  priority = PluginPriority.NORMAL;

  // Called before each agent run
  async beforeExecution(context: IPluginExecutionContext): Promise<void> {
    this.updateCallStats();
    console.log(`[MyPlugin] Starting run: ${context.executionId}`);
  }

  // Called after each successful run
  async afterExecution(
    context: IPluginExecutionContext,
    result: IPluginExecutionResult,
  ): Promise<void> {
    const tokens = result.usage?.totalTokens ?? 0;
    console.log(`[MyPlugin] Run complete. Tokens used: ${tokens}`);
  }

  // Called on execution error
  async onError(error: Error, context?: IPluginErrorContext): Promise<void> {
    this.updateErrorStats();
    console.error(`[MyPlugin] Error in run: ${error.message}`);
  }

  getStats(): IMyPluginStats {
    return {
      ...super.getStats(),
      requestCount: this.stats.calls,
    };
  }
}
```

### Register with Robota

<!-- doc-example-skip: imports the local my-plugin.js module defined in the previous example -->

```typescript
import { Robota } from '@robota-sdk/agent-core';
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';
import { MyPlugin } from './my-plugin.js';

const agent = new Robota({
  name: 'MyAgent',
  aiProviders: [new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY })],
  defaultModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  plugins: [new MyPlugin()],
});
```

---

## AbstractPlugin Lifecycle Hooks

Override any of these optional methods in your plugin:

<!-- doc-example-skip: hook signature listing, not runnable code -->

```typescript
// Before the agent processes a message
beforeExecution(context: IPluginExecutionContext): Promise<void> | void

// After successful completion
afterExecution(context: IPluginExecutionContext, result: IPluginExecutionResult): Promise<void> | void

// Before each tool call
beforeToolCall(toolName: string, parameters: TToolParameters): Promise<void> | void

// After each tool call
afterToolCall(toolName: string, parameters: TToolParameters, result: IToolExecutionResult): Promise<void> | void

// On any error
onError(error: Error, context?: IPluginErrorContext): Promise<void> | void

// Before the agent is disposed
cleanup(): Promise<void>
```

### Built-in stats helpers

`AbstractPlugin` tracks basic stats automatically. Use these protected helpers and fields:

<!-- doc-example-skip: protected-member fragment inside a plugin class body, not runnable code -->

```typescript
this.updateCallStats(); // increments this.stats.calls
this.updateErrorStats(); // increments this.stats.errors
this.stats.calls; // total calls
this.stats.errors; // total errors
this.stats.lastActivity; // Date of last call
```

---

## EventEmitterPlugin — Event Subscriptions

For simpler use cases, subscribe to named events without subclassing:

```typescript
import { Robota, EventEmitterPlugin, EVENT_EMITTER_EVENTS } from '@robota-sdk/agent-core';
import type { IAIProvider } from '@robota-sdk/agent-core';

declare const provider: IAIProvider;

const events = new EventEmitterPlugin();

// Subscribe to specific events
events.on(EVENT_EMITTER_EVENTS.EXECUTION_START, (data) => {
  console.log('Agent started run:', data.metadata?.executionId);
});

events.on(EVENT_EMITTER_EVENTS.TOOL_BEFORE_EXECUTE, (data) => {
  console.log(`Tool called: ${data.metadata?.toolName}`);
});

events.on(EVENT_EMITTER_EVENTS.EXECUTION_COMPLETE, (data) => {
  console.log('Run complete');
});

const agent = new Robota({
  name: 'EventAgent',
  aiProviders: [provider],
  defaultModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  plugins: [events],
});
```

### Available event constants

| Constant                | Fired when                        |
| ----------------------- | --------------------------------- |
| `EXECUTION_START`       | Agent begins processing a message |
| `EXECUTION_COMPLETE`    | Agent completes successfully      |
| `EXECUTION_ERROR`       | Agent run fails                   |
| `TOOL_BEFORE_EXECUTE`   | A tool is about to be invoked     |
| `TOOL_AFTER_EXECUTE`    | A tool has returned a result      |
| `TOOL_ERROR`            | A tool call fails                 |
| `CONVERSATION_START`    | A conversation begins             |
| `CONVERSATION_COMPLETE` | A conversation ends               |
| `ERROR_OCCURRED`        | Any error is logged               |

All constants are exported from `EVENT_EMITTER_EVENTS` in `@robota-sdk/agent-core`.

---

## Example: Cost Tracking Plugin

```typescript
import { AbstractPlugin, PluginCategory, PluginPriority } from '@robota-sdk/agent-core';
import type {
  IPluginExecutionContext,
  IPluginExecutionResult,
  IPluginStats,
} from '@robota-sdk/agent-core';

const COST_PER_1K_INPUT = 0.003; // USD per 1K input tokens
const COST_PER_1K_OUTPUT = 0.015; // USD per 1K output tokens

interface ICostStats extends IPluginStats {
  totalCostUsd: number;
}

export class CostTrackingPlugin extends AbstractPlugin<never, ICostStats> {
  name = 'CostTrackingPlugin';
  version = '1.0.0';
  category = PluginCategory.MONITORING;
  priority = PluginPriority.LOW;

  private totalCostUsd = 0;

  async afterExecution(
    _context: IPluginExecutionContext,
    result: IPluginExecutionResult,
  ): Promise<void> {
    const input = result.usage?.promptTokens ?? 0;
    const output = result.usage?.completionTokens ?? 0;
    const cost = (input / 1000) * COST_PER_1K_INPUT + (output / 1000) * COST_PER_1K_OUTPUT;
    this.totalCostUsd += cost;
  }

  getTotalCost(): number {
    return this.totalCostUsd;
  }

  getStats(): ICostStats {
    return {
      ...super.getStats(),
      totalCostUsd: this.totalCostUsd,
    };
  }
}
```

---

## Example: Slack Notification Plugin

```typescript
import { AbstractPlugin, PluginCategory, PluginPriority } from '@robota-sdk/agent-core';
import type { IPluginErrorContext } from '@robota-sdk/agent-core';

export class SlackNotificationPlugin extends AbstractPlugin {
  name = 'SlackNotificationPlugin';
  version = '1.0.0';
  category = PluginCategory.NOTIFICATION;
  priority = PluginPriority.LOW;

  constructor(private readonly webhookUrl: string) {
    super();
  }

  async onError(error: Error, _context?: IPluginErrorContext): Promise<void> {
    await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `Robota error: ${error.message}` }),
    });
  }
}
```

---

## Publishing Your Plugin

### Package naming

Community plugins should follow the naming convention:

```
@your-scope/robota-plugin-<name>
# Examples:
@your-org/robota-plugin-slack
@your-org/robota-plugin-linear
@your-org/robota-plugin-datadog
```

### Minimal `package.json`

```json
{
  "name": "@your-scope/robota-plugin-slack",
  "version": "1.0.0",
  "type": "module",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "peerDependencies": {
    "@robota-sdk/agent-core": ">=3.0.0"
  },
  "devDependencies": {
    "@robota-sdk/agent-core": "^3.0.0"
  }
}
```

### Testing your plugin

<!-- doc-example-skip: imports the local my-plugin.js module defined in the earlier example -->

```typescript
import { describe, it, expect, vi } from 'vitest';
import { MyPlugin } from './my-plugin.js';

describe('MyPlugin', () => {
  it('increments call count on beforeExecution', async () => {
    const plugin = new MyPlugin();
    await plugin.initialize();

    await plugin.beforeExecution({ executionId: 'test-1' });

    expect(plugin.getStats().calls).toBe(1);
  });

  it('increments error count on onError', async () => {
    const plugin = new MyPlugin();
    await plugin.initialize();

    await plugin.onError(new Error('test'));

    expect(plugin.getStats().errors).toBe(1);
  });
});
```

---

## Plugin Directory

**Official plugins** (maintained by the Robota team):

| Plugin               | Import                   | Description                                                    |
| -------------------- | ------------------------ | -------------------------------------------------------------- |
| `EventEmitterPlugin` | `@robota-sdk/agent-core` | Pub/sub event subscriptions — subscribe to any lifecycle event |

**Community plugins**: [Submit yours to the plugin directory](/plugins/).

---

## Related

- [Plugin directory](/plugins/)
- [Agent core API](./building-agents.md)
- [SDK framework](./sdk.md)
