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
[![License: AGPL-3.0 OR Commercial](https://img.shields.io/badge/license-AGPL--3.0%20OR%20Commercial-blue)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)

**[→ 2-minute CLI install](#installation)** &nbsp;|&nbsp; **[→ Build your first agent](./getting-started/)** &nbsp;|&nbsp; **[→ Try Playground](https://play.robota.io/playground)**

> **Beta software** — Robota SDK is currently in `3.0.0-beta`. Core features are stable but APIs may change before the 1.0 stable release. See the [changelog](./changelog/) for upgrade notes. [Report issues](https://github.com/woojubb/robota/issues).

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
| Open source (AGPL-3.0)                 |     ✅     |  ❌ proprietary   | ❌ proprietary  |  ✅   |  ✅   |
| Terminal CLI                           |     ✅     |        ✅         |   ❌ IDE only   |  ✅   |  ✅   |
| Session persistence & resume           |     ✅     |        ✅         |       ✅        |  ❌   |  ❌   |

**[→ Full comparison on robota.io](https://robota.io/compare/)**

## No API Key Needed — Run Local Models

Robota works offline with [Ollama](https://ollama.com) or [LM Studio](https://lmstudio.ai). Your code and prompts never leave your machine.

```bash
# 1. Start Ollama
ollama pull llama3.2 && ollama serve

# 2. Configure Robota to use it
robota --configure
# Select "Local (OpenAI-compatible)", set URL: http://localhost:11434/v1

# 3. Run with no API key
robota
```

**→ [Full local LLM setup guide](/guide/local-llm)**

---

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
  },
  systemMessage: 'You are a helpful assistant.',
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
import { Robota } from '@robota-sdk/agent-core';
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
- **Workflows**: Author DAG workflows from a plain-English description with `/workflows create`, then save and re-run them
- **Plugin System**: Extensible lifecycle hooks for logging, analytics, error handling
- **Streaming**: Real-time text delta streaming from all providers
- **CLI Ready**: Built-in coding assistant CLI with permission system and context management

## Architecture

```
agent-cli              ← Interactive terminal AI coding assistant
agent-command          ← All slash command modules (/agent, /help, /provider, /skills, /plugin, …)
agent-transport        ← Lean transport core (sub-paths: /headless, /testing)
agent-transport-tui    ← TUI transport (Ink/React) — standalone package
agent-transport-http   ← HTTP/REST transport — standalone package
agent-transport-ws     ← WebSocket transport — standalone package
agent-transport-mcp    ← MCP transport — standalone package
  ↓ (product/transport layers consume)
agent-framework        ← Assembly layer: InteractiveSession, config, context, createQuery()
  ↓
agent-session          ← Session lifecycle: permissions, hooks, compaction
agent-executor         ← Background task and subagent lifecycle primitives
agent-tools            ← Tool infrastructure + built-in tools (Shell/Read/Write/Edit/Glob/Grep/Web*/AskUserQuestion) + sandbox ports/manifests
agent-provider         ← Consolidated AI provider package (sub-paths: /anthropic, /openai, /gemini, /google, /gemma, /qwen, /deepseek, /bytedance)
  ↓
agent-core             ← Foundation: Robota engine, abstractions, plugins
```

## Packages

| Package                                                                      | Description                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@robota-sdk/agent-core`](./packages/agent-core/)                           | Core agent runtime, abstractions, and plugin system                                                                                                                                                                                    |
| [`@robota-sdk/agent-tools`](./packages/agent-tools/)                         | Tool registry, FunctionTool, built-in tools, sandbox ports/manifests                                                                                                                                                                   |
| [`@robota-sdk/agent-session`](./packages/agent-session/)                     | Session with permissions, hooks, and compaction                                                                                                                                                                                        |
| [`@robota-sdk/agent-session-analytics`](./packages/agent-session-analytics/) | Session log timing analysis (LLM wait vs. tool/code time) — new in beta.76                                                                                                                                                             |
| [`@robota-sdk/agent-executor`](./packages/agent-executor/)                   | Background task and subagent lifecycle primitives                                                                                                                                                                                      |
| [`@robota-sdk/agent-framework`](./packages/agent-framework/)                 | Assembly layer with config/context loading, `InteractiveSession`, and `createQuery()`                                                                                                                                                  |
| [`@robota-sdk/agent-command`](./packages/agent-command/)                     | Consolidated slash command package — all 20 command modules (`/agent`, `/help`, `/provider`, `/skills`, `/plugin`, `/model`, `/mode`, and more)                                                                                        |
| [`@robota-sdk/agent-provider`](./packages/agent-provider/)                   | Consolidated AI provider package (Anthropic, OpenAI, Gemini, DeepSeek, Gemma, Qwen, ByteDance) — use sub-paths: `/anthropic`, `/openai`, `/gemini`, `/deepseek`, `/gemma`, `/qwen`, `/bytedance`                                       |
| [`@robota-sdk/agent-cli`](./packages/agent-cli/)                             | Interactive terminal AI coding assistant                                                                                                                                                                                               |
| [`@robota-sdk/agent-transport`](./packages/agent-transport/)                 | Lean transport core — headless (`/headless`) + testing (`/testing`) sub-paths. Protocol transports are standalone packages (since beta.76): `agent-transport-tui`, `agent-transport-http`, `agent-transport-ws`, `agent-transport-mcp` |
| [`@robota-sdk/agent-subagent-runner`](./packages/agent-subagent-runner/)     | Opt-in child-process subagent runner — install only when using `/agent` with child-process isolation                                                                                                                                   |

## Documentation

- [Getting Started](./getting-started/) — Installation and first steps
- [Guide](./guide/) — Architecture, building agents, SDK, CLI
- [Changelog](./changelog/) — What's new in each release
- [Examples](./examples/) — Working code samples
- [Development](./development/) — Contributing and monorepo setup

---

## Ready to build?

```bash
npm install -g @robota-sdk/agent-cli && robota
```

[Documentation](./getting-started/) · [Examples](./examples/) · [GitHub](https://github.com/woojubb/robota)

## License

Robota is dual-licensed under the [GNU AGPL-3.0](../LICENSE) or a [commercial license](../COMMERCIAL.md). See [LICENSING.md](../LICENSING.md).
