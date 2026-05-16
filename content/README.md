---
layout: home
title: Robota SDK
description: A TypeScript SDK for building AI agents with multi-provider support.
lang: en-US
---

# Robota SDK

A TypeScript framework for building AI agents with multi-provider support, tool calling, and extensible plugin architecture.

![Robota CLI](./images/cli-demo.png)

## Overview

Robota SDK ships three layers you can use independently or together:

- **CLI** (`agent-cli`) — A ready-to-use AI coding assistant in your terminal. Install and run immediately, no code required.
- **Assembly Layer** (`agent-sdk`) — A programmable interface for embedding the same assistant capabilities into your own scripts, tools, or workflows.
- **Agent Library** (`agent-core`, `agent-tools`, `agent-sessions`, and providers) — Low-level building blocks for constructing any AI agent system from scratch.

The CLI is built on top of the Assembly Layer. The Assembly Layer is assembled from the Agent Library. You can enter at any layer.

## Quick Start

### Build an Agent (agent-core)

```typescript
import { Robota } from '@robota-sdk/agent-core';
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';

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

const response = await agent.run('Explain TypeScript generics.');
console.log(response);
```

### Add Tools

```typescript
import { Robota } from '@robota-sdk/agent-core';
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';
import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import { z } from 'zod';

const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });

const calculatorTool = createZodFunctionTool(
  'calculator',
  'Perform arithmetic calculations',
  z.object({
    expression: z.string().describe('Math expression to evaluate'),
  }),
  async ({ expression }) => {
    // WARNING: eval() is used here for brevity only. Do not use in production.
    return { data: String(eval(expression)) }; // eslint-disable-line no-eval
  },
);

const agent = new Robota({
  name: 'ToolAgent',
  aiProviders: [provider],
  defaultModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' }, // see CLAUDE_MODELS for available model IDs
  tools: [calculatorTool],
});

const response = await agent.run('What is 42 * 17?');
```

### Use the SDK (agent-sdk)

```typescript
import { createQuery } from '@robota-sdk/agent-sdk';
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';

const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! });
const query = createQuery({ provider });

const response = await query('List all TypeScript files in src/');
```

### Use the CLI (agent-cli)

```bash
npm install -g @robota-sdk/agent-cli
robota                              # Interactive TUI
robota -p "Explain this project"    # Print mode
```

## Why Robota SDK?

- **Type-Safe**: Strict TypeScript with zero `any` in production code
- **Multi-Provider**: Anthropic Claude, OpenAI, DeepSeek, Gemini, Gemma, Qwen, and OpenAI-compatible endpoints — same API, seamless switching
- **Tool Calling**: Zod-based schema validation for type-safe function calls
- **Subagents**: Runtime-managed background jobs, transcripts, and `/agent` command orchestration
- **Plugin System**: Extensible lifecycle hooks for logging, analytics, error handling
- **Streaming**: Real-time text delta streaming from all providers
- **CLI Ready**: Built-in coding assistant CLI with permission system and context management

## Architecture

```
agent-cli              ← Interactive terminal AI coding assistant
agent-command          ← All slash command modules (/agent, /help, /provider, /skills, /plugin, …)
agent-transport        ← Consolidated transport package (sub-paths: /tui, /headless, /http, /ws, /mcp)
  ↓ (product/transport layers consume)
agent-sdk              ← Assembly layer: InteractiveSession, config, context, createQuery()
  ↓
agent-sessions         ← Session lifecycle: permissions, hooks, compaction
agent-runtime          ← Background task and subagent lifecycle primitives
agent-tools            ← Tool infrastructure + 8 built-in tools + sandbox ports/manifests
agent-provider         ← Consolidated AI provider package (sub-paths: /anthropic, /openai, /gemini, /google, /gemma, /qwen, /deepseek, /bytedance)
  ↓
agent-core             ← Foundation: Robota engine, abstractions, plugins
```

## Packages

| Package                                                      | Description                                                                                                                                                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`@robota-sdk/agent-core`](./packages/agent-core/)           | Core agent runtime, abstractions, and plugin system                                                                                                                                              |
| [`@robota-sdk/agent-tools`](./packages/agent-tools/)         | Tool registry, FunctionTool, built-in tools, sandbox ports/manifests                                                                                                                             |
| [`@robota-sdk/agent-sessions`](./packages/agent-sessions/)   | Session with permissions, hooks, and compaction                                                                                                                                                  |
| [`@robota-sdk/agent-runtime`](./packages/agent-runtime/)     | Background task and subagent lifecycle primitives                                                                                                                                                |
| [`@robota-sdk/agent-sdk`](./packages/agent-sdk/)             | Assembly layer with config/context loading and createQuery()                                                                                                                                     |
| [`@robota-sdk/agent-command`](./packages/agent-command/)     | Consolidated slash command package — all 20 command modules (`/agent`, `/help`, `/provider`, `/skills`, `/plugin`, `/model`, `/mode`, and more)                                                  |
| [`@robota-sdk/agent-provider`](./packages/agent-provider/)   | Consolidated AI provider package (Anthropic, OpenAI, Gemini, DeepSeek, Gemma, Qwen, ByteDance) — use sub-paths: `/anthropic`, `/openai`, `/gemini`, `/deepseek`, `/gemma`, `/qwen`, `/bytedance` |
| [`@robota-sdk/agent-cli`](./packages/agent-cli/)             | Interactive terminal AI coding assistant                                                                                                                                                         |
| [`@robota-sdk/agent-transport`](./packages/agent-transport/) | Consolidated transport package — TUI (`/tui`), headless (`/headless`), HTTP (`/http`), WebSocket (`/ws`), MCP (`/mcp`) in one package                                                            |

## Documentation

- [Getting Started](./getting-started/) — Installation and first steps
- [Guide](./guide/) — Architecture, building agents, SDK, CLI
- [Release Notes: 2026-05-02](./guide/release-2026-05-02.md) — Beta.59 snapshot, CI/deploy build reuse, and npm dist-tag status
- [Examples](./examples/) — Working code samples
- [Development](./development/) — Contributing and monorepo setup

## Installation

```bash
# Core — build custom agents
npm install @robota-sdk/agent-core

# Provider (all providers in one package — pick the peer deps for your chosen provider)
npm install @robota-sdk/agent-provider
# + @anthropic-ai/sdk   for /anthropic
# + openai              for /openai
# + @google/genai       for /gemini or /google

# Tools — FunctionTool, Zod tools, built-in CLI tools
npm install @robota-sdk/agent-tools

# SDK — assembly layer with createQuery() and InteractiveSession
npm install @robota-sdk/agent-sdk

# Command modules — all slash commands in one package
npm install @robota-sdk/agent-command

# Transport (TUI, headless, HTTP, WebSocket, MCP — all in one package)
npm install @robota-sdk/agent-transport

# CLI — terminal AI coding assistant
npm install -g @robota-sdk/agent-cli
```

## License

MIT
