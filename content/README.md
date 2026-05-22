---
layout: home
title: Robota SDK
description: The open-source alternative to Claude Code. Multi-provider AI agent SDK and CLI — TypeScript-native, self-hostable.
lang: en-US
---

# Robota SDK

**The open-source alternative to Claude Code.** Multi-provider, TypeScript-native, self-hostable.

[![npm version](https://img.shields.io/npm/v/@robota-sdk/agent-core?label=npm)](https://www.npmjs.com/package/@robota-sdk/agent-core)
[![npm downloads](https://img.shields.io/npm/dm/@robota-sdk/agent-cli?label=downloads)](https://www.npmjs.com/package/@robota-sdk/agent-cli)
[![GitHub stars](https://img.shields.io/github/stars/woojubb/robota?style=social)](https://github.com/woojubb/robota)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)

**[→ 2-minute CLI install](#installation)** &nbsp;|&nbsp; **[→ Build your first agent](./getting-started/)** &nbsp;|&nbsp; **[→ Try Playground](https://play.robota.io/playground)**

---

## Overview

Robota SDK ships three layers you can use independently or together:

- **CLI** (`agent-cli`) — A ready-to-use AI coding assistant in your terminal. Install and run immediately, no code required.
- **Assembly Layer** (`agent-framework`) — A programmable interface for embedding the same assistant capabilities into your own scripts, tools, or workflows.
- **Agent Library** (`agent-core`, `agent-tools`, `agent-session`, and providers) — Low-level building blocks for constructing any AI agent system from scratch.

The CLI is built on top of the Assembly Layer. The Assembly Layer is assembled from the Agent Library. You can enter at any layer.

## Robota vs Alternatives

|                                        | **Robota** |    Claude Code    |     Cursor      | Aider | Cline |
| -------------------------------------- | :--------: | :---------------: | :-------------: | :---: | :---: |
| Multi-provider (one config)            |     ✅     | ❌ Anthropic only |   ❌ limited    |  ✅   |  ✅   |
| BYOK — no subscription required        |     ✅     |        ✅         | ❌ subscription |  ✅   |  ✅   |
| Local model support (Ollama/LM Studio) |     ✅     |        ❌         |       ❌        |  ✅   |  ✅   |
| Embeddable SDK (use in your own app)   |     ✅     |        ❌         |       ❌        |  ❌   |  ❌   |
| Open source (MIT)                      |     ✅     |  ❌ proprietary   | ❌ proprietary  |  ✅   |  ✅   |
| Terminal CLI                           |     ✅     |        ✅         |   ❌ IDE only   |  ✅   |  ✅   |
| Session persistence & resume           |     ✅     |        ✅         |       ✅        |  ❌   |  ❌   |

**[→ Full comparison: features, cost, and when to choose each tool](/compare/)**

## Claude Code Users: Drop-in Compatible

Already using Claude Code? **Robota reads your existing `.claude/` settings without modification.**

- Keep your existing `CLAUDE.md`, `AGENTS.md`, and agent definitions
- Add multi-provider support — switch to OpenAI, Gemini, DeepSeek, or local models
- Self-host your own coding assistant
- No lock-in to Anthropic pricing

```bash
# Your existing .claude/ config just works
npm install -g @robota-sdk/agent-cli
robota  # reads .claude/settings.json, CLAUDE.md, AGENTS.md automatically
```

## Installation

### Just want the CLI?

```bash
npm install -g @robota-sdk/agent-cli
robota
```

### Building a custom agent?

```bash
npm install @robota-sdk/agent-core @robota-sdk/agent-provider @anthropic-ai/sdk
```

### Building an app with multi-turn sessions?

```bash
npm install @robota-sdk/agent-framework @robota-sdk/agent-provider @anthropic-ai/sdk
```

### Need tool calling?

```bash
# Add to any of the above:
npm install @robota-sdk/agent-tools zod
```

## Quick Start

### Use the CLI (2 minutes)

```bash
npm install -g @robota-sdk/agent-cli
robota                              # Interactive TUI
robota -p "Explain this project"    # Print mode
```

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

### Use the Framework (agent-framework)

```typescript
import { createQuery } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';

const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! });
const query = createQuery({ provider });

const response = await query('List all TypeScript files in src/');
```

### Switch Providers — No Code Changes

```typescript
import { OpenAIProvider } from '@robota-sdk/agent-provider/openai';
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';

const agent = new Robota({
  name: 'MultiProviderAgent',
  aiProviders: [
    new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY }),
    new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY }),
  ],
  defaultModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
});

// Switch to OpenAI mid-conversation — same agent logic, zero rewrites
agent.setModel({ provider: 'openai', model: 'gpt-4o' });
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
agent-framework        ← Assembly layer: InteractiveSession, config, context, createQuery()
  ↓
agent-session          ← Session lifecycle: permissions, hooks, compaction
agent-executor         ← Background task and subagent lifecycle primitives
agent-tools            ← Tool infrastructure + 8 built-in tools + sandbox ports/manifests
agent-provider         ← Consolidated AI provider package (sub-paths: /anthropic, /openai, /gemini, /google, /gemma, /qwen, /deepseek, /bytedance)
  ↓
agent-core             ← Foundation: Robota engine, abstractions, plugins
```

## Packages

| Package                                                                  | Description                                                                                                                                                                                      |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`@robota-sdk/agent-core`](./packages/agent-core/)                       | Core agent runtime, abstractions, and plugin system                                                                                                                                              |
| [`@robota-sdk/agent-tools`](./packages/agent-tools/)                     | Tool registry, FunctionTool, built-in tools, sandbox ports/manifests                                                                                                                             |
| [`@robota-sdk/agent-session`](./packages/agent-session/)                 | Session with permissions, hooks, and compaction                                                                                                                                                  |
| [`@robota-sdk/agent-executor`](./packages/agent-executor/)               | Background task and subagent lifecycle primitives                                                                                                                                                |
| [`@robota-sdk/agent-framework`](./packages/agent-framework/)             | Assembly layer with config/context loading, `InteractiveSession`, and `createQuery()`                                                                                                            |
| [`@robota-sdk/agent-command`](./packages/agent-command/)                 | Consolidated slash command package — all 20 command modules (`/agent`, `/help`, `/provider`, `/skills`, `/plugin`, `/model`, `/mode`, and more)                                                  |
| [`@robota-sdk/agent-provider`](./packages/agent-provider/)               | Consolidated AI provider package (Anthropic, OpenAI, Gemini, DeepSeek, Gemma, Qwen, ByteDance) — use sub-paths: `/anthropic`, `/openai`, `/gemini`, `/deepseek`, `/gemma`, `/qwen`, `/bytedance` |
| [`@robota-sdk/agent-cli`](./packages/agent-cli/)                         | Interactive terminal AI coding assistant                                                                                                                                                         |
| [`@robota-sdk/agent-transport`](./packages/agent-transport/)             | Consolidated transport package — TUI (`/tui`), headless (`/headless`), HTTP (`/http`), WebSocket (`/ws`), MCP (`/mcp`) in one package                                                            |
| [`@robota-sdk/agent-subagent-runner`](./packages/agent-subagent-runner/) | Opt-in child-process subagent runner — install only when using `/agent` with child-process isolation                                                                                             |
| [`@robota-sdk/agent-team`](./packages/agent-team/)                       | Multi-agent task delegation for playground and orchestration use cases                                                                                                                           |

## Documentation

- [Getting Started](./getting-started/) — Installation and first steps
- [Guide](./guide/) — Architecture, building agents, SDK, CLI
- [Release Notes: 2026-05-02](./guide/release-2026-05-02.md) — Beta.59 snapshot, CI/deploy build reuse, and npm dist-tag status
- [Examples](./examples/) — Working code samples
- [Development](./development/) — Contributing and monorepo setup

---

## Ready to build?

```bash
npm install -g @robota-sdk/agent-cli && robota
```

[Documentation](./getting-started/) · [Examples](./examples/) · [GitHub](https://github.com/woojubb/robota)

## License

MIT
