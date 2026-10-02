# Robota — An adaptable foundation for AI agents

**Our agents develop and advance our agents.** We are building toward agents that can carry their
own development forward on a dependable, adaptable foundation. [VISION.md](./VISION.md) defines
this direction; reliable autonomous self-evolution remains an ambition to build and demonstrate.

Today, Robota provides composable TypeScript libraries with strict types, multi-provider
support, tool calling and a plugin/event architecture. The SDK and maintained interfaces belong to
the same environment. `@robota-sdk/agent-cli` delivers a terminal agent with coding capabilities,
assembled from the same neutral building blocks you can embed in your own application.

> Evaluating with an AI agent? Start at [`llms.txt`](./llms.txt) — the consumer map (minimal
> package set, capabilities, behavior contracts).

## Quick Start — Embed the Library

The minimal set is `agent-core` plus one `agent-provider-<vendor>` package; add `agent-tools` when the
agent calls tools. Published packages need Node.js 22.12 or later.

```bash
npm install @robota-sdk/agent-core @robota-sdk/agent-provider-anthropic
```

```typescript
import { ConversationAgent } from '@robota-sdk/agent-core';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const agent = new ConversationAgent({
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

[Runtime migration and compatibility](./content/guide/runtime-migration.md)

### Add a tool

`createZodFunctionTool` validates the model's arguments against a zod schema before your function
runs, and types the function's input from that schema:

```bash
npm install @robota-sdk/agent-tools zod@3
```

```typescript
import { ConversationAgent } from '@robota-sdk/agent-core';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';
import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import { z } from 'zod';

const getWeather = createZodFunctionTool(
  'getWeather',
  'Get the current weather for a city',
  z.object({ city: z.string() }),
  async ({ city }) => `It is sunny in ${city}.`,
);

const agent = new ConversationAgent({
  name: 'WeatherAgent',
  aiProviders: [new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY })],
  defaultModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  tools: [getWeather],
});

const answer = await agent.run('What is the weather in Seoul?');
```

Any OpenAI-compatible endpoint works too — AI gateways, Azure, vLLM, local servers — through the
OpenAI provider's `baseURL` (see the [providers guide](./content/guide/providers.md)).

### Higher-level assembly — `createQuery`

`agent-framework` assembles the built-in tools, permissions, and config/context loading on top:

```typescript
import { createQuery } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const query = createQuery({
  provider: new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY }),
});
const response = await query('List all TypeScript files in src/');
```

`createQuery` runs in the `default` permission mode: with nobody to approve, a tool call that would
ask for permission is denied. See the [SDK guide](./content/guide/sdk.md) for sessions, permission
modes, and `InteractiveSession`.

### Use the CLI coding assistant

```bash
# Try the CLI built from these libraries (no install needed)
npx @robota-sdk/agent-cli

# Or install globally
npm install -g @robota-sdk/agent-cli
__PRODUCT_CLI_NAME__
```

**No Node.js? Install the standalone binary** (macOS / Linux / Windows — nothing else required):

```bash
# macOS / Linux
curl -fsSL __PROJECT_REPOSITORY_RAW_URL__/main/scripts/install.sh | bash
```

```powershell
# Windows PowerShell
irm __PROJECT_REPOSITORY_RAW_URL__/main/scripts/install.ps1 | iex
```

The installer detects your OS and CPU, downloads the matching binary from the latest
[GitHub release](__PROJECT_REPOSITORY_URL__/releases), verifies its SHA-256 checksum, and
installs `__PRODUCT_CLI_NAME__` to `~/.robota/bin` (on Windows, `%LOCALAPPDATA%\robota\bin`, which it adds to your
user PATH; on macOS/Linux it prints the `PATH` line to add if needed). To install a specific release,
set `PRODUCT_VERSION` to its tag, e.g. `curl -fsSL … | PRODUCT_VERSION=v<version> bash`. Binaries are
unsigned — macOS and Windows may warn.


> **Beta**: Robota is currently `3.0.0-beta`. APIs may change before 1.0. See
> [CHANGELOG.md](./CHANGELOG.md) for upgrade notes.

> **macOS users**: Korean/CJK IME input may crash macOS Terminal.app. Use
> **[iTerm2](https://iterm2.com/)** instead.

## What You Can Build With It

- **Multi-provider agents with fallback** — Anthropic, OpenAI, Google Gemini, DeepSeek, Qwen and
  Gemma, plus any OpenAI-compatible endpoint. `FallbackProvider` (`agent-framework`) moves a turn to
  another model when the primary is overloaded or failing; the CLI exposes it as `--fallback-model`.
  [Providers guide](./content/guide/providers.md)
- **Tools with runtime validation** — zod-validated function tools, plus built-in coding tools
  (shell, read, write, edit, glob, grep, web fetch and search).
  [Building agents](./content/guide/building-agents.md)
- **Permissions, hooks and sandboxing** — permission modes (`plan`, `default`, `acceptEdits`,
  `bypassPermissions`, `auto`), allow/ask/deny rules, lifecycle hooks, and an OS-level sandbox for
  shell commands (bubblewrap on Linux/WSL2, Seatbelt on macOS).
  [Permissions and hooks](./content/guide/permissions-and-hooks.md)
- **Sessions and a workspace daemon** — saved, resumable and forkable sessions; background
  sessions that outlive the terminal; and one long-lived runtime per workspace
  (`__PRODUCT_CLI_NAME__ daemon start`) that the desktop app and the full terminal UI (`__PRODUCT_CLI_NAME__ --attach`) connect to.
  [Sessions and daemon](./content/guide/sessions-and-daemon.md)
- **MCP, both directions** — connect to MCP servers (stdio or remote, including OAuth sign-in) with
  `agent-mcp`, and serve an Robota session as an MCP server with `agent-transport-mcp`
  (`__PRODUCT_CLI_NAME__ mcp serve`). [MCP guide](./content/guide/mcp.md)
- **Devices and remote control** — link your own devices, send messages and files between
  sessions, hand a session off to another device, and co-drive a session from a browser over
  pairing-gated peer-to-peer WebRTC. [Devices and remote](./content/guide/devices-and-remote.md)
- **Plugins and events** — lifecycle plugins for conversation history, logging, usage, limits,
  performance, error handling, execution analytics and webhooks, on the same plugin contract you can
  implement yourself. [Plugins guide](./content/guide/plugins.md)

## Architecture

Libraries below, products on top. Everything under `packages/` is universal and neutral; apps and
the CLI are opinionated assemblies of the libraries. Each layer builds only on the layers
below it — see [ARCHITECTURE.md](./ARCHITECTURE.md) for the full picture.

```
agent-cli                              ← Product interface: terminal AI coding assistant
agent-product · pack-coding            ← Product composition: profiles and capability packs
agent-command · agent-preset           ← Slash commands, presets and output styles
agent-ui-terminal                      ← Terminal UI (React + Ink)
agent-transport-{ws,http,mcp,webrtc}   ← Carriers over the shared wire protocol in agent-transport
  ↓
agent-framework                        ← Assembly: InteractiveSession, createQuery(), createAgentRuntime()
  ↓
agent-session · agent-executor         ← Session lifecycle; background tasks and subagents
agent-tools · agent-tool-defaults      ← Tool factories and the default tool set
agent-mcp · agent-plugin               ← MCP client; lifecycle plugins
agent-provider-*                       ← One provider package per vendor
  ↓
agent-interface-*                      ← Type-only contracts shared across layers
agent-core                             ← Foundation: ConversationAgent engine, provider/tool/plugin contracts, permissions
```

## Packages

Every package below is published on npm under `@robota-sdk/`, and all of them share one version.
The [packages index](__PROJECT_DOCS_URL__/en/packages/) on the docs site covers each one.

**Start here (embedding):**

| Package                                                                                                                      | Description                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [`@robota-sdk/agent-core`](https://www.npmjs.com/package/@robota-sdk/agent-core)                                             | `Robota` engine: run/runStream, history, tool calling, structured output, plugins |
| [`@robota-sdk/agent-provider-anthropic`](https://www.npmjs.com/package/@robota-sdk/agent-provider-anthropic)                 | Anthropic (Claude) provider                                                       |
| [`@robota-sdk/agent-provider-openai`](https://www.npmjs.com/package/@robota-sdk/agent-provider-openai)                       | OpenAI provider; any OpenAI-compatible endpoint through `baseURL`                 |
| [`@robota-sdk/agent-provider-openai-compatible`](https://www.npmjs.com/package/@robota-sdk/agent-provider-openai-compatible) | DeepSeek, Qwen and Gemma providers, and the shared OpenAI-compatible protocol     |
| [`@robota-sdk/agent-provider-gemini`](https://www.npmjs.com/package/@robota-sdk/agent-provider-gemini)                       | Google Gemini provider, including image generation                                |
| [`@robota-sdk/agent-provider-bytedance`](https://www.npmjs.com/package/@robota-sdk/agent-provider-bytedance)                 | ByteDance (ModelArk) video-generation provider                                    |
| [`@robota-sdk/agent-tools`](https://www.npmjs.com/package/@robota-sdk/agent-tools)                                           | Zod-validated function tools, built-in tool factories, sandbox ports              |

**App assembly** — sessions, permissions, runtime:

| Package                                                                                                    | Description                                                                                           |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [`@robota-sdk/agent-framework`](https://www.npmjs.com/package/@robota-sdk/agent-framework)                 | Assembly layer: `InteractiveSession`, `createQuery()`, `createAgentRuntime()`, config/context loading |
| [`@robota-sdk/agent-session`](https://www.npmjs.com/package/@robota-sdk/agent-session)                     | `Session`: permission-gated tool execution, hooks, context tracking, compaction, persistence          |
| [`@robota-sdk/agent-executor`](https://www.npmjs.com/package/@robota-sdk/agent-executor)                   | Background task lifecycle, queueing and cancellation; subagent job orchestration                      |
| [`@robota-sdk/agent-subagent-runner`](https://www.npmjs.com/package/@robota-sdk/agent-subagent-runner)     | Optional runner that executes subagents in child processes                                            |
| [`@robota-sdk/agent-tool-defaults`](https://www.npmjs.com/package/@robota-sdk/agent-tool-defaults)         | The SDK's default tool set (`createDefaultTools`)                                                     |
| [`@robota-sdk/agent-builtin-providers`](https://www.npmjs.com/package/@robota-sdk/agent-builtin-providers) | Built-in provider definitions (`createDefaultProviderDefinitions`) and default role models            |
| [`@robota-sdk/agent-mcp`](https://www.npmjs.com/package/@robota-sdk/agent-mcp)                             | MCP client: server definitions, activation, connections, tool catalog, OAuth sign-in                  |
| [`@robota-sdk/agent-plugin`](https://www.npmjs.com/package/@robota-sdk/agent-plugin)                       | Lifecycle plugins: history, logging, usage, limits, performance, errors, analytics, webhooks          |
| [`@robota-sdk/agent-session-analytics`](https://www.npmjs.com/package/@robota-sdk/agent-session-analytics) | Session-log timing and usage analysis and reports                                                     |
| [`@robota-sdk/agent-process`](https://www.npmjs.com/package/@robota-sdk/agent-process)                     | Child-process tree termination (`killProcessTree`)                                                    |
| [`@robota-sdk/agent-file-authority`](https://www.npmjs.com/package/@robota-sdk/agent-file-authority)       | Bounded, root-relative file reads for Node.js                                                         |

**Multi-agent conversation** — coordinate independent agents and people in a shared conversation:

| Package                                                                                                       | Description                                                                       |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [`@robota-sdk/agent-roundtable`](https://www.npmjs.com/package/@robota-sdk/agent-roundtable)                 | Selects turns, runs parallel groups, publishes to a shared transcript; no model, no provider |
| [`@robota-sdk/agent-roundtable-robota`](https://www.npmjs.com/package/@robota-sdk/agent-roundtable-robota)   | Runs a Robota `Session` or plain `Robota` agent as a roundtable participant or selector       |

**Product composition** — build your own product on the same runtime:

| Package                                                                                                | Description                                                                        |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| [`@robota-sdk/agent-product`](https://www.npmjs.com/package/@robota-sdk/agent-product)                 | `assembleProduct(profile)`: a product from a declarative profile                   |
| [`@robota-sdk/agent-capability-pack`](https://www.npmjs.com/package/@robota-sdk/agent-capability-pack) | `ICapabilityPack` contract and `mergeCapabilityPacks`                              |
| [`@robota-sdk/pack-coding`](https://www.npmjs.com/package/@robota-sdk/pack-coding)                     | The coding capability pack (`createCodingPack`): coding tools, commands, subagents |
| [`@robota-sdk/agent-command`](https://www.npmjs.com/package/@robota-sdk/agent-command)                 | Slash-command modules (`/help`, `/permissions`, `/mcp`, `/rewind`, …)              |
| [`@robota-sdk/agent-preset`](https://www.npmjs.com/package/@robota-sdk/agent-preset)                   | Presets (named bundles of framework options) and output styles                     |

**Transports and UI** — put a session behind a protocol or a screen:

| Package                                                                                                  | Description                                                                          |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [`@robota-sdk/agent-transport`](https://www.npmjs.com/package/@robota-sdk/agent-transport)               | Carrier-neutral wire protocol, session dispatch and delivery (`./client`, `./node`)  |
| [`@robota-sdk/agent-transport-ws`](https://www.npmjs.com/package/@robota-sdk/agent-transport-ws)         | WebSocket carrier                                                                    |
| [`@robota-sdk/agent-transport-http`](https://www.npmjs.com/package/@robota-sdk/agent-transport-http)     | HTTP carrier (Hono)                                                                  |
| [`@robota-sdk/agent-transport-mcp`](https://www.npmjs.com/package/@robota-sdk/agent-transport-mcp)       | Serve a session as an MCP server: stdio, loopback HTTP, OAuth-authorized remote HTTP |
| [`@robota-sdk/agent-transport-webrtc`](https://www.npmjs.com/package/@robota-sdk/agent-transport-webrtc) | Peer-to-peer WebRTC transport for remote control and the device mesh                 |
| [`@robota-sdk/agent-remote-pairing`](https://www.npmjs.com/package/@robota-sdk/agent-remote-pairing)     | Pairing and DTLS-fingerprint channel binding for peer-to-peer connections            |
| [`@robota-sdk/agent-ui-terminal`](https://www.npmjs.com/package/@robota-sdk/agent-ui-terminal)           | Terminal UI (React + Ink)                                                            |

**Contracts** — type-only packages shared across layers:

| Package                                                                                                                      | Description                                                        |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [`@robota-sdk/agent-interface-session`](https://www.npmjs.com/package/@robota-sdk/agent-interface-session)                   | Interactive sessions, interaction channels, events, turns, records |
| [`@robota-sdk/agent-interface-session-mobility`](https://www.npmjs.com/package/@robota-sdk/agent-interface-session-mobility) | Peer messaging and session handoff between sessions and devices    |
| [`@robota-sdk/agent-interface-command`](https://www.npmjs.com/package/@robota-sdk/agent-interface-command)                   | Commands, command results, plugin adapters, capability descriptors |
| [`@robota-sdk/agent-interface-execution`](https://www.npmjs.com/package/@robota-sdk/agent-interface-execution)               | Background tasks, job groups, subagent jobs, execution workspaces  |
| [`@robota-sdk/agent-interface-analytics`](https://www.npmjs.com/package/@robota-sdk/agent-interface-analytics)               | Usage snapshots, per-source totals, run-trace timelines            |
| [`@robota-sdk/agent-interface-transport`](https://www.npmjs.com/package/@robota-sdk/agent-interface-transport)               | Transport adapters, admission, access tokens, external events      |
| [`@robota-sdk/agent-interface-tui`](https://www.npmjs.com/package/@robota-sdk/agent-interface-tui)                           | Terminal UI interaction contracts                                  |

**Agent interface:**

| Package                                                                        | Description                                                                              |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| [`@robota-sdk/agent-cli`](https://www.npmjs.com/package/@robota-sdk/agent-cli) | `__PRODUCT_CLI_NAME__`: interactive terminal AI coding assistant, published as a self-contained bundle |

## Documentation

Full documentation lives at **[docs.__PROJECT_WEBSITE_HOST__](__PROJECT_DOCS_URL__/en/)**.

- [Getting Started](__PROJECT_DOCS_URL__/en/getting-started/) and the [Quick Start](__PROJECT_DOCS_URL__/en/quickstart/)
- [Building Agents](__PROJECT_DOCS_URL__/en/guide/building-agents/)
- [SDK Usage](__PROJECT_DOCS_URL__/en/guide/sdk/)
- [Providers](__PROJECT_DOCS_URL__/en/guide/providers/)
- [Permissions and Hooks](__PROJECT_DOCS_URL__/en/guide/permissions-and-hooks/)
- [Sessions and Daemon](__PROJECT_DOCS_URL__/en/guide/sessions-and-daemon/)
- [The GUI and the Desktop App](__PROJECT_DOCS_URL__/en/guide/gui/)
- [Devices and Remote Control](__PROJECT_DOCS_URL__/en/guide/devices-and-remote/)
- [MCP](__PROJECT_DOCS_URL__/en/guide/mcp/)
- [CLI Reference](__PROJECT_DOCS_URL__/en/guide/cli/)
- [Examples](__PROJECT_DOCS_URL__/en/examples/)
- [Packages](__PROJECT_DOCS_URL__/en/packages/)
- [Development](__PROJECT_DOCS_URL__/en/development/)

## Repository Scope

This repository holds the Robota agent SDK, providers, transports, the CLI, and related
apps (desktop app, browser remote client, docs site, marketing site, blog).

Some workspace packages are **private** and never published to npm on their own:

- The **DAG / workflow subsystem** (`packages/dag-*`, `packages/dag-nodes/*`,
  `packages/agent-command-workflows`). It is bundled into `@robota-sdk/agent-cli`, which publishes as
  a self-contained bundle, and reaches users through the `/workflows` command.
- The **GUI** packages (`agent-ui-web`, `agent-gui-web`, `agent-transport-webrtc-web`) behind the
  desktop app, `__PRODUCT_CLI_NAME__ --serve --open`, and the browser remote client.
- `agent-provider-replay`, a provider that replays a recorded session for offline tests.

## Contributing

```bash
pnpm install
pnpm build
pnpm test
```

Development needs Node.js 22 (22.14 or a later 22.x release) and pnpm 8.15.4. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the
workflow, the checks a pull request must pass, and the commit format.

## License

Robota is dual-licensed under the [GNU AGPL-3.0](LICENSE) or a [commercial license](COMMERCIAL.md). See [LICENSING.md](LICENSING.md).
