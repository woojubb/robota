# 5-Minute Quick Start

Two ways to get something running: the reference CLI, or the SDK in your own code.

## Prerequisites

- Node.js 22.12 or later (`node --version`)
- An API key for a model provider. The examples on this page use Anthropic
  ([platform.claude.com](https://platform.claude.com/settings/keys)). No key? The CLI can use a local
  model instead — see [Local LLM Setup](./guide/local-llm.md).

## Option A — Run the CLI

```bash
# No install needed
npx @robota-sdk/agent-cli
```

On first run, the CLI asks whether you have an API key, then either configures that provider, walks
you through getting a free Gemini key, or connects to a local model server (LM Studio). If
`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `DASHSCOPE_API_KEY` or `DEEPSEEK_API_KEY` is already set, it
skips the questions and starts with that provider's default model. Then it opens the interactive
terminal UI.

Tip: in the terminal UI, `/workflows create "<describe a multi-step task>"` asks the model to design a
DAG workflow from your description, saves it under `.workflows/`, and runs it. See the
[CLI reference](./guide/cli.md#workflows-workflows).

## Option B — Use the SDK in your code

```bash
npm install @robota-sdk/agent-framework @robota-sdk/agent-provider-anthropic
```

Save this as `agent.mts` and run it with `npx tsx agent.mts`:

```typescript
import { createQuery } from '@robota-sdk/agent-framework';
import { createAnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

// createQuery returns a function that runs one prompt, with the built-in tools, and resolves with
// the reply. cwd defaults to process.cwd(). permissionMode defaults to 'default': reads and searches
// run, and with no permissionHandler a call that would ask for approval (an edit, a shell command)
// is denied. Pass permissionMode: 'bypassPermissions' for unattended runs.
const query = createQuery({
  provider: createAnthropicProvider({
    apiKey: process.env.ANTHROPIC_API_KEY,
  }),
});

const response = await query('Hello, what can you do?');
console.log(response);
```

Pass `model` to `createQuery` with any provider other than Anthropic: without it the query asks the
provider for `claude-opus-4-5` unless a settings file names a model. Without a `projectAccess`
decision it also runs Restricted: the project's `AGENTS.md`, `CLAUDE.md` and settings are not loaded.
The [SDK guide](./guide/sdk.md) covers both.

## Use another provider

`InteractiveSession` takes the provider and the model to use:

```typescript
import { InteractiveSession } from '@robota-sdk/agent-framework';
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';

const session = new InteractiveSession({
  cwd: process.cwd(),
  provider: new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY }),
  model: 'gpt-5.1',
});

const turn = await session.submit('Hello, what can you do?');
const { response } = await turn.completed;
console.log(response);
```

Supported providers: Anthropic, OpenAI, Google Gemini, DeepSeek, Qwen, and any OpenAI-compatible
endpoint, including local servers such as Ollama and LM Studio.

**Through an AI gateway** (Vercel AI Gateway, LiteLLM, OpenRouter): use the OpenAI provider with the
gateway's `baseURL`, and pass a gateway model slug — non-OpenAI models included. Streaming and tool
calling use the same chat-completions protocol:

```typescript
import { InteractiveSession } from '@robota-sdk/agent-framework';
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';

const session = new InteractiveSession({
  cwd: process.cwd(),
  provider: new OpenAIProvider({
    apiKey: process.env.AI_GATEWAY_API_KEY,
    baseURL: 'https://ai-gateway.vercel.sh/v1',
  }),
  model: 'anthropic/claude-sonnet-4-5',
});
```

See [Providers Reference — Through an AI gateway](./guide/providers.md#through-an-ai-gateway) for
LiteLLM, OpenRouter and Azure variants.

## Next steps

- [Getting Started](./getting-started/README.md) — tools, provider switching and sessions, step by step
- [CLI reference](./guide/cli.md) — flags, slash commands and permission modes
- [Providers](./guide/providers.md) — every provider and its options
- [Permissions and hooks](./guide/permissions-and-hooks.md) — control which tool calls run
- [Using the SDK](./guide/sdk.md) — `InteractiveSession`, `createQuery()`, sessions and transports
