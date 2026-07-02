# 5-Minute Quick Start

Get an AI chat endpoint running with the Robota SDK in under 5 minutes.

## Prerequisites

- Node.js 22 or higher (`node --version`)
- An Anthropic API key from [console.anthropic.com](https://console.anthropic.com)

## Option A — Use the CLI (fastest)

```bash
# No install needed
npx @robota-sdk/agent-cli
```

The CLI prompts you to select a provider and enter your API key, then opens an interactive chat REPL. That's it.

## Option B — Embed the SDK in a Next.js app

### 1. Clone the starter template

```bash
git clone https://github.com/woojubb/robota.git
cd robota/apps/starter-nextjs
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Set your API key

```bash
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env.local
```

### 4. Start the dev server

```bash
pnpm dev
```

### 5. Test the chat API

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Explain the Robota SDK in one sentence"}'
```

You should receive a JSON response with the AI reply within a few seconds.

## Option C — Install the SDK directly

```bash
npm install @robota-sdk/agent-framework @robota-sdk/agent-provider
```

Then in your TypeScript or JavaScript file:

```typescript
import { createQuery } from '@robota-sdk/agent-framework';
import { createAnthropicProvider } from '@robota-sdk/agent-provider';

// createQuery returns a prompt-only function. cwd defaults to process.cwd();
// permissionMode defaults to 'bypassPermissions' for programmatic use.
const query = createQuery({
  provider: createAnthropicProvider({
    apiKey: process.env.ANTHROPIC_API_KEY,
  }),
});

const response = await query('Hello, what can you do?');
console.log(response);
```

## Switch providers

Swap `createAnthropicProvider` with any other supported provider — no other code changes required.
OpenAI is constructed directly via its provider class:

```typescript
import { OpenAIProvider } from '@robota-sdk/agent-provider';

const query = createQuery({
  provider: new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY }),
});
```

Supported providers: Anthropic, OpenAI, Google Gemini, DeepSeek, Qwen, and any OpenAI-compatible endpoint (LM Studio, Ollama).

**Through an AI gateway** (Vercel AI Gateway, LiteLLM, OpenRouter): use the OpenAI provider with the
gateway's `baseURL` and a gateway model slug — non-OpenAI models included. Streaming and tool
calling work first-try over the same protocol:

```typescript
import { OpenAIProvider } from '@robota-sdk/agent-provider';

const query = createQuery({
  provider: new OpenAIProvider({
    apiKey: process.env.AI_GATEWAY_API_KEY,
    baseURL: 'https://ai-gateway.vercel.sh/v1',
    defaultModel: 'anthropic/claude-sonnet-4-5',
  }),
});
```

See [Providers Reference — Through an AI gateway](./guide/providers.md#through-an-ai-gateway) for
LiteLLM/OpenRouter/Azure variants.

## Deploy to Vercel

The starter template includes a one-click Deploy button. Set `ANTHROPIC_API_KEY` as an environment variable in the Vercel dashboard and deploy — no additional configuration needed.

## Next steps

- [CLI reference](/guide/cli) — full flag and slash command reference
- [Providers](/guide/providers) — configure multi-provider setups
- [Permission modes](/guide/permissions-and-hooks) — control what tools the AI can call
- [Using the SDK](/guide/sdk) — InteractiveSession, transports, sessions, createQuery()
