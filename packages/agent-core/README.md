# @robota-sdk/agent-core

The foundation of the Robota SDK. It provides the `Robota` agent class (a conversation loop with
tool calling), the provider, tool and plugin contracts with their abstract base classes, the
permission evaluator, the hook runner, event services, typed errors, model metadata, and structured
output. It has no `@robota-sdk/*` dependencies; every other Robota package builds on it.

## Installation

```bash
npm install @robota-sdk/agent-core
```

Requires Node.js 22.12 or later. A provider package supplies the model connection, for example
`@robota-sdk/agent-provider-anthropic`.

## Quick Start

```typescript
import { Robota } from '@robota-sdk/agent-core';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });

const agent = new Robota({
  name: 'MyAgent',
  aiProviders: [provider],
  defaultModel: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
  },
  systemMessage: 'You are a helpful assistant.',
});

const response = await agent.run('Hello, world!');
console.log(response);
```

`defaultModel.provider` names one of the `aiProviders` by its `name` (`'anthropic'` here).

## What it provides

- **`Robota`** — an agent with conversation history, automatic tool execution, plugins, streaming
  (`runStream`) and structured output. By default history accumulates across runs; set
  `retainHistory: false` to start every run from the system prompt.
- **Messages** — every message (`TUniversalMessage`) has a unique `id` and a `state`
  (`'complete'` or `'interrupted'`). `ConversationStore` is the append-only history with a streaming
  buffer.
- **Multiple providers** — register several providers and switch with `setModel()`. Providers extend
  `AbstractAIProvider` and report capabilities (`getProviderCapabilities`), including whether they
  offer hosted web search/fetch.
- **Tools** — `FunctionTool` and `ToolRegistry` live here, next to the `AbstractTool` base class and
  the tool schema contract. Ready-made tools are in `@robota-sdk/agent-tools`.
- **Permissions** — `evaluatePermission` decides a tool call from the permission mode and
  allow/deny/ask rules; it is the one evaluator every Robota caller uses.
- **Hooks** — `runHooks` runs the lifecycle hooks configured for an event. See the
  [hook event catalog](./docs/HOOK-CATALOG.md).
- **Plugins** — `AbstractPlugin` with lifecycle hooks (`beforeRun`, `afterRun`, `onError`, …).
  Ready-made plugins are in `@robota-sdk/agent-plugin`.
- **Events** — event services with owner-path tracking and `EventEmitterPlugin`.
- **Errors** — typed errors extending `RobotaError`, such as `ProviderError`, `RateLimitError`,
  `ToolExecutionError` and `StructuredOutputError`.
- **Model metadata** — providers register their own models with `registerModelMetadata()`; core
  owns the registry and the lookups (`getModelContextWindow()`, `getModelMaxOutput()`, …), not any
  vendor's catalogue.
- **Cancellation** — an `AbortSignal` passed in run options reaches the provider call.

## Robota API

```typescript
import { Robota } from '@robota-sdk/agent-core';
import type { IAgentConfig } from '@robota-sdk/agent-core';

declare const config: IAgentConfig;
const agent = new Robota(config);

// Send a message (tool calls are executed automatically)
const response = await agent.run('Hello');

// Conversation history
const history = agent.getHistory(); // TUniversalMessage[]
agent.clearHistory();

// Switch provider/model mid-conversation (the provider must be registered in aiProviders)
agent.setModel({ provider: 'openai', model: 'gpt-4o' });

// Release the agent's resources when you are done
await agent.destroy();
```

### Structured output

`run(input, { output })` returns a schema-validated object instead of a string. A Zod schema gives a
typed result. The schema is sent to the provider's native structured-output support where one
exists, and the response is always validated by core with a bounded retry on violation
(`outputRetries`, default 2). When the retries are used up, `run` throws `StructuredOutputError`.

```typescript
import { z } from 'zod';
import { Robota } from '@robota-sdk/agent-core';
import type { IAgentConfig } from '@robota-sdk/agent-core';

declare const config: IAgentConfig;
const agent = new Robota(config);

const reportSchema = z.object({
  title: z.string(),
  score: z.number(),
  summary: z.string(),
});

// Typed result: { title: string; score: number; summary: string }
const report = await agent.run('Summarize the meeting as a report.', {
  output: reportSchema,
});

// Streaming variant: text deltas stream as usual; the validated object is the
// generator's return value (the final { done: true, value } iterator result).
const stream = agent.runStream('Summarize again.', { output: reportSchema });
const iterator = stream[Symbol.asyncIterator]();
let next = await iterator.next();
while (!next.done) {
  process.stdout.write(next.value);
  next = await iterator.next();
}
const streamedReport = next.value;
console.log(report.title, streamedReport.title);
```

A raw JSON-schema wrapper is also accepted:
`{ output: { jsonSchema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] } } }`.

### Model options per run

`run` and `runStream` accept run-scoped model options that win over `defaultModel.*`: `maxTokens`,
`temperature` and `toolChoice`. `toolChoice` controls tool calls: `'auto'` (the model decides),
`'none'` (no tool calls), `'required'` (must call some tool), or `{ tool: name }` (must call that
tool). Naming a tool that is not in the run's tool list throws immediately. A forcing directive
applies to the run's first model call only; later rounds revert to `'auto'` so the model can use the
tool results and finish.

```typescript
import { Robota } from '@robota-sdk/agent-core';
import type { IAgentConfig } from '@robota-sdk/agent-core';

declare const config: IAgentConfig;
const agent = new Robota(config);

// Force the model to answer through a router tool (decision-agent pattern)
const decision = await agent.run('Route this request.', {
  toolChoice: { tool: 'route-request' },
  allowToolOnlyCompletion: true,
});

// Suppress tools for a plain-text turn, capped at 100 output tokens
const summary = await agent.run('Summarize the discussion.', {
  toolChoice: 'none',
  maxTokens: 100,
});
console.log(decision, summary);
```

The same directive can be set for every run with `defaultModel.toolChoice`.

### Model effort

`defaultModel.effort` and the per-call `IChatOptions.effort` accept `auto`, `none`, `minimal`,
`low`, `medium`, `high`, `xhigh` or `max`. `auto` is passed through to the provider adapter, which
applies the model's documented default. The adapter reports what it actually sent through
`onModelEffortOutcome`; core does not guess vendor field names or defaults.

### Execution events and usage

`run()` accepts an `onExecutionEvent` callback in its options. The execution loop reports
provider-neutral events that a higher layer can persist as an append-only record of the run,
including `provider_request`, `provider_native_raw_payload`, `provider_stream_raw_delta`,
`provider_response_raw`, `provider_response_normalized`, `assistant_message_committed`,
`tool_batch_started`, `tool_execution_request`, `tool_execution_result`, `tool_message_committed`
and `history_mutation`. `@robota-sdk/agent-session` writes these events to its session log.

Capturing a vendor SDK's exact payloads stays in the provider package: a provider calls
`IChatOptions.onProviderNativeRawPayload`, and `Robota` forwards it as a
`provider_native_raw_payload` event without importing vendor SDK types.

Each provider call gets a `usageObservationId`. Streaming fragments of one call share it, and a
separately billed call gets a new one, so stored analytics can deduplicate usage by identity.

`sumMessagesUsage(messages)` sums the usage providers reported on assistant messages. The usage of
one run, tool rounds included, is the sum over the messages that run appended:

```typescript
import { Robota, sumMessagesUsage } from '@robota-sdk/agent-core';
import type { IAgentConfig } from '@robota-sdk/agent-core';

declare const config: IAgentConfig;
const agent = new Robota(config);

const before = agent.getHistory().length;
await agent.run('Summarize the open issues.');
const usage = sumMessagesUsage(agent.getHistory().slice(before));
```

`cacheReadTokens`, the part of `promptTokens` the provider served from its prompt cache, is present
only when a provider reports it (the OpenAI and OpenAI-compatible providers do).

## IAgentConfig

The main fields:

| Field                   | Type                       | Description                                                |
| ----------------------- | -------------------------- | ---------------------------------------------------------- |
| `name`                  | `string`                   | Agent name                                                 |
| `aiProviders`           | `IAIProvider[]`            | One or more provider instances                             |
| `defaultModel.provider` | `string`                   | Name of the provider to use                                |
| `defaultModel.model`    | `string`                   | Model identifier                                           |
| `systemMessage`         | `string?`                  | System prompt                                              |
| `tools`                 | `IToolWithEventService[]?` | Tools the agent can call                                   |
| `plugins`               | `IPluginContract[]?`       | Plugins that receive lifecycle hooks                       |
| `retainHistory`         | `boolean?`                 | Keep history across runs (default `true`)                  |
| `maxExecutionRounds`    | `number?`                  | Cap on model-call rounds per run (`0` means no cap)        |
| `isToolVisible`         | `(name) => boolean`        | Hide a registered tool from the model, checked every round |

## Entry points

| Import path                      | What it contains                                                                                                                                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@robota-sdk/agent-core`         | The main API, listed under Main exports. It also has a browser build: nothing in its static import graph uses Node built-ins.                                                                              |
| `@robota-sdk/agent-core/node`    | Node-only pieces: the `CommandExecutor` and `HttpExecutor` hook executors, path containment (`canonicalizePath`, `isPathInside`), owner-only file writes, and the egress policy (`fetchWithEgressPolicy`). |
| `@robota-sdk/agent-core/testing` | Test fixtures: `createScriptedProvider`, `createRecordingProvider`, `createReplayProvider`.                                                                                                                |

When you pass no executors, `runHooks` loads `CommandExecutor` and `HttpExecutor` on demand (this
needs Node). Import them from `@robota-sdk/agent-core/node` only to pass them explicitly.

## Main exports

| Area                   | Exports                                                                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Agent**              | `Robota`, `ConversationStore`, `ConversationHistory`, `AbstractAgent`, `AgentFactory`, `AgentTemplates`                                                                                                                  |
| **Providers**          | `AbstractAIProvider`, `IAIProvider`, `IChatOptions`, `IProviderCapabilities`, `getProviderCapabilities`, `assertProviderNativeWebToolsAvailable`, `IProviderDefinition`, `createProviderFromConfig`                      |
| **Media providers**    | `IImageGenerationProvider`, `IVideoGenerationProvider`, `isImageGenerationProvider`, `isVideoGenerationProvider`, `createImageProviderFromDefinition`, `createVideoProviderFromDefinition`, `resolveMediaProviderConfig` |
| **Tools**              | `FunctionTool`, `ToolRegistry`, `AbstractTool`, `IToolSchema`, `IToolResult`, `zodToJsonSchema`                                                                                                                          |
| **Execution**          | `AbstractExecutor`, `LocalExecutor`, `IExecutor`                                                                                                                                                                         |
| **Permissions**        | `evaluatePermission`, `projectPermissionPolicy`, `RISK_CLASS_POLICY`, `UNCLASSIFIED_TOOL_FALLBACK`, `TRUST_TO_MODE`, `TPermissionMode`, `TTrustLevel`, `TPermissionDecision`, `TToolArgs`, `IPermissionLists`            |
| **Hooks**              | `runHooks`, `GuardrailExecutor`, `decodeHookVerdict`, `isEnforcing`, `THookEvent`, `THooksConfig`, `IHookGroup`, `THookDefinition`, `IHookInput`, `THookOutcome`, `IHookTypeExecutor`                                    |
| **Plugins and events** | `AbstractPlugin`, `EventEmitterPlugin`, `IEventService`, `IOwnerPathSegment`                                                                                                                                             |
| **Orchestration**      | Contracts for multi-agent orchestration (`ISequentialOrchestrationSpec`, `IParallelOrchestrationSpec`, …, `ORCHESTRATION_EVENTS`); the runners are in `@robota-sdk/agent-framework`                                      |
| **Models**             | `registerModelMetadata`, `getModelContextWindow`, `getModelMaxOutput`, `getModelName`, `formatTokenCount`, `DEFAULT_CONTEXT_WINDOW`, `DEFAULT_MAX_OUTPUT`, `IModelDefinition`                                            |
| **Context and usage**  | `estimateContextTokensFromMessages`, `estimateSerializedContextTokens`, `readTokenUsageFromMessage`, `sumMessagesUsage`, `IContextWindowState`, `IContextTokenUsage`                                                     |
| **Messages**           | `TUniversalMessage`, `IBaseMessage`, `TMessageState`, `createUserMessage`, `createAssistantMessage`, `isAssistantMessage`, …                                                                                             |
| **Errors**             | `RobotaError`, `ProviderError`, `RateLimitError`, `AuthenticationError`, `ToolExecutionError`, `StructuredOutputError`, `classifyProviderFailure`, `toProviderError`                                                     |

## Where it sits

```
agent-core            ← this package (no workspace dependencies)
  ↑
agent-tools, agent-session, agent-plugin, agent-mcp, agent-provider-* (one package per vendor)
  ↑
agent-framework       ← assembles sessions, commands, permissions and hooks
  ↑
agent-cli             ← the `robota` reference app
```

- Built-in tools (Shell, Read, Edit, …): `@robota-sdk/agent-tools`
- Ready-made plugins (logging, usage, limits, …): `@robota-sdk/agent-plugin`
- MCP servers and tools: `@robota-sdk/agent-mcp`
- Sessions with permissions, hooks and compaction: `@robota-sdk/agent-session`

## Repository examples

From `packages/agent-core` in a built checkout of the repository, these scripts exercise hooks
without a live model: `node examples/hook-block-demo.mjs`, `node examples/hook-json-response-demo.mjs`,
`node examples/hook-permission-mode-demo.mjs` and `node examples/hook-timeout-demo.mjs`.

## Documentation

- [docs/SPEC.md](./docs/SPEC.md) — package contract and design decisions
- [docs/HOOK-CATALOG.md](./docs/HOOK-CATALOG.md) — hook events, input fields and blocking semantics
- [Building agents](../../content/guide/building-agents.md) — a walkthrough of `Robota`, tools and
  structured output
- [Permissions and hooks](../../content/guide/permissions-and-hooks.md)

## License

Robota is dual-licensed under the [GNU AGPL-3.0](../../LICENSE) or a [commercial license](../../COMMERCIAL.md). See [LICENSING.md](../../LICENSING.md).
