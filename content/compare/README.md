---
title: Why Robota — Compare AI Coding Tools
description: How Robota compares to Claude Code, Cursor, Aider, and Cline — features, cost, and freedom.
---

# Why Robota?

> **TL;DR** — Robota is the only AI coding CLI that lets you bring your own API key for any provider, run completely offline with a local model, and embed the same engine directly into your own app — all under the MIT license.

---

## Feature Comparison

|                                        |  **Robota**  |    Claude Code    |        Cursor         |    Aider    |    Cline    |
| -------------------------------------- | :----------: | :---------------: | :-------------------: | :---------: | :---------: |
| Multi-provider (one config)            |      ✅      | ❌ Anthropic only | ❌ OpenAI + Anthropic |   ✅ many   |   ✅ many   |
| BYOK — no subscription required        |      ✅      |        ✅         |    ❌ subscription    |     ✅      |     ✅      |
| Local model support (Ollama/LM Studio) |      ✅      |        ❌         |          ❌           |     ✅      |     ✅      |
| Embeddable SDK (use in your own app)   |      ✅      |        ❌         |          ❌           |     ❌      |     ❌      |
| Open source (MIT)                      |      ✅      |  ❌ proprietary   |    ❌ proprietary     | ✅ Apache 2 | ✅ Apache 2 |
| TypeScript-first, strict types         |      ✅      |        ✅         |          ✅           |  ❌ Python  |     ✅      |
| Terminal CLI                           |      ✅      |        ✅         |      ❌ IDE only      |     ✅      |     ✅      |
| IDE extension                          | ❌ (roadmap) |        ✅         |          ✅           |     ❌      |  ✅ VSCode  |
| Session persistence & resume           |      ✅      |        ✅         |          ✅           |     ❌      |     ❌      |
| Background agents                      |      ✅      |        ✅         |          ❌           |     ❌      |     ❌      |
| Self-hostable                          |      ✅      |        ❌         |          ❌           |     ✅      |     ✅      |

---

## Cost Comparison

| Tool        | Pricing model            | Monthly cost estimate (4h/day)      |
| ----------- | ------------------------ | ----------------------------------- |
| **Robota**  | BYOK — pay your provider | ~$5–30 depending on model and usage |
| Claude Code | BYOK (Anthropic API)     | ~$20–80 with Claude Sonnet          |
| Cursor      | Subscription             | $20/mo (Pro) + API overages         |
| Aider       | BYOK                     | ~$5–30 depending on model           |
| Cline       | BYOK (VSCode extension)  | ~$5–30 depending on model           |

**Robota with Gemini** — Google's Gemini 1.5 Flash has a free tier that covers casual use at zero cost. [Get a free key →](https://aistudio.google.com/apikey)

**Robota with local models** — Connect LM Studio or Ollama and pay nothing. No API key, no subscription, fully offline.

---

## What Makes Robota Different

### 1. Any Provider — One Config

Switch between Anthropic Claude, OpenAI GPT, Google Gemini, DeepSeek, Qwen, or your own Ollama instance by changing one line in `~/.robota/settings.json`. No code changes. No subscription lock-in.

```json
{ "currentProvider": "gemini-flash" }
```

### 2. Embeddable SDK

Robota ships as a proper SDK (`@robota-sdk/agent-framework`), not just a CLI. You can embed the same agent runtime — with all its tools, permissions, and session management — directly into your own application:

```typescript
import { query } from '@robota-sdk/agent-framework';

const result = await query('List all TypeScript files in src/');
```

No other AI coding assistant exposes this. Claude Code, Cursor, and Cline are closed products — you cannot embed them.

### 3. Fully Open Source (MIT)

Every line of Robota is MIT-licensed and publicly auditable. You can fork it, modify it, self-host it, and build commercial products on top of it — with no CLA required.

### 4. Local Model First-Class Support

Configure any Ollama or LM Studio model as your provider. No internet connection required for inference. Your code and prompts never leave your machine.

### 5. No Subscription — Ever

Robota itself is free. You pay only what you owe to your AI provider (or nothing if you run locally). There is no "Pro plan" gating features, no seat licenses, no usage caps imposed by Robota.

---

## When to Choose Something Else

**Choose Claude Code** if you want the tightest Claude integration and are happy with Anthropic-only.

**Choose Cursor** if you want an IDE-first experience with inline diff editing and tab completion — Robota does not have an IDE extension yet.

**Choose Aider** if you prefer a Python ecosystem and work primarily in git-based batch commits.

**Choose Cline** if you want a VSCode sidebar agent and are not interested in embedding or SDK usage.

---

## Quick Start

```bash
# Try it now — no install needed
npx @robota-sdk/agent-cli

# Install globally
npm install -g @robota-sdk/agent-cli
robota
```

→ [Getting Started guide](/getting-started/)
→ [CLI reference](/guide/cli)
