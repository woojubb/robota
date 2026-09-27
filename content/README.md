---
layout: home
title: Robota SDK
description: Composable TypeScript libraries for building AI agents — strict types, multi-provider, tool calling, plugins and events. The Robota CLI is a reference app built from them.
lang: en-US
---

# Robota SDK

Robota is a collection of composable TypeScript libraries for building AI agents: strict types, one
provider interface across model vendors, tool calling with runtime-validated arguments, and a plugin
and event architecture. You install only the packages your agent needs. The `robota` command
(`@robota-sdk/agent-cli`, an AI coding assistant for the terminal) is a reference app built from the
same libraries.

[![npm version](https://img.shields.io/npm/v/@robota-sdk/agent-core?label=npm)](https://www.npmjs.com/package/@robota-sdk/agent-core)
[![npm downloads](https://img.shields.io/npm/dm/@robota-sdk/agent-cli?label=downloads)](https://www.npmjs.com/package/@robota-sdk/agent-cli)
[![GitHub stars](https://img.shields.io/github/stars/woojubb/robota?style=social)](https://github.com/woojubb/robota)
[![License: AGPL-3.0 OR Commercial](https://img.shields.io/badge/license-AGPL--3.0%20OR%20Commercial-blue)](../LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)

> **Beta** — the packages are published as `3.0.0-beta` versions. APIs may still change before a
> stable release. [Report issues](https://github.com/woojubb/robota/issues).

## Where to start

- [5-Minute Quick Start](./quickstart.md) — the shortest path to a running agent or CLI
- [Getting Started](./getting-started/README.md) — install, choose a provider, build a first agent step
  by step
- [Guide](./guide/README.md) — architecture, SDK, CLI, providers, permissions, sessions
- [Examples](./examples/README.md) — focused walkthroughs of single tasks
- [Packages](/packages/) — every package, what it owns, and whether it is published on npm
- [Plugin Directory](./plugins/README.md) — lifecycle plugins and how to list your own
- [Running Robota in GitHub Actions](./integrations/github-action.md)
- [Changelog](./changelog/README.md) — highlights of past releases
- [Development](./development/README.md) — working on this monorepo

## Install

Published packages need Node.js 22.12 or later.

```bash
# An agent: the core engine and one provider package
npm install @robota-sdk/agent-core @robota-sdk/agent-provider-anthropic

# Function tools with Zod schemas (agent-tools uses Zod 3)
npm install @robota-sdk/agent-tools zod@3

# Sessions with built-in tools, permission modes, hooks and project context
npm install @robota-sdk/agent-framework @robota-sdk/agent-provider-anthropic

# The reference CLI
npm install -g @robota-sdk/agent-cli
```

## A first agent

```typescript
import { Robota } from '@robota-sdk/agent-core';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const agent = new Robota({
  name: 'Assistant',
  aiProviders: [new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY })],
  defaultModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  systemMessage: 'You are a helpful assistant.',
});

console.log(await agent.run('Explain TypeScript generics in two sentences.'));
```

`aiProviders` can hold several providers, and `agent.setModel({ provider, model })` switches between
them while keeping the conversation. [Getting Started](./getting-started/README.md) continues with
tools, provider switching and sessions.

## How the packages fit together

The packages form three layers. You can start at any of them.

- **Libraries** — [`agent-core`](../packages/agent-core/docs/README.md) (the `Robota` engine and the
  provider, tool, plugin and permission contracts), one `agent-provider-<vendor>` package per model
  vendor, [`agent-tools`](../packages/agent-tools/docs/README.md) (function tools and the built-in tool
  factories), [`agent-plugin`](../packages/agent-plugin/docs/README.md) (lifecycle plugins) and
  [`agent-mcp`](../packages/agent-mcp/docs/README.md) (MCP client).
- **Assembly** — [`agent-framework`](../packages/agent-framework/docs/README.md) combines the libraries
  into sessions: `InteractiveSession`, `createQuery()` and `createAgentRuntime()`, with built-in tools,
  permission modes, hooks, context loading and persistence.
- **Reference app** — [`agent-cli`](../packages/agent-cli/docs/README.md), the `robota` terminal coding
  assistant, built on the assembly layer with a terminal UI, slash commands and transports.

The [architecture guide](./guide/architecture.md) and [ARCHITECTURE.md](../ARCHITECTURE.md) describe the
layers in full. The [packages index](/packages/) lists every package.

## Providers

| Package                                        | Covers                                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `@robota-sdk/agent-provider-anthropic`         | Anthropic Claude                                                                                              |
| `@robota-sdk/agent-provider-openai`            | OpenAI, and any OpenAI-compatible endpoint through `baseURL` (AI gateways, Azure OpenAI, vLLM, local servers) |
| `@robota-sdk/agent-provider-gemini`            | Google Gemini, including image generation                                                                     |
| `@robota-sdk/agent-provider-openai-compatible` | DeepSeek, Qwen, and local servers such as Ollama, LM Studio or llama.cpp                                      |
| `@robota-sdk/agent-provider-bytedance`         | ByteDance ModelArk video generation (not a chat provider)                                                     |

The [Providers Reference](./guide/providers.md) covers each one. To run a local model with no API key,
see [Local LLM Setup](./guide/local-llm.md).

## The reference CLI

```bash
npx @robota-sdk/agent-cli          # try it without installing
npm install -g @robota-sdk/agent-cli
robota                              # interactive terminal UI
robota -p "Explain this project"    # print mode: answer once, then exit
```

On first run, the CLI asks for a provider and an API key, or offers a local model. In a Git repository
you have not trusted yet, the terminal UI asks whether to trust it before loading anything from the
project, and print mode refuses to start until you run `robota trust --yes`. In a trusted workspace the
CLI reads the project's `AGENTS.md` and the Claude Code conventions: `CLAUDE.md`,
`.claude/settings.json`, `.claude/agents/`, `.claude/skills/` and `.claude/commands/`. The [CLI reference](./guide/cli.md) covers
flags, slash commands and permission modes. How the CLI compares with other coding assistants:
[robota.io/en/compare](https://robota.io/en/compare).

## License

Robota is dual-licensed under the [GNU AGPL-3.0](../LICENSE) or a [commercial license](../COMMERCIAL.md).
See [LICENSING.md](../LICENSING.md).
