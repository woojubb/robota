# Agent Core

The foundation layer of the Robota SDK. Provides the `Robota` agent class, abstract base classes for providers/tools/plugins, the permission system, hook system, event services, and error hierarchy.

## Installation

```bash
npm install @robota-sdk/agent-core
```

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
    systemMessage: 'You are a helpful assistant.',
  },
});

const response = await agent.run('Hello, world!');
console.log(response);
```

## Key Features

- **Robota class**: AI agent with conversation history, tool execution, and plugin support
- **ConversationStore**: Append-only conversation history with streaming buffer (`beginAssistant`/`appendStreaming`/`commitAssistant`)
- **IBaseMessage**: Every message has a unique `id` (UUID) and `state` (`'complete'` | `'interrupted'`)
- **Multi-provider**: Register multiple providers, switch dynamically with `setModel()`
- **AbstractAIProvider.streamWithAbort()**: Standard streaming wrapper for all providers — handles AbortSignal, returns partial content on abort
- **Permission system**: Deterministic 3-step policy evaluation (`evaluatePermission`)
- **Hook system**: Shell command-based lifecycle hooks (`runHooks`)
- **Plugin system**: `AbstractPlugin` base class with lifecycle hooks (beforeRun, afterRun, onError, etc.)
- **Event services**: Unified event emission with owner path tracking
- **Error hierarchy**: Typed errors extending `RobotaError` (ProviderError, RateLimitError, etc.)
- **Model definitions**: Central `CLAUDE_MODELS` registry with context windows, output limits, and human-readable names
- **callProviderWithCache**: Accepts `Partial<IChatOptions>` overrides for per-call configuration
- **AbortSignal propagation**: Signal flows through the entire execution chain (Session -> Robota -> Provider)
- **Type safety**: Strict TypeScript, zero `any` in production code

## Robota API

```typescript
const agent = new Robota(config);

// Send a message (executes tool calls automatically)
const response = await agent.run('Hello');

// Conversation history
const history = agent.getHistory(); // TUniversalMessage[]
agent.clearHistory();

// Switch provider/model mid-conversation
agent.setModel({ provider: 'openai', model: 'gpt-4o' });
```

## IAgentConfig

| Field                        | Type                       | Description                    |
| ---------------------------- | -------------------------- | ------------------------------ |
| `name`                       | `string`                   | Agent name                     |
| `aiProviders`                | `IAIProvider[]`            | One or more provider instances |
| `defaultModel.provider`      | `string`                   | Provider name                  |
| `defaultModel.model`         | `string`                   | Model identifier               |
| `defaultModel.systemMessage` | `string?`                  | System prompt                  |
| `tools`                      | `IToolWithEventService[]?` | Tools the agent can call       |
| `plugins`                    | `IPluginContract[]?`       | Plugins for lifecycle hooks    |

## Architecture

```
agent-core (this package — zero workspace dependencies)
  ↑
agent-sessions    ← Session lifecycle
agent-tools       ← Tool implementations
agent-providers   ← AI provider implementations
agent-plugins     ← Plugin implementations (8 extracted packages)
  ↑
agent-sdk         ← Assembly layer
  ↑
agent-cli         ← Terminal UI
```

## Public API Surface

| Category        | Exports                                                                                                                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Core**        | `Robota`, `ConversationStore`, `AbstractAgent`, `AbstractAIProvider` (+ `streamWithAbort`), `AbstractPlugin`, `AbstractTool`, `AbstractExecutor`, `LocalExecutor`                         |
| **Permissions** | `evaluatePermission`, `MODE_POLICY`, `TRUST_TO_MODE`, `UNKNOWN_TOOL_FALLBACK`, `TPermissionMode`, `TTrustLevel`, `TPermissionDecision`, `TToolArgs`, `IPermissionLists`, `TKnownToolName` |
| **Hooks**       | `runHooks`, `CommandExecutor`, `HttpExecutor`, `IHookTypeExecutor`, `THookEvent`, `THooksConfig`, `IHookGroup`, `IHookDefinition`, `IHookInput`, `IHookResult`                            |
| **Events**      | `EventEmitterPlugin`, `IEventService`, `IOwnerPathSegment`                                                                                                                                |
| **Models**      | `CLAUDE_MODELS`, `DEFAULT_CONTEXT_WINDOW`, `DEFAULT_MAX_OUTPUT`, `getModelContextWindow()`, `getModelMaxOutput()`, `getModelName()`, `formatTokenCount()`, `IModelDefinition`             |
| **Types**       | `TUniversalMessage`, `IBaseMessage` (`id`, `state`), `TMessageState`, `IAgentConfig`, `IAIProvider`, `IToolSchema`, `IContextWindowState`, `IContextTokenUsage`, `TTextDeltaCallback`     |
| **Errors**      | `RobotaError`, `ProviderError`, `RateLimitError`, `AuthenticationError`, `ToolExecutionError`, etc.                                                                                       |
| **Managers**    | `AgentFactory`, `AgentTemplates`, `ConversationHistory`, `EventHistoryModule`                                                                                                             |

## What Moved Out in v3

| What                                          | Moved to                     |
| --------------------------------------------- | ---------------------------- |
| `FunctionTool`, `ToolRegistry`, `OpenAPITool` | `@robota-sdk/agent-tools`    |
| `MCPTool`, `RelayMcpTool`                     | `@robota-sdk/agent-tool-mcp` |
| 8 plugins (logging, usage, performance, etc.) | `@robota-sdk/agent-plugin-*` |

## License

MIT
