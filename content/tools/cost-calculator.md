---
title: API Cost Calculator
---

# API Cost Calculator

See how much you would pay using Robota with direct API access compared to a flat Claude Code subscription. Adjust the sliders to match your coding habits.

<CostCalculator />

## How the estimate works

Token usage is estimated from three factors:

| Factor                 | What it controls                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------- |
| **Daily coding hours** | Total time the AI assistant is active                                                  |
| **Task type**          | Input/output token ratio (code review is input-heavy; code generation is output-heavy) |
| **Experience level**   | Overall prompt frequency multiplier                                                    |

A typical working month is assumed to be **22 days**.

## Token price reference (May 2026)

| Provider  | Model             | Input / 1M | Output / 1M |
| --------- | ----------------- | ---------- | ----------- |
| Anthropic | Claude Sonnet 4.x | $3.00      | $15.00      |
| Anthropic | Claude Haiku 4.x  | $0.80      | $4.00       |
| OpenAI    | GPT-4o            | $2.50      | $10.00      |
| OpenAI    | GPT-4o mini       | $0.15      | $0.60       |
| DeepSeek  | DeepSeek Chat     | $0.14      | $0.28       |
| Google    | Gemini 2.0 Flash  | $0.10      | $0.40       |

> Prices are updated manually. Check the provider's official pricing page before making budget decisions.

## Why Robota lets you save

Claude Code charges a flat **$20/month** subscription. With Robota you pay only for tokens you actually use — which means:

- Light users (1–2 h/day) often pay **less than $2/month** with efficient models.
- Heavy users can still save by choosing a cheaper model (DeepSeek, Gemini Flash) for routine tasks and reserving Sonnet/Opus for complex reasoning.
- You can switch providers mid-session without signing up for anything new.

## Bring Your Own Key setup

```bash
# Anthropic
export ANTHROPIC_API_KEY=sk-ant-...
robota

# OpenAI
export OPENAI_API_KEY=sk-...
robota --provider openai --model gpt-4o

# DeepSeek
export DEEPSEEK_API_KEY=...
robota --provider deepseek --model deepseek-chat

# Gemini
export GOOGLE_API_KEY=...
robota --provider gemini --model gemini-2.0-flash
```

See [Getting Started](/getting-started/) for the full setup guide.
