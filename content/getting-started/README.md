# Getting Started

Robota is a set of TypeScript libraries for building AI agents. The `robota` CLI is a reference coding
assistant built from the same libraries. This page gets you from install to a first agent, a
session with built-in tools, and the CLI.

> **Beta** — the packages are published as `3.0.0-beta` versions. APIs may still change before a
> stable release. [Report issues](https://github.com/woojubb/robota/issues).

## Which path is right for you?

**"I want a coding assistant in my terminal right now"**
→ [CLI Quick Start](#quick-start--cli) — needs an API key or a local model

**"I want to build a chatbot or AI feature in my app"**
→ [First Agent](#1-create-a-simple-conversational-agent)

**"I want to switch AI providers without rewriting code"**
→ [Switch Providers](#3-switch-providers-dynamically)

**"I want to embed an AI assistant with file and shell tools in my own tool or app"**
→ [Use a session with built-in tools](#4-use-a-session-with-built-in-tools)

**"I have no API key and want to try for free"**
→ [Local model](#no-api-key-try-a-local-model)

---

## No API key? Try a local model

Install [LM Studio](https://lmstudio.ai/), download a model, and start its local server (Developer
tab → Start Server; it listens on `http://localhost:1234`). Then:

```bash
npx @robota-sdk/agent-cli  # choose "No — use a local model (LM Studio, no API key needed)"
```

For Ollama or llama.cpp, see [Local LLM Setup](../guide/local-llm.md).

---

## Prerequisites

- **Node.js 22.12 or later** — the Robota CLI and every published `@robota-sdk/*` package declare
  `node >=22.12.0`. Check with `node --version`.
- **An API key** for Anthropic, OpenAI, Gemini, DeepSeek or Qwen — _or_ a local model server such as
  LM Studio or Ollama (no key needed).
- **macOS, Linux or Windows.** The OS sandbox for shell commands is available on macOS, Linux and
  WSL2, not on native Windows.

## Installation

Choose the packages you need:

### A ready-to-use coding assistant

```bash
# Try it now — no install needed
npx @robota-sdk/agent-cli

# Install globally for persistent use
npm install -g @robota-sdk/agent-cli
```

### A custom AI agent

```bash
npm install @robota-sdk/agent-core @robota-sdk/agent-provider-anthropic
```

### Tool calling (function tools)

```bash
npm install @robota-sdk/agent-core @robota-sdk/agent-tools @robota-sdk/agent-provider-anthropic zod@3
```

`agent-tools` uses Zod 3; install `zod@3` so your schemas match it.

### Sessions with built-in tools, permissions and hooks

```bash
npm install @robota-sdk/agent-framework @robota-sdk/agent-provider-anthropic
```

## Quick Start — CLI

```bash
# Try it now — no install needed
npx @robota-sdk/agent-cli

# Install globally for persistent use
npm install -g @robota-sdk/agent-cli
robota
```

On first run, the CLI asks whether you have an API key and walks you through configuring a provider,
getting a free Gemini key, or connecting to a local model. If `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`,
`DASHSCOPE_API_KEY` or `DEEPSEEK_API_KEY` is already set, it starts with that provider's default model
instead. Run `robota --configure` to change the provider later.

In a Git repository you have not trusted yet, the CLI asks whether to trust it before it loads the
project's instruction files, settings, skills and hooks. Answering no starts the session Restricted,
without them.

**Author a workflow in one line.** Once configured, describe a multi-step task in plain English and
let the CLI build and run it:

```bash
robota
> /workflows create "draft three taglines for a CLI tool, then pick the best one and explain why"
```

`/workflows create` asks your active provider to design the workflow, saves it to
`.workflows/<name>.json`, and runs it immediately. See the
[CLI Reference](../guide/cli.md#workflows-workflows).

### Supported Providers

| Provider                             | Default model and examples                       | Key variable        | Get a key                                                                      |
| ------------------------------------ | ------------------------------------------------ | ------------------- | ------------------------------------------------------------------------------ |
| Anthropic (Claude)                   | `claude-sonnet-4-6` (default), `claude-opus-4-6` | `ANTHROPIC_API_KEY` | [platform.claude.com](https://platform.claude.com/settings/keys)               |
| OpenAI                               | you enter the model at setup (e.g. `gpt-5.1`)    | `OPENAI_API_KEY`    | [platform.openai.com](https://platform.openai.com/api-keys)                    |
| Gemini                               | `gemini-3-flash-preview` (default)               | `GEMINI_API_KEY`    | [aistudio.google.com](https://aistudio.google.com/apikey)                      |
| DeepSeek                             | `deepseek-v4-flash` (default), `deepseek-v4-pro` | `DEEPSEEK_API_KEY`  | [platform.deepseek.com](https://platform.deepseek.com/api_keys)                |
| Qwen (Alibaba Cloud)                 | `qwen-plus` (default), `qwen-max`                | `DASHSCOPE_API_KEY` | [Model Studio](https://modelstudio.console.alibabacloud.com/?tab=api#/api-key) |
| Local (Ollama, LM Studio, llama.cpp) | the model your server runs                       | —                   | no key needed                                                                  |

## Your First Agent

### 1. Create a simple conversational agent

```typescript
import { Robota } from '@robota-sdk/agent-core';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const provider = new AnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const agent = new Robota({
  name: 'Assistant',
  aiProviders: [provider],
  defaultModel: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
  },
  systemMessage: 'You are a helpful coding assistant.',
});

const response = await agent.run('What is a TypeScript generic?');
console.log(response);
```

### 2. Add tools for the agent to use

`createZodFunctionTool` validates the model's arguments against a Zod schema before your function
runs, and types the function's input from that schema.

```typescript
import { Robota } from '@robota-sdk/agent-core';
import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';
import { z } from 'zod';

const provider = new AnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const weatherTool = createZodFunctionTool(
  'get_weather',
  'Get current weather for a city',
  z.object({
    city: z.string().describe('City name'),
  }),
  async ({ city }) => ({ city, temperature: 22, condition: 'sunny' }),
);

const agent = new Robota({
  name: 'WeatherBot',
  aiProviders: [provider],
  defaultModel: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
  },
  systemMessage: 'You help users check the weather.',
  tools: [weatherTool],
});

// The agent calls get_weather when it needs to
const response = await agent.run('What is the weather in Seoul?');
console.log(response);
```

### 3. Switch providers dynamically

```typescript
import { Robota } from '@robota-sdk/agent-core';
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const agent = new Robota({
  name: 'MultiProviderAgent',
  aiProviders: [
    new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY }),
    new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY }),
  ],
  defaultModel: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
  },
});

// Start with Claude
let response = await agent.run('Hello!');

// Switch to OpenAI mid-conversation; the history carries over
agent.setModel({ provider: 'openai', model: 'gpt-5.1' });
response = await agent.run('Continue our conversation.');
```

### 4. Use a session with built-in tools

`InteractiveSession` from `@robota-sdk/agent-framework` is what the CLI runs on: a conversation with
the built-in tools (file read, write and edit, glob and grep search, shell, web fetch and search),
permission modes, hooks, compaction and streaming events.

```typescript
import { InteractiveSession } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const session = new InteractiveSession({
  cwd: process.cwd(),
  provider: new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY }),
  model: 'claude-sonnet-4-6',
  permissionMode: 'default',
});

session.on('text_delta', (delta) => process.stdout.write(delta));

// submit() resolves when the prompt is accepted; `completed` resolves when the turn ends.
const turn = await session.submit('List the TypeScript files in src/ and say what each one does.');
const { response } = await turn.completed;
```

The tools work inside `cwd`. In `default` mode, reads and searches run; an edit or a shell command
asks for approval through the `permission_request` event, and with no listener it is denied. The
session keeps the conversation for the next `submit()`. Without a `projectAccess` decision it runs
Restricted: it does not read `AGENTS.md`, `CLAUDE.md` or project settings. To load them, pass a trusted
`projectAccess` — see [Project context and settings](../guide/sdk.md#project-context-and-settings).
If you leave out `model`, the session asks the provider for `claude-opus-4-5`.

### 5. Use the CLI

```bash
# Interactive TUI
robota

# One-shot (print mode; in a Git repository, trust it first with `robota trust --yes`)
robota -p "List all TODO comments in this project"

# With model override
robota --model claude-opus-4-6
```

## What's Next

- [5-Minute Quick Start](../quickstart.md) — the SDK with `createQuery()`, other providers, AI gateways
- [Building Agents](../guide/building-agents.md) — agent patterns with agent-core
- [Using the SDK](../guide/sdk.md) — `InteractiveSession`, `createQuery()`, sessions and transports
- [CLI Reference](../guide/cli.md) — full CLI usage, including
  [`/workflows create`](../guide/cli.md#workflows-workflows) natural-language workflow authoring
- [Architecture](../guide/architecture.md) — package layers and design
- [Providers Reference](../guide/providers.md) — every provider, its options and model names
- [Error Handling](../guide/error-handling.md) — error types, retry patterns, best practices
- [Migration Guide](../guide/migration.md) — upgrading from v2.x to 3.0.0
- [Examples](../examples/README.md) — focused walkthroughs

## Troubleshooting

**macOS Terminal.app + Korean/CJK input**: IME composition can crash macOS Terminal.app. Use
**[iTerm2](https://iterm2.com/)** or another terminal, or use print mode (`robota -p`). The CLI warns
when it starts in Terminal.app.

**Node.js version**: Robota needs Node.js 22.12 or later. Check with `node --version`. Use
[Volta](https://volta.sh/) or [nvm](https://github.com/nvm-sh/nvm) to manage versions.

**API key not found**: Set your key as an environment variable (`export ANTHROPIC_API_KEY=...`), or
run `robota --configure` and follow the prompts.

**"Workspace trust is required before headless startup"**: print mode (`robota -p`) does not start in
a Git repository you have not trusted. Run `robota trust --yes` there, or add `--safe-mode` to run with
every customization off (instruction files, skills, plugins, hooks and MCP servers).
