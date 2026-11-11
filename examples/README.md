# Robota SDK — Embedding Examples

Fully-typed TypeScript examples that embed the `@robota-sdk/*` libraries in your own application: web
servers, bots, scripts and focused single-capability demos.

## Examples

| Directory                                      | Stack                 | Highlights                                                      |
| ---------------------------------------------- | --------------------- | --------------------------------------------------------------- |
| [`nextjs/`](./nextjs/)                         | Next.js 15 App Router | SSE streaming chat, React client                                |
| [`express/`](./express/)                       | Express 4             | Custom Zod tools (`calculate`, `get_current_time`), SSE         |
| [`cli/`](./cli/)                               | Node.js script        | `createQuery`, stdout streaming, prompt from argv or stdin      |
| [`slack-bot/`](./slack-bot/)                   | @slack/bolt           | Socket Mode, reply streamed into a thread message               |
| [`github-pr-reviewer/`](./github-pr-reviewer/) | @octokit/rest         | `createQuery`, GitHub Actions workflow, PR diff review          |
| [`websocket-chat/`](./websocket-chat/)         | ws                    | Per-client sessions, real-time streaming, abort support         |
| [`batch-processor/`](./batch-processor/)       | p-limit               | Parallel `createQuery`, concurrency control, JSON reporting     |
| [`telegram-bot/`](./telegram-bot/)             | grammy                | Per-chat sessions resumed with `resumeSessionId`, session store |
| [`discord-bot/`](./discord-bot/)               | discord.js v14        | Slash commands, deferred replies, response chunking             |

## Capability examples

Focused, runnable examples under [`capabilities/`](./capabilities/) that each isolate one SDK
capability. Each has its own README and a `dev` script (`tsx src/index.ts`).

| Directory                                                                              | Highlights                                                               |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [`capabilities/decision-agent/`](./capabilities/decision-agent/)                       | The tool call is the answer (`allowToolOnlyCompletion`), router pattern  |
| [`capabilities/streaming/`](./capabilities/streaming/)                                 | `runStream` text deltas, plus a typed structured-output return value     |
| [`capabilities/stateless-turns/`](./capabilities/stateless-turns/)                     | `retainHistory: false` — flat per-call token cost vs growing history     |
| [`capabilities/openai-compatible-gateway/`](./capabilities/openai-compatible-gateway/) | Routing through an OpenAI-compatible gateway endpoint                    |
| [`capabilities/agent-eval/`](./capabilities/agent-eval/)                               | Evals-as-code: metrics over an agent's runs, CI-gated                    |
| [`capabilities/multi-surface-deploy/`](./capabilities/multi-surface-deploy/)           | One agent definition served over many channels (WS + HTTP), no gateway   |
| [`capabilities/sandboxed-tools/`](./capabilities/sandboxed-tools/)                     | File and shell tools running inside a sandbox client instead of the host |

## Prerequisites

- Node.js 22.12 or later (required by the `@robota-sdk/*` packages)
- An API key for at least one supported provider (the examples default to Anthropic)

## Install and run

Each example is independent — install and run it separately. An example installs the published `@robota-sdk/*`
packages from npm, copied out on its own and inside this repository alike: the repository's `.npmrc` sets
`link-workspace-packages=false`, so the examples are pnpm workspace members for shared tooling only and
resolve their versioned `@robota-sdk/*` dependencies from the registry. The exception is
[`capabilities/agent-eval/`](./capabilities/agent-eval/), whose outcome baselines link local packages with
`workspace:^`, so it installs only inside this repository.

The examples in this directory read their `.env` file themselves: the Slack, Discord and Telegram bots and the
PR reviewer with `dotenv`, Next.js from `.env.local`, and the rest with Node's `process.loadEnvFile`. The
demos under `capabilities/` read keys from the process environment only: export them, or pass Node's
`--env-file` flag (for example `npx tsx --env-file=.env src/index.ts`).

```bash
# Next.js streaming chat (Next.js loads .env.local)
cd nextjs
cp .env.example .env.local && npm install && npm run dev

# Express API with custom tools
cd express
npm install
export ANTHROPIC_API_KEY=your-key
npm run dev

# CLI script
cd cli
npm install
export ANTHROPIC_API_KEY=your-key
npm run dev -- "Hello, world!"
```

The examples that take prompts from other people — the Next.js, WebSocket, Express, Slack, Discord and
Telegram servers and bots, and the PR reviewer and batch processor, which put a diff or a document into the
prompt — deny the built-in tools that run commands, read or change files, reach the network or send files,
so whoever writes the prompt can talk to the model and use only the tools the example approves (Express's
calculator and clock). Add your own tools with `additionalTools` and approve them by name with
`allowedTools`.

## SDK packages used

| Package                                 | Purpose                                                  |
| --------------------------------------- | -------------------------------------------------------- |
| `@robota-sdk/agent-framework`           | `createAgentRuntime`, `createQuery` — high-level runtime |
| `@robota-sdk/agent-core`                | `ConversationAgent` — low-level agent                    |
| `@robota-sdk/agent-tools`               | `createZodFunctionTool` — Zod-schema function tools      |
| `@robota-sdk/agent-tools/defaults`      | `createDefaultTools` — the default file and shell tools  |
| `@robota-sdk/agent-transport/{http,ws}` | HTTP and WebSocket transports for one session            |
| `@robota-sdk/agent-provider/*`          | `AnthropicProvider`, `OpenAIProvider`, …                 |

## Supported providers

All examples default to Anthropic Claude. Every provider is a subpath of `@robota-sdk/agent-provider`, which
the provider-using examples already depend on. To use another chat provider, install the vendor SDK its subpath needs
(`openai` for OpenAI, DeepSeek, Qwen and Gemma; `@google/genai` for Gemini) and swap the provider class —
see each example's README for the exact spot.

| Provider              | Import path                                              | Class                                               |
| --------------------- | -------------------------------------------------------- | --------------------------------------------------- |
| Anthropic             | `@robota-sdk/agent-provider/anthropic`                   | `AnthropicProvider`                                 |
| OpenAI                | `@robota-sdk/agent-provider/openai`                      | `OpenAIProvider`                                    |
| Google Gemini         | `@robota-sdk/agent-provider/gemini`                      | `GeminiProvider`                                    |
| DeepSeek, Qwen, Gemma | `@robota-sdk/agent-provider/deepseek`, `/qwen`, `/gemma` | `DeepSeekProvider`, `QwenProvider`, `GemmaProvider` |

Any other OpenAI-compatible endpoint works through `OpenAIProvider` with a `baseURL` — see
[`capabilities/openai-compatible-gateway/`](./capabilities/openai-compatible-gateway/).
`@robota-sdk/agent-provider/bytedance` generates video and is not a chat provider, so it does not drop into
these examples.
