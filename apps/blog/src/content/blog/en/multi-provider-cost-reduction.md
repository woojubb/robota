---
title: 'Multi-Provider AI: How We Cut Costs Without Changing Agent Logic'
subtitle: 'The real value of a vendor-neutral AI agent SDK'
date: '2026-05-18'
author: 'Jung Youn Hwang'
authorUrl: 'https://github.com/woojubb'
lang: 'en'
---

When we started building Robota SDK, one of the core design decisions was: **the agent logic must not know which AI provider it's talking to.**

This sounded like premature abstraction at the time. Now it's the most valuable feature in the codebase.

## The Problem with Provider Lock-In

Most AI agent frameworks are built around a specific provider's API. You start with OpenAI because it's the obvious choice, and six months later you have thousands of lines of code with `openai.chat.completions.create()` scattered everywhere.

When Anthropic releases a better model, or DeepSeek cuts prices by 10x, or your enterprise customer requires an on-premise model — you're stuck. The migration cost is too high, so you stay locked in.

Robota was designed to make this problem impossible.

## How Provider Switching Works

Every provider in Robota implements the same `IAIProvider` interface. When you call `agent.run()` or `session.submit()`, the agent doesn't call an OpenAI or Anthropic API directly — it calls `provider.createCompletion()` through the interface.

```typescript
// Your agent code — identical regardless of provider
const agent = new Robota({
  name: 'MyAgent',
  aiProviders: [provider], // swap this out anytime
  defaultModel: {
    provider: 'anthropic', // or 'openai', 'deepseek', 'gemini', 'qwen'
    model: 'claude-sonnet-4-6',
  },
});

const result = await agent.run('Refactor this function for better readability');
```

To switch providers, you change one import and one constructor:

```typescript
// Before: $15 / 1M tokens
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';
const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });

// After: $0.14 / 1M tokens (DeepSeek V3)
import { DeepSeekProvider } from '@robota-sdk/agent-provider-openai-compatible';
const provider = new DeepSeekProvider({ apiKey: process.env.DEEPSEEK_API_KEY });
```

Your tool definitions, system prompts, session logic, and persistence layer are all unchanged.

## Running Multiple Providers Simultaneously

You can register multiple providers and switch between them at runtime — within the same conversation:

```typescript
const agent = new Robota({
  name: 'CostOptimizedAgent',
  aiProviders: [
    new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY }),
    new DeepSeekProvider({ apiKey: process.env.DEEPSEEK_API_KEY }),
    new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY }),
  ],
  defaultModel: { provider: 'deepseek', model: 'deepseek-chat' },
});

// Most tasks: use cheap DeepSeek
const draft = await agent.run('Write unit tests for this function');

// Complex reasoning: switch to Claude
agent.setModel({ provider: 'anthropic', model: 'claude-opus-4-7' });
const review = await agent.run('Review this architecture for security issues');

// Back to DeepSeek
agent.setModel({ provider: 'deepseek', model: 'deepseek-chat' });
```

## Supported Providers

| Provider  | Sub-path           | Notes                              |
| --------- | ------------------ | ---------------------------------- |
| Anthropic | `/anthropic`       | Claude 3.5, 4, Opus, Sonnet, Haiku |
| OpenAI    | `/openai`          | GPT-4o, o1, o3                     |
| DeepSeek  | `/deepseek`        | V3, R1 reasoning                   |
| Gemini    | `/gemini`          | 2.0 Flash, Pro                     |
| Qwen      | `/qwen`            | Qwen-Max, Qwen-Plus                |
| Gemma     | `/gemma`           | Local or Google AI                 |
| ByteDance | `/bytedance`       | Doubao                             |
| LM Studio | `/openai` (compat) | Any local model, no API key needed |

Any OpenAI-compatible endpoint works via the `/openai` sub-path with a custom `baseURL`.

## The Bottom Line

The AI provider landscape is changing fast. Prices drop every quarter. New models leapfrog existing ones. Geopolitical and compliance requirements push different companies toward different providers.

Vendor lock-in in AI tooling is a technical debt bomb. Robota was designed from day one to make the bomb impossible to arm.

[Get started →](https://robota.io/getting-started/)
