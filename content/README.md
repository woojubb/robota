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

const response = await agent.run('Explain TypeScript generics.');
console.log(response);
```

### Add Tools

```typescript
import { Robota } from '@robota-sdk/agent-core';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';
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
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

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
- **Multi-Provider**: Anthropic Claude, OpenAI, Gemini, Gemma, Qwen, and OpenAI-compatible endpoints — same API, seamless switching
- **Tool Calling**: Zod-based schema validation for type-safe function calls
- **Subagents**: Runtime-managed background jobs, transcripts, and batch Agent tool requests
- **Plugin System**: Extensible lifecycle hooks for logging, analytics, error handling
- **Streaming**: Real-time text delta streaming from all providers
- **CLI Ready**: Built-in coding assistant CLI with permission system and context management

## Architecture

```
agent-cli              ← Interactive terminal AI coding assistant
agent-command-agent    ← /agent command module for background subagent control
agent-transport-http   ← HTTP transport (Hono; Cloudflare Workers / Node.js / Lambda)
agent-transport-mcp    ← MCP transport (Model Context Protocol server)
agent-transport-ws     ← WebSocket transport (framework-agnostic)
agent-transport-headless ← Non-interactive transport for text/json/stream-json output
  ↓ (all five consume)
agent-sdk              ← Assembly layer: InteractiveSession, config, context, createQuery()
  ↓
agent-sessions         ← Session lifecycle: permissions, hooks, compaction
agent-runtime          ← Background task and subagent lifecycle primitives
agent-tools            ← Tool infrastructure + 8 built-in tools
agent-provider-*       ← AI provider implementations (anthropic, openai, gemini, google, gemma, qwen)
  ↓
agent-core             ← Foundation: Robota engine, abstractions, plugins
```

## Packages

| Package                                                                                        | Description                                                            |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [`@robota-sdk/agent-core`](./packages/agent-core/)                                             | Core agent runtime, abstractions, and plugin system                    |
| [`@robota-sdk/agent-tools`](./packages/agent-tools/)                                           | Tool registry, FunctionTool, and 8 built-in tools                      |
| [`@robota-sdk/agent-sessions`](./packages/agent-sessions/)                                     | Session with permissions, hooks, and compaction                        |
| [`@robota-sdk/agent-runtime`](./packages/agent-runtime/)                                       | Background task and subagent lifecycle primitives                      |
| [`@robota-sdk/agent-sdk`](./packages/agent-sdk/)                                               | Assembly layer with config/context loading and createQuery()           |
| [`@robota-sdk/agent-command-agent`](./packages/agent-command-agent/)                           | `/agent` command module for background subagent jobs                   |
| [`@robota-sdk/agent-provider-anthropic`](./packages/agent-provider-anthropic/)                 | Anthropic Claude provider                                              |
| [`@robota-sdk/agent-provider-openai`](./packages/agent-provider-openai/)                       | OpenAI provider                                                        |
| [`@robota-sdk/agent-provider-gemini`](./packages/agent-provider-gemini/)                       | Canonical Google Gemini provider                                       |
| [`@robota-sdk/agent-provider-google`](./packages/agent-provider-google/)                       | Gemini compatibility wrapper for legacy Google imports/settings        |
| [`@robota-sdk/agent-provider-gemma`](./packages/agent-provider-gemma/)                         | Gemma-family local provider for LM Studio/OpenAI-compatible endpoints  |
| [`@robota-sdk/agent-provider-openai-compatible`](./packages/agent-provider-openai-compatible/) | Reusable OpenAI-compatible transport primitives                        |
| [`@robota-sdk/agent-provider-qwen`](./packages/agent-provider-qwen/)                           | Qwen/DashScope provider with optional provider-side web tools          |
| [`@robota-sdk/agent-cli`](./packages/agent-cli/)                                               | Interactive terminal AI coding assistant                               |
| [`@robota-sdk/agent-transport-headless`](./packages/agent-transport-headless/)                 | Non-interactive text/json/stream-json transport                        |
| [`@robota-sdk/agent-transport-http`](./packages/agent-transport-http/)                         | HTTP/REST transport adapter (Hono; Cloudflare Workers / Node / Lambda) |
| [`@robota-sdk/agent-transport-mcp`](./packages/agent-transport-mcp/)                           | MCP transport adapter (Model Context Protocol server)                  |
| [`@robota-sdk/agent-transport-ws`](./packages/agent-transport-ws/)                             | WebSocket transport adapter (framework-agnostic)                       |

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

# Provider
npm install @robota-sdk/agent-provider-anthropic @anthropic-ai/sdk
npm install @robota-sdk/agent-provider-openai openai
npm install @robota-sdk/agent-provider-gemini @google/genai
npm install @robota-sdk/agent-provider-google @google/genai
npm install @robota-sdk/agent-provider-qwen
npm install @robota-sdk/agent-provider-gemma
npm install @robota-sdk/agent-provider-openai-compatible

# Tools — FunctionTool, Zod tools, built-in CLI tools
npm install @robota-sdk/agent-tools

# SDK — assembly layer with createQuery() and InteractiveSession
npm install @robota-sdk/agent-sdk

# Command module — /agent background jobs
npm install @robota-sdk/agent-command-agent

# Transports
npm install @robota-sdk/agent-transport-headless
npm install @robota-sdk/agent-transport-http
npm install @robota-sdk/agent-transport-mcp
npm install @robota-sdk/agent-transport-ws

# CLI — terminal AI coding assistant
npm install -g @robota-sdk/agent-cli
```

## License

MIT
