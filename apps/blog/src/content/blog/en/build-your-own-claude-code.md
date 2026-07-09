---
title: 'Build Your Own Claude Code in 50 Lines of TypeScript'
subtitle: 'A vendor-neutral AI coding assistant you own and control'
date: '2026-05-18'
author: 'Jung Youn Hwang'
authorUrl: 'https://github.com/woojubb'
lang: 'en'
---

Claude Code is a great tool. But it's tied to Anthropic's API, proprietary, and can't be embedded into your own product. What if you could build the same experience — with any AI provider, open source, and fully under your control?

With Robota SDK, you can. Here's how.

## The Fastest Path: Install and Run

```bash
npm install -g @robota-sdk/agent-cli
robota
```

That's it. On first run, you'll be asked to choose a provider (Anthropic, OpenAI, DeepSeek, Gemini, or a local LM Studio model) and enter your API key. Then you get the same interactive coding assistant experience — file reading, editing, bash execution, multi-turn conversations — all in your terminal.

If you already use Claude Code, your `.claude/settings.json` and `CLAUDE.md` are read automatically. No migration needed.

## Build a Custom Agent in 50 Lines

The CLI is built on top of a programmable SDK. Here's a minimal coding assistant you can embed in your own tooling:

```typescript
import { InteractiveSession } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const provider = new AnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const session = new InteractiveSession({
  cwd: process.cwd(), // project context
  provider,
  permissionMode: 'default',
});

// Stream output
session.on('text_delta', (delta) => process.stdout.write(delta));
session.on('complete', () => console.log('\n'));

// Submit a task
await session.submit('List all TODO comments in this project and suggest fixes');
```

This session automatically loads your project files, respects your permission settings, and maintains multi-turn conversation history.

## Switch to a Cheaper Provider in One Line

This is where Robota's multi-provider design really shines. Anthropic raised prices? Switch to DeepSeek — same code:

```typescript
// Before: Anthropic claude-sonnet-4-6
const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });

// After: DeepSeek (10-30x cheaper for many tasks)
import { DeepSeekProvider } from '@robota-sdk/agent-provider-openai-compatible';
const provider = new DeepSeekProvider({ apiKey: process.env.DEEPSEEK_API_KEY });

// The rest of your code is unchanged
const session = new InteractiveSession({ cwd: process.cwd(), provider });
```

No rewrites. No migration. The provider interface is identical across all 8 supported providers.

## Embed in Your Own Product

The real power is in the transport layer. The same `InteractiveSession` can be exposed over:

- **HTTP/REST** — for server-side integrations
- **WebSocket** — for real-time browser UIs
- **MCP** — to be called by Claude Code or other MCP-compatible tools
- **Headless** — for CI/CD and scripted use cases

```typescript
import { createHttpTransport } from '@robota-sdk/agent-transport-http';
import { InteractiveSession } from '@robota-sdk/agent-framework';

const session = new InteractiveSession({ cwd: '/your/project', provider });
const transport = new HttpTransport({ port: 3000 });
await transport.attach(session);
await transport.start();
// Your AI coding assistant is now an API
```

## Try Without an API Key

If you want to experiment without spending money, use LM Studio:

1. Install [LM Studio](https://lmstudio.ai/)
2. Download any model (Llama, Mistral, Phi, etc.)
3. Start the local server in LM Studio
4. Run `robota` — select "LM Studio" when prompted

No API key. No cost. Same experience.

## What's Next

- [GitHub →](https://github.com/woojubb/robota) — star the repo, open an issue
- [Full docs →](https://robota.io/getting-started/) — more examples
- [Architecture →](https://robota.io/guide/architecture) — how the layers fit together
