# Robota - AI Agent Framework

A TypeScript framework for building AI agents with multi-provider support, tool calling, and extensible plugin architecture.

![Robota CLI](https://raw.githubusercontent.com/woojubb/robota/main/content/images/cli-demo.png)

## Quick Start

### CLI — AI Coding Assistant

```bash
npm install -g @robota-sdk/agent-cli
robota
```

### SDK — Programmatic Usage

```typescript
import { query } from '@robota-sdk/agent-sdk';

const response = await query('List all TypeScript files in src/');
```

### Core — Build Custom Agents

```typescript
import { Robota } from '@robota-sdk/agent-core';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const agent = new Robota({
  name: 'MyAgent',
  aiProviders: [new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY })],
  defaultModel: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    systemMessage: 'You are a helpful assistant.',
  },
});

const response = await agent.run('Hello!');
```

## Architecture

```
agent-cli         ← Interactive terminal AI coding assistant
  ↓
agent-sdk         ← Assembly layer: config, context, session factory, query()
  ↓
agent-sessions    ← Session lifecycle: permissions, hooks, compaction
agent-tools       ← Tool infrastructure + 8 built-in tools
agent-providers   ← AI provider implementations
  ↓
agent-core        ← Foundation: Robota engine, abstractions, plugins
```

## Packages

| Package | Description |
|---------|-------------|
| [`@robota-sdk/agent-core`](https://www.npmjs.com/package/@robota-sdk/agent-core) | Core agent runtime, abstractions, and plugin system |
| [`@robota-sdk/agent-tools`](https://www.npmjs.com/package/@robota-sdk/agent-tools) | Tool registry, FunctionTool, and 8 built-in tools |
| [`@robota-sdk/agent-sessions`](https://www.npmjs.com/package/@robota-sdk/agent-sessions) | Session with permissions, hooks, and compaction |
| [`@robota-sdk/agent-sdk`](https://www.npmjs.com/package/@robota-sdk/agent-sdk) | Assembly layer with config/context loading and query() |
| [`@robota-sdk/agent-provider-anthropic`](https://www.npmjs.com/package/@robota-sdk/agent-provider-anthropic) | Anthropic Claude provider |
| [`@robota-sdk/agent-cli`](https://www.npmjs.com/package/@robota-sdk/agent-cli) | Interactive terminal AI coding assistant |

## Documentation

Full documentation at **[robota.io](https://robota.io)**

- [Getting Started](https://robota.io/getting-started/)
- [Building Agents](https://robota.io/guide/building-agents.html)
- [SDK Usage](https://robota.io/guide/sdk.html)
- [CLI Reference](https://robota.io/guide/cli.html)
- [Examples](https://robota.io/examples/)

## Development

```bash
pnpm install
pnpm build
pnpm test
```

Node.js 18+ required. See [Development Guide](https://robota.io/development/) for details.

## License

MIT
