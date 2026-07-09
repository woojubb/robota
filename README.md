# Robota — Composable AI Agent Libraries

Robota is a **composable TypeScript library collection for building AI agents** — strict types,
multi-provider, tool calling, and an extensible plugin/event architecture. You assemble agents
from neutral building blocks; `@robota-sdk/agent-cli` (an AI coding assistant) is a **reference
app built from these same libraries**, not the product itself.

> Evaluating with an AI agent? Start at [`llms.txt`](./llms.txt) — the consumer map (identity,
> minimal package set, capability matrix, behavior contracts).

## Quick Start — Embed the Library

The minimal set is three packages: `agent-core` + `agent-provider` + `agent-tools`.

```typescript
import { Robota } from '@robota-sdk/agent-core';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const agent = new Robota({
  name: 'MyAgent',
  aiProviders: [new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY })],
  defaultModel: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
  },
  systemMessage: 'You are a helpful assistant.',
});

const response = await agent.run('Hello!');
```

Any OpenAI-compatible endpoint works too — AI gateways, Azure, vLLM, local servers — via the
OpenAI provider's `baseURL` (see the [quickstart's gateway section](./content/quickstart.md)).

### Higher-level assembly — `createQuery`

`agent-framework` assembles CLI tools, permissions, and config/context loading on top:

```typescript
import { createQuery } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const query = createQuery({
  provider: new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY }),
});
const response = await query('List all TypeScript files in src/');
```

### Reference app — the CLI coding assistant

```bash
# Try the reference product built from these libraries (no install needed)
npx @robota-sdk/agent-cli

# Or install globally
npm install -g @robota-sdk/agent-cli
robota
```

![Robota CLI](https://raw.githubusercontent.com/woojubb/robota/main/content/images/cli-demo.png)

> **Beta**: Robota is currently `3.0.0-beta`. Core features are stable but APIs may change before 1.0. See [CHANGELOG.md](./CHANGELOG.md) for upgrade notes.

> **macOS users**: Korean/CJK IME input may crash macOS Terminal.app. Use **[iTerm2](https://iterm2.com/)** instead. This is a known Ink + Terminal.app issue shared with Claude Code.

## Architecture

Libraries below, products on top. Everything under `packages/` is universal and neutral; apps and
the reference CLI are opinionated assemblies OF the libraries.

```
agent-cli                       ← Reference product: terminal AI coding assistant
agent-transport-{tui,http,ws,mcp} ← Standalone transports; agent-transport = lean core
  ↓
agent-framework        ← Assembly layer: InteractiveSession, createQuery(), config/context loading
  ↓
agent-session          ← Session lifecycle: permissions, hooks, compaction
agent-tools            ← Tool infrastructure + 9 built-in tools
agent-provider         ← Protocol clients (sub-paths: /anthropic, /openai, /gemini, …)
agent-plugin           ← 8 consolidated lifecycle plugins
  ↓
agent-core             ← Foundation: Robota engine, abstractions, plugin contracts
```

## Packages

**Start here (embedding)** — the minimal set:

| Package                                                                                                                      | Description                                                         |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| [`@robota-sdk/agent-core`](https://www.npmjs.com/package/@robota-sdk/agent-core)                                             | `Robota` engine: run/runStream, history, structured output, plugins |
| [`@robota-sdk/agent-provider-anthropic`](https://www.npmjs.com/package/@robota-sdk/agent-provider-anthropic)                 | Anthropic provider client                                           |
| [`@robota-sdk/agent-provider-openai`](https://www.npmjs.com/package/@robota-sdk/agent-provider-openai)                       | OpenAI provider client                                              |
| [`@robota-sdk/agent-provider-openai-compatible`](https://www.npmjs.com/package/@robota-sdk/agent-provider-openai-compatible) | OpenAI-compatible clients (DeepSeek, Qwen, Gemma)                   |
| [`@robota-sdk/agent-provider-gemini`](https://www.npmjs.com/package/@robota-sdk/agent-provider-gemini)                       | Gemini / Google provider client                                     |
| [`@robota-sdk/agent-provider-bytedance`](https://www.npmjs.com/package/@robota-sdk/agent-provider-bytedance)                 | ByteDance media/video provider client                               |
| [`@robota-sdk/agent-tools`](https://www.npmjs.com/package/@robota-sdk/agent-tools)                                           | Tool registry, zod-validated function tools, 9 built-in tools       |

**App assembly** — add when you need sessions, permissions, or plugins:

| Package                                                                                                    | Description                                                                        |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [`@robota-sdk/agent-framework`](https://www.npmjs.com/package/@robota-sdk/agent-framework)                 | Assembly layer with config/context loading and `createQuery()`                     |
| [`@robota-sdk/agent-session`](https://www.npmjs.com/package/@robota-sdk/agent-session)                     | Session with permissions, hooks, and compaction                                    |
| [`@robota-sdk/agent-plugin`](https://www.npmjs.com/package/@robota-sdk/agent-plugin)                       | 8 consolidated lifecycle plugins (logging, usage, limits, performance, webhook, …) |
| [`@robota-sdk/agent-executor`](https://www.npmjs.com/package/@robota-sdk/agent-executor)                   | Execution engine for the agentic loop                                              |
| [`@robota-sdk/agent-subagent-runner`](https://www.npmjs.com/package/@robota-sdk/agent-subagent-runner)     | Subagent dispatch runner                                                           |
| [`@robota-sdk/agent-session-analytics`](https://www.npmjs.com/package/@robota-sdk/agent-session-analytics) | Session log timing analysis                                                        |
| `@robota-sdk/agent-testing` _(internal, not published)_                                                    | Real-PTY E2E test harness                                                          |

**Products & transports** — the reference CLI and its interaction surfaces:

| Package                                                                                                        | Description                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@robota-sdk/agent-cli`](https://www.npmjs.com/package/@robota-sdk/agent-cli)                                 | Reference product: interactive terminal AI coding assistant. Self-contained bundle; includes the private DAG/workflow subsystem surfaced as `/workflows create "<natural language>"` (authors a workflow, runs it, saves it to `.workflows/<name>.json`) |
| [`@robota-sdk/agent-command`](https://www.npmjs.com/package/@robota-sdk/agent-command)                         | Slash command modules (`/agent`, `/help`, `/provider`, `/preset`, `/schedule`, …)                                                                                                                                                                        |
| [`@robota-sdk/agent-preset`](https://www.npmjs.com/package/@robota-sdk/agent-preset)                           | Named agent profiles (preset system)                                                                                                                                                                                                                     |
| [`@robota-sdk/agent-interface-transport`](https://www.npmjs.com/package/@robota-sdk/agent-interface-transport) | Transport type contracts (zero deps)                                                                                                                                                                                                                     |
| [`@robota-sdk/agent-interface-tui`](https://www.npmjs.com/package/@robota-sdk/agent-interface-tui)             | TUI interaction type contracts (zero deps)                                                                                                                                                                                                               |
| [`@robota-sdk/agent-transport`](https://www.npmjs.com/package/@robota-sdk/agent-transport)                     | Lean transport core (`/headless`, `/testing`, `/programmatic`)                                                                                                                                                                                           |
| [`@robota-sdk/agent-transport-tui`](https://www.npmjs.com/package/@robota-sdk/agent-transport-tui)             | TUI transport (Ink/React)                                                                                                                                                                                                                                |
| [`@robota-sdk/agent-transport-http`](https://www.npmjs.com/package/@robota-sdk/agent-transport-http)           | HTTP/REST transport                                                                                                                                                                                                                                      |
| [`@robota-sdk/agent-transport-ws`](https://www.npmjs.com/package/@robota-sdk/agent-transport-ws)               | WebSocket transport                                                                                                                                                                                                                                      |
| [`@robota-sdk/agent-transport-mcp`](https://www.npmjs.com/package/@robota-sdk/agent-transport-mcp)             | MCP transport                                                                                                                                                                                                                                            |

## Documentation

Full documentation at **[robota.io](https://robota.io)**

- [Getting Started](https://robota.io/getting-started/)
- [Building Agents](https://robota.io/guide/building-agents.html)
- [SDK Usage](https://robota.io/guide/sdk.html)
- [CLI Reference](https://robota.io/guide/cli.html)
- [Examples](https://robota.io/examples/)

## Repository Scope

This repository owns the Robota agent SDK, providers, transports, the reference CLI, and related apps.

It also hosts the **DAG / workflow subsystem** (`packages/dag-*`, `packages/agent-command-workflows`):
this is a **private, unpublished** line — none of these packages are released to npm on their own.
Instead, the whole subsystem is **bundled into `@robota-sdk/agent-cli`** (INFRA-028: agent-cli
publishes as a self-contained bundle) and surfaced to users through the `/workflows` command. It is
developed here alongside the agent libraries but is not a separately published `@robota-sdk/dag-*` set.

## Development

```bash
pnpm install
pnpm build
pnpm test
```

Node.js 22+ required. See [Development Guide](https://robota.io/development/) for details.

## License

Robota is dual-licensed under the [GNU AGPL-3.0](LICENSE) or a [commercial license](COMMERCIAL.md). See [LICENSING.md](LICENSING.md).
