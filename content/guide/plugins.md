---
title: Plugins
description: Observe and extend a Robota agent with runtime plugins, use the ready-made plugins in @robota-sdk/agent-plugin, and package skills and hooks as robota CLI plugins.
---

# Plugins

"Plugin" means two different things in Robota:

| Kind               | What it is                                                                                 | Where it runs                                  |
| ------------------ | ------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| **Runtime plugin** | A class that observes a `Robota` agent's lifecycle: runs, provider calls, messages, errors | Your code, through `@robota-sdk/agent-core`    |
| **CLI plugin**     | A folder of skills, commands, agent definitions, hooks and MCP servers                     | The `robota` CLI, installed from a marketplace |

Runtime plugins are for cross-cutting concerns in code you write: logging, usage and cost tracking,
limits, notifications, audit trails. CLI plugins extend the `robota` assistant for its users. The
rest of this page covers runtime plugins first, then CLI plugins.

---

## Ready-made runtime plugins

`@robota-sdk/agent-plugin` ships eight plugins for the `Robota` class:

| Plugin class                | Concern                                          |
| --------------------------- | ------------------------------------------------ |
| `ConversationHistoryPlugin` | Persist and restore conversation history         |
| `ErrorHandlingPlugin`       | Error classification, retries and recovery stats |
| `ExecutionAnalyticsPlugin`  | Per-execution analytics                          |
| `LimitsPlugin`              | Token, request and cost limits                   |
| `LoggingPlugin`             | Structured logging of agent activity             |
| `PerformancePlugin`         | Timing and performance metrics                   |
| `UsagePlugin`               | Token usage accounting                           |
| `WebhookPlugin`             | Send lifecycle events to webhook endpoints       |

```bash
npm install @robota-sdk/agent-core @robota-sdk/agent-plugin
```

Plugins are passed to the `Robota` constructor in its `plugins` array:

```typescript
import { Robota, type IAIProvider } from '@robota-sdk/agent-core';
import { LimitsPlugin, LoggingPlugin, UsagePlugin } from '@robota-sdk/agent-plugin';

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

Each plugin's options type is exported next to it (`ILoggingPluginOptions`, `IUsagePluginOptions`,
`ILimitsPluginOptions`, `IWebhookPluginOptions` and so on), and most take a `strategy` that selects
where data goes (for example `'console' | 'file' | 'remote' | 'silent'` for logging). See the
[agent-plugin SPEC](../../packages/agent-plugin/docs/SPEC.md) for each plugin's contract.

---

## Writing a runtime plugin

A runtime plugin extends `AbstractPlugin` from `@robota-sdk/agent-core` and overrides the lifecycle
methods it cares about. It needs a `name` and a `version`; `category` and `priority` classify it.

```typescript
import {
  AbstractPlugin,
  PluginCategory,
  PluginPriority,
  type IPluginErrorContext,
  type IPluginExecutionContext,
  type IPluginExecutionResult,
  type IPluginOptions,
  type IPluginStats,
} from '@robota-sdk/agent-core';

interface IRunLoggerStats extends IPluginStats {
  completedRuns: number;
}

export class RunLoggerPlugin extends AbstractPlugin<IPluginOptions, IRunLoggerStats> {
  name = 'RunLoggerPlugin';
  version = '1.0.0';
  private completedRuns = 0;

  constructor() {
    super();
    this.category = PluginCategory.MONITORING;
    this.priority = PluginPriority.NORMAL;
  }

  // Before the agent starts working on a message.
  override async beforeExecution(context: IPluginExecutionContext): Promise<void> {
    this.updateCallStats();
    console.log(`[RunLogger] start ${context.executionId ?? ''}`);
  }

  // After the run completes.
  override async afterExecution(
    context: IPluginExecutionContext,
    result: IPluginExecutionResult,
  ): Promise<void> {
    this.completedRuns += 1;
    console.log(
      `[RunLogger] done ${context.executionId ?? ''} in ${result.duration ?? 0} ms, ` +
        `${result.toolsExecuted ?? 0} tool calls`,
    );
  }

  // When the run fails.
  override async onError(error: Error, context?: IPluginErrorContext): Promise<void> {
    this.updateErrorStats();
    console.error(`[RunLogger] ${context?.executionId ?? ''} failed: ${error.message}`);
  }

  override getStats(): IRunLoggerStats {
    return { ...super.getStats(), completedRuns: this.completedRuns };
  }
}
```

Register it like any other plugin: `plugins: [new RunLoggerPlugin()]`.

### Lifecycle methods the agent calls

<!-- doc-example-skip: method signature listing, not runnable code -->

```typescript
// Once per run
beforeRun(input: string, options?: IRunOptions): Promise<void>
beforeExecution(context: IPluginExecutionContext): Promise<void>
beforeConversation(context: IPluginExecutionContext): Promise<void>
afterRun(input: string, response: string, options?: IRunOptions): Promise<void>
afterExecution(context: IPluginExecutionContext, result: IPluginExecutionResult): Promise<void>
afterConversation(context: IPluginExecutionContext, result: IPluginExecutionResult): Promise<void>
afterToolExecution(context: IPluginExecutionContext, result: IPluginExecutionResult): Promise<void> // only when tools ran

// Around every provider call and message
beforeProviderCall(messages: TUniversalMessage[]): Promise<void>
onStreamingChunk(chunk: TUniversalMessage): Promise<void> // each streamed piece of text, in order
afterProviderCall(messages: TUniversalMessage[], response: TUniversalMessage): Promise<void>
onMessageAdded(message: TUniversalMessage): Promise<void>

// When a run fails
onError(error: Error, context?: IPluginErrorContext): Promise<void>
```

The `result` given to the after-run methods carries `response`, `duration`, `tokensUsed` (when the
provider reported usage), `toolsExecuted`, `success`, and `toolCalls` (the id and name of each tool
call that ran, with `result: null` for one that failed). The `context` carries `executionId` and
the conversation `messages`.

`IPluginHooks` also declares `beforeToolCall`, `beforeToolExecution` and `afterToolCall`, but the
`Robota` run loop does not call them; a plugin that needs per-tool detail should read `toolCalls`
in `afterToolExecution`. A plugin method that throws is logged and does not stop the run.

### Stats helpers

`AbstractPlugin` counts calls and errors for `getStats()`. Inside a plugin:

<!-- doc-example-skip: protected-member fragment inside a plugin class body, not runnable code -->

```typescript
this.updateCallStats(); // increments calls and records the time
this.updateErrorStats(); // increments errors and records the time
```

`getStats()` returns `enabled`, `calls`, `errors`, `moduleEventsReceived` and `lastActivity`;
override it to add your own fields. `enable()`, `disable()`, `getStatus()` and `dispose()` are
available on every plugin.

### Example: cost tracking

`afterProviderCall` sees every response message, and `readTokenUsageFromMessage` reads its usage
metadata:

```typescript
import {
  AbstractPlugin,
  PluginCategory,
  readTokenUsageFromMessage,
  type TUniversalMessage,
} from '@robota-sdk/agent-core';

const USD_PER_1K_INPUT = 0.003;
const USD_PER_1K_OUTPUT = 0.015;

export class CostTrackingPlugin extends AbstractPlugin {
  name = 'CostTrackingPlugin';
  version = '1.0.0';
  private totalCostUsd = 0;

  constructor() {
    super();
    this.category = PluginCategory.MONITORING;
  }

  override async afterProviderCall(
    _messages: TUniversalMessage[],
    response: TUniversalMessage,
  ): Promise<void> {
    const usage = readTokenUsageFromMessage(response);
    if (usage === undefined) return;
    this.totalCostUsd +=
      (usage.inputTokens / 1000) * USD_PER_1K_INPUT +
      (usage.outputTokens / 1000) * USD_PER_1K_OUTPUT;
  }

  getTotalCost(): number {
    return this.totalCostUsd;
  }
}
```

`@robota-sdk/agent-core` also exports `calculateModelCost` and `lookupModelPrice` if you would rather
use Robota's own model price table.

### Example: error notification

```typescript
import { AbstractPlugin, PluginCategory, type IPluginErrorContext } from '@robota-sdk/agent-core';

export class ErrorNotificationPlugin extends AbstractPlugin {
  name = 'ErrorNotificationPlugin';
  version = '1.0.0';

  constructor(private readonly webhookUrl: string) {
    super();
    this.category = PluginCategory.NOTIFICATION;
  }

  override async onError(error: Error, context?: IPluginErrorContext): Promise<void> {
    await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `Agent run ${context?.executionId ?? ''} failed: ${error.message}`,
      }),
    });
  }
}
```

For more than a single notification, `WebhookPlugin` in `@robota-sdk/agent-plugin` sends lifecycle
events to several endpoints with retries.

### Testing a runtime plugin

Lifecycle methods are ordinary async methods, so a test can call them directly:

<!-- doc-example-skip: imports the local run-logger-plugin.js module defined in the earlier example -->

```typescript
import { describe, expect, it } from 'vitest';
import { RunLoggerPlugin } from './run-logger-plugin.js';

describe('RunLoggerPlugin', () => {
  it('counts a completed run', async () => {
    const plugin = new RunLoggerPlugin();
    await plugin.beforeExecution({ executionId: 'test-1' });
    await plugin.afterExecution({ executionId: 'test-1' }, { duration: 5, toolsExecuted: 0 });

    expect(plugin.getStats().calls).toBe(1);
    expect(plugin.getStats().completedRuns).toBe(1);
  });
});
```

### Publishing a runtime plugin

A plugin package needs only `@robota-sdk/agent-core`. Declare it as a peer dependency so your plugin
uses the application's copy. Robota is on the `3.0.0` beta line; a caret range on a beta version
(`^3.0.0-beta.83`) accepts later betas and the stable release:

```json
{
  "name": "@your-scope/robota-plugin-slack",
  "version": "1.0.0",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "peerDependencies": {
    "@robota-sdk/agent-core": "^3.0.0-beta.83"
  },
  "devDependencies": {
    "@robota-sdk/agent-core": "^3.0.0-beta.83"
  }
}
```

---

## Subscribing to events: EventEmitterPlugin

`EventEmitterPlugin` (in `@robota-sdk/agent-core`) turns the lifecycle into named events you can
subscribe to without writing a class:

```typescript
import { EVENT_EMITTER_EVENTS, EventEmitterPlugin, Robota } from '@robota-sdk/agent-core';
import type { IAIProvider } from '@robota-sdk/agent-core';

declare const provider: IAIProvider;

const events = new EventEmitterPlugin();

events.on(EVENT_EMITTER_EVENTS.AGENT_EXECUTION_START, (event) => {
  console.log('Run started:', event.executionId);
});

events.on(EVENT_EMITTER_EVENTS.TOOL_AFTER_EXECUTE, (event) => {
  console.log('Tool ran:', event.data?.['toolName']);
});

events.on(EVENT_EMITTER_EVENTS.AGENT_EXECUTION_COMPLETE, (event) => {
  console.log('Run complete in', event.data?.['duration'], 'ms');
});

const agent = new Robota({
  name: 'EventAgent',
  aiProviders: [provider],
  defaultModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  plugins: [events],
});
```

Each listener receives an `IEventEmitterEventData`: `type`, `timestamp`, `executionId`, `sessionId`,
`userId`, `data`, `error` and `metadata`. A `Robota` run emits these events through the plugin:

| Event constant             | Emitted                                                                         |
| -------------------------- | ------------------------------------------------------------------------------- |
| `AGENT_EXECUTION_START`    | When a run starts                                                               |
| `AGENT_EXECUTION_COMPLETE` | When a run completes (`data.duration`, `data.tokensUsed`, `data.toolsExecuted`) |
| `AGENT_EXECUTION_ERROR`    | When a run fails (`error`)                                                      |
| `TOOL_AFTER_EXECUTE`       | After a run, once per tool call that ran (`data.toolName`)                      |
| `TOOL_SUCCESS`             | With `TOOL_AFTER_EXECUTE`, for each tool call that succeeded                    |
| `TOOL_ERROR`               | With `TOOL_AFTER_EXECUTE`, for each tool call that failed                       |
| `CONVERSATION_START`       | When a run starts; only if listed in the `events` option                        |
| `CONVERSATION_COMPLETE`    | When a run completes; only if listed in the `events` option                     |

By default the plugin emits only the agent-execution and tool events; pass
`new EventEmitterPlugin({ events: [...] })` to choose the list. Other options include `filters`
(per-event predicates), `buffer` (batch delivery) and `async`.

---

## CLI plugins

A `robota` CLI plugin is a folder with a manifest at `.claude-plugin/plugin.json` (`name`, `version`,
`description`, `features`), the same layout Claude Code plugins use:

| Path in the plugin       | Contributes                                                 |
| ------------------------ | ----------------------------------------------------------- |
| `skills/<name>/SKILL.md` | Skills, shown as `/<name>` with the plugin's name as a hint |
| `commands/<name>.md`     | Commands, shown as `/<plugin>:<name>`                       |
| `agents/`                | Agent definitions for subagents                             |
| `hooks/hooks.json`       | Lifecycle hooks, merged with the session's own              |
| `.mcp.json`              | MCP server definitions                                      |
| `themes/`                | Terminal themes                                             |

Plugins are published in marketplaces (a GitHub `owner/repo` or a git URL) and installed with
`/plugin`, under `~/.robota/plugins/` for the user or `.robota/plugins/` for a project. See
[CLI Reference — Plugins](./cli.md#plugins) for the commands, and
[Permissions and Hooks — Plugin Hooks](./permissions-and-hooks.md#plugin-hooks) for the environment a
plugin hook runs with.

---

## Related

- [Building Agents](./building-agents.md) — the `Robota` class the runtime plugins attach to
- [Using the SDK](./sdk.md) — sessions, hooks and permissions in `agent-framework`
- [Permissions and Hooks](./permissions-and-hooks.md) — hooks, which run shell commands, HTTP calls or model checks at lifecycle events
