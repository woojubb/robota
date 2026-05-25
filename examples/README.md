# Robota SDK — Embedding Examples

Fully-typed TypeScript examples showing how to embed `@robota-sdk` into your own application.

## Examples

| Directory                                      | Stack                 | Highlights                                                  |
| ---------------------------------------------- | --------------------- | ----------------------------------------------------------- |
| [`nextjs/`](./nextjs/)                         | Next.js 15 App Router | SSE streaming chat, React client                            |
| [`express/`](./express/)                       | Express 4             | Tool use (`calculate`, `get_current_time`), SSE             |
| [`cli/`](./cli/)                               | Node.js script        | `createQuery`, stdout streaming, CI/CD ready                |
| [`slack-bot/`](./slack-bot/)                   | @slack/bolt           | Socket Mode, per-thread sessions, `resumeSessionId`         |
| [`github-pr-reviewer/`](./github-pr-reviewer/) | @octokit/rest         | `createQuery`, GitHub Actions workflow, PR diff review      |
| [`websocket-chat/`](./websocket-chat/)         | ws                    | Per-client sessions, real-time streaming, abort support     |
| [`batch-processor/`](./batch-processor/)       | p-limit               | Parallel `createQuery`, concurrency control, JSON reporting |
| [`telegram-bot/`](./telegram-bot/)             | grammy                | Per-chat sessions, `resumeSessionId`, session persistence   |
| [`discord-bot/`](./discord-bot/)               | discord.js v14        | Slash commands, deferred replies, response chunking         |

## Prerequisites

- Node.js 18+
- An API key for at least one supported provider (Anthropic, OpenAI, Gemini, …)

## Install and run

Each example is independent — install and run it separately:

```bash
# Next.js streaming chat
cd nextjs
cp .env.example .env.local && npm install && npm run dev

# Express API with tool use
cd express
cp .env.example .env && npm install && npm run dev

# CLI script
cd cli
cp .env.example .env && npm install
npx tsx src/index.ts "Hello, world!"
```

## SDK packages used

| Package                       | Purpose                                                     |
| ----------------------------- | ----------------------------------------------------------- |
| `@robota-sdk/agent-framework` | `createAgentRuntime`, `createQuery` — high-level runtime    |
| `@robota-sdk/agent-core`      | `Robota`, `createFunctionTool` — low-level agent with tools |
| `@robota-sdk/agent-provider`  | `AnthropicProvider`, `OpenAIProvider`, …                    |

## Supported providers

All examples default to Anthropic Claude. Swap to any other provider by changing one import and one config line — see each example's README for details.

Supported: Anthropic, OpenAI, DeepSeek, Google Gemini, Google Gemma, Bytedance, Qwen.
