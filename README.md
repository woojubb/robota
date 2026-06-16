# Robota - AI Agent Framework

A TypeScript framework for building AI agents with multi-provider support, tool calling, and extensible plugin architecture.

![Robota CLI](https://raw.githubusercontent.com/woojubb/robota/main/content/images/cli-demo.png)

## Quick Start

### CLI — AI Coding Assistant

```bash
# Try it now (no install needed)
npx @robota-sdk/agent-cli

# Or install globally for persistent use
npm install -g @robota-sdk/agent-cli
robota
```

> **Beta**: Robota is currently `3.0.0-beta`. Core features are stable but APIs may change before 1.0. See [CHANGELOG.md](./CHANGELOG.md) for upgrade notes.

> **macOS users**: Korean/CJK IME input may crash macOS Terminal.app. Use **[iTerm2](https://iterm2.com/)** instead. This is a known Ink + Terminal.app issue shared with Claude Code.

### SDK — Programmatic Usage

```typescript
import { createQuery } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';

const query = createQuery({
  provider: new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY }),
});
const response = await query('List all TypeScript files in src/');
```

### Core — Build Custom Agents

```typescript
import { Robota } from '@robota-sdk/agent-core';
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';

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
agent-cli                       ← Interactive terminal AI coding assistant
agent-transport-{tui,http,ws,mcp} ← Standalone transports (split in beta.76); agent-transport = lean core
  ↓
agent-framework        ← Assembly layer: InteractiveSession, createQuery(), config/context loading
  ↓
agent-session          ← Session lifecycle: permissions, hooks, compaction
agent-tools            ← Tool infrastructure + 8 built-in tools
agent-provider         ← Consolidated AI providers (sub-paths: /anthropic, /openai, /gemini, …)
agent-plugin           ← 8 consolidated lifecycle plugins
  ↓
agent-core             ← Foundation: Robota engine, abstractions, plugin contracts
```

## Packages

| Package                                                                                                        | Description                                                                             |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [`@robota-sdk/agent-core`](https://www.npmjs.com/package/@robota-sdk/agent-core)                               | Core agent runtime, abstractions, and plugin system                                     |
| [`@robota-sdk/agent-tools`](https://www.npmjs.com/package/@robota-sdk/agent-tools)                             | Tool registry, FunctionTool, and 8 built-in tools                                       |
| [`@robota-sdk/agent-session`](https://www.npmjs.com/package/@robota-sdk/agent-session)                         | Session with permissions, hooks, and compaction                                         |
| [`@robota-sdk/agent-framework`](https://www.npmjs.com/package/@robota-sdk/agent-framework)                     | Assembly layer with config/context loading and query()                                  |
| [`@robota-sdk/agent-provider`](https://www.npmjs.com/package/@robota-sdk/agent-provider)                       | Consolidated AI providers (Anthropic, OpenAI, Gemini, DeepSeek, Gemma, Qwen, ByteDance) |
| [`@robota-sdk/agent-cli`](https://www.npmjs.com/package/@robota-sdk/agent-cli)                                 | Interactive terminal AI coding assistant                                                |
| [`@robota-sdk/agent-command`](https://www.npmjs.com/package/@robota-sdk/agent-command)                         | Slash command modules (`/agent`, `/help`, `/provider`, `/preset`, `/schedule`, …)       |
| [`@robota-sdk/agent-plugin`](https://www.npmjs.com/package/@robota-sdk/agent-plugin)                           | 8 consolidated lifecycle plugins (logging, usage, limits, performance, webhook, …)      |
| [`@robota-sdk/agent-executor`](https://www.npmjs.com/package/@robota-sdk/agent-executor)                       | Execution engine for the agentic loop                                                   |
| [`@robota-sdk/agent-preset`](https://www.npmjs.com/package/@robota-sdk/agent-preset)                           | Named agent profiles (preset system)                                                    |
| [`@robota-sdk/agent-subagent-runner`](https://www.npmjs.com/package/@robota-sdk/agent-subagent-runner)         | Subagent dispatch runner                                                                |
| [`@robota-sdk/agent-session-analytics`](https://www.npmjs.com/package/@robota-sdk/agent-session-analytics)     | Session log timing analysis (new in beta.76)                                            |
| [`@robota-sdk/agent-interface-transport`](https://www.npmjs.com/package/@robota-sdk/agent-interface-transport) | Transport type contracts (zero deps)                                                    |
| [`@robota-sdk/agent-interface-tui`](https://www.npmjs.com/package/@robota-sdk/agent-interface-tui)             | TUI interaction type contracts (zero deps)                                              |
| [`@robota-sdk/agent-transport`](https://www.npmjs.com/package/@robota-sdk/agent-transport)                     | Lean transport core (`/headless`, `/testing`)                                           |
| [`@robota-sdk/agent-transport-tui`](https://www.npmjs.com/package/@robota-sdk/agent-transport-tui)             | TUI transport (Ink/React) — standalone (split in beta.76)                               |
| [`@robota-sdk/agent-transport-http`](https://www.npmjs.com/package/@robota-sdk/agent-transport-http)           | HTTP/REST transport — standalone (split in beta.76)                                     |
| [`@robota-sdk/agent-transport-ws`](https://www.npmjs.com/package/@robota-sdk/agent-transport-ws)               | WebSocket transport — standalone (split in beta.76)                                     |
| [`@robota-sdk/agent-transport-mcp`](https://www.npmjs.com/package/@robota-sdk/agent-transport-mcp)             | MCP transport — standalone (split in beta.76)                                           |

## Documentation

Full documentation at **[robota.io](https://robota.io)**

- [Getting Started](https://robota.io/getting-started/)
- [Building Agents](https://robota.io/guide/building-agents.html)
- [SDK Usage](https://robota.io/guide/sdk.html)
- [CLI Reference](https://robota.io/guide/cli.html)
- [Examples](https://robota.io/examples/)

## Repository Scope

This repository now owns the Robota agent SDK, CLI, providers, transports, playground, and related
apps. The DAG product line has moved to a separate `robota-dag` repository; use that repository for
DAG source, issues, docs, and releases once its remote URL is published.

## Development

```bash
pnpm install
pnpm build
pnpm test
```

Node.js 22+ required. See [Development Guide](https://robota.io/development/) for details.

## License

Robota is dual-licensed under the [GNU AGPL-3.0](LICENSE) or a [commercial license](LICENSE-COMMERCIAL.md). See [LICENSING.md](LICENSING.md).
