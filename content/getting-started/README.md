# Getting Started

## Which path is right for you?

**"I want a coding assistant in my terminal right now"**
→ [CLI Quick Start](#quick-start--cli) — 2 minutes, API key required

**"I want to build a chatbot or AI feature in my app"**
→ [First Agent (5 lines)](#1-create-a-simple-conversational-agent) — 10 minutes

**"I want to switch AI providers without rewriting code"**
→ [Switch Providers](#3-switch-providers-dynamically) — 5 minutes

**"I want to embed an AI assistant in my own tool or app"**
→ [Using the SDK (InteractiveSession)](#4-use-the-sdk-for-project-aware-sessions) — 15 minutes

**"I have no API key and want to try for free"**
→ [Local Model with LM Studio](#no-api-key-try-with-a-local-model) — 10 minutes

---

## No API key? Try with a local model

Install [LM Studio](https://lmstudio.ai/) → Download any model → Enable local server

```bash
npm install -g @robota-sdk/agent-cli
robota  # Select "LM Studio" when prompted — no API key needed
```

---

## Prerequisites

- **Node.js 22 or higher** — required for Robota CLI; SDK supports Node.js 18+ (22 recommended)
- **AI Provider API key**: Anthropic, OpenAI, DeepSeek, Gemini, Qwen, or another configured
  provider — _or_ use LM Studio locally (no key required)

## Installation

Choose the packages you need based on your use case:

### I want a ready-to-use coding assistant

```bash
npm install -g @robota-sdk/agent-cli
```

### I want to build a custom AI agent

```bash
npm install @robota-sdk/agent-core @robota-sdk/agent-provider/anthropic @anthropic-ai/sdk
```

### I want tool calling (function tools)

```bash
npm install @robota-sdk/agent-core @robota-sdk/agent-tools @robota-sdk/agent-provider/anthropic @anthropic-ai/sdk
```

## Quick Start — CLI (Robota Coding Assistant)

Install the CLI globally:

```bash
npm install -g @robota-sdk/agent-cli
# or
pnpm add -g @robota-sdk/agent-cli
```

Start the assistant:

```bash
robota
```

On first run, you'll be guided through provider selection and API key configuration.

### Supported Providers

| Provider           | Model Examples                 | API Key                                                  |
| ------------------ | ------------------------------ | -------------------------------------------------------- |
| Anthropic (Claude) | claude-opus-4, claude-sonnet-4 | [console.anthropic.com](https://console.anthropic.com)   |
| OpenAI             | gpt-4o, gpt-4-turbo            | [platform.openai.com](https://platform.openai.com)       |
| DeepSeek           | deepseek-chat                  | [platform.deepseek.com](https://platform.deepseek.com)   |
| Qwen (Alibaba)     | qwen-max                       | [dashscope.aliyuncs.com](https://dashscope.aliyuncs.com) |
| Gemini             | gemini-2.0-flash               | [aistudio.google.com](https://aistudio.google.com)       |
| LM Studio (local)  | any local model                | localhost — no key needed                                |

### System Requirements

- **Node.js 22 or higher** — check with `node --version`
- macOS, Linux, or Windows (WSL recommended)

## Your First Agent

### 1. Create a simple conversational agent

```typescript
import { Robota } from '@robota-sdk/agent-core';
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';

const provider = new AnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const agent = new Robota({
  name: 'Assistant',
  aiProviders: [provider],
  defaultModel: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    systemMessage: 'You are a helpful coding assistant.',
  },
});

const response = await agent.run('What is a TypeScript generic?');
console.log(response);
```

### 2. Add tools for the agent to use

```typescript
import { Robota } from '@robota-sdk/agent-core';
import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';
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
  async ({ city }) => ({
    data: JSON.stringify({ city, temperature: 22, condition: 'sunny' }),
  }),
);

const agent = new Robota({
  name: 'WeatherBot',
  aiProviders: [provider],
  defaultModel: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    systemMessage: 'You help users check the weather.',
  },
  tools: [weatherTool],
});

// The agent will call get_weather automatically when needed
const response = await agent.run('What is the weather in Seoul?');
console.log(response);
```

### 3. Switch providers dynamically

```typescript
import { OpenAIProvider } from '@robota-sdk/agent-provider/openai';
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';

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

// Switch to OpenAI mid-conversation
agent.setModel({ provider: 'openai', model: 'gpt-4o' });
response = await agent.run('Continue our conversation.');
```

### 4. Use the SDK for project-aware sessions

```typescript
import { InteractiveSession } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';

const provider = new AnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const session = new InteractiveSession({
  cwd: process.cwd(),
  provider,
  permissionMode: 'default',
});

session.on('text_delta', (delta) => process.stdout.write(delta));

session.on('complete', ({ response }) => {
  console.log('\n--- Complete response ---');
  console.log(response);
});

// InteractiveSession loads project context and settings, then provides
// permissions, hooks, compaction, commands, persistence, and transports.
await session.submit('Explain the architecture of this project');
```

### 5. Use the CLI

```bash
# Interactive TUI
robota

# One-shot
robota -p "List all TODO comments in this project"

# With model override
robota --model claude-opus-4-6
```

## What's Next

- [Building Agents](../guide/building-agents.md) — Agent patterns with agent-core
- [Using the SDK](../guide/sdk.md) — InteractiveSession, transports, sessions, createQuery()
- [CLI Reference](../guide/cli.md) — Full CLI usage guide
- [Architecture](../guide/architecture.md) — Package layers and design

## Troubleshooting

**macOS Terminal.app + Korean/CJK input**: IME input may crash macOS Terminal.app. Use **[iTerm2](https://iterm2.com/)** instead. This is a known Ink + Terminal.app issue shared with Claude Code.

**Node.js version**: Robota CLI requires Node.js 22+. Check with `node --version`. Use [Volta](https://volta.sh/) or [nvm](https://github.com/nvm-sh/nvm) to manage versions.

**API key not found**: Set your key as an environment variable (`export ANTHROPIC_API_KEY=...`) or run `robota` and follow the interactive setup prompts.
