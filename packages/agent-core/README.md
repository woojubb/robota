# @robota-sdk/agent-core

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
- **Multi-provider**: Register multiple providers, switch dynamically with `setModel()`
- **Permission system**: Deterministic 3-step policy evaluation (`evaluatePermission`)
- **Hook system**: Shell command-based lifecycle hooks (`runHooks`)
- **Plugin system**: `AbstractPlugin` base class with lifecycle hooks (beforeRun, afterRun, onError, etc.)
- **Event services**: Unified event emission with owner path tracking
- **Error hierarchy**: Typed errors extending `RobotaError` (ProviderError, RateLimitError, etc.)
- **Model definitions**: Central `CLAUDE_MODELS` registry with context windows, output limits, and human-readable names
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

## What This Package Provides

| Category        | Exports                                                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Core**        | `Robota`, `AbstractAgent`, `AbstractAIProvider`, `AbstractPlugin`, `AbstractTool`, `AbstractExecutor`, `LocalExecutor` |
| **Permissions** | `evaluatePermission`, `MODE_POLICY`, `TRUST_TO_MODE`, `TPermissionMode`, `TToolArgs`                                   |
| **Hooks**       | `runHooks`, `THookEvent` (PreToolUse, PostToolUse, PreCompact, PostCompact, SessionStart, Stop)                        |
| **Events**      | `AbstractEventService`, `DefaultEventService`, `StructuredEventService`, `EventEmitterPlugin`                          |
| **Models**      | `CLAUDE_MODELS`, `getModelContextWindow()`, `getModelName()`, `formatTokenCount()`, `IModelDefinition`                 |
| **Types**       | `TUniversalMessage`, `IAgentConfig`, `IAIProvider`, `IToolSchema`, `IContextWindowState`                               |
| **Errors**      | `RobotaError`, `ProviderError`, `RateLimitError`, `AuthenticationError`, `ToolExecutionError`, etc.                    |

## What Moved Out in v3

| What                                          | Moved to                     |
| --------------------------------------------- | ---------------------------- |
| `FunctionTool`, `ToolRegistry`, `OpenAPITool` | `@robota-sdk/agent-tools`    |
| `MCPTool`, `RelayMcpTool`                     | `@robota-sdk/agent-tool-mcp` |
| 8 plugins (logging, usage, performance, etc.) | `@robota-sdk/agent-plugin-*` |

## License

MIT
