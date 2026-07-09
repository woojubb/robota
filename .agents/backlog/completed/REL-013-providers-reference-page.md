---
title: 'REL-013: Create providers reference page'
status: done
done_at: 2026-05-25
created: 2026-05-25
priority: medium
urgency: before-stable
area: content/guide/
depends_on: []
---

## Background

`content/quickstart.md` links to `/guide/providers` for "configure multi-provider setups."
That page does not exist.

There is no single reference page listing all supported providers, their:

- npm import paths (e.g., `import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic'`)
- Required configuration options
- Supported model names
- Known limitations or quirks
- Peer dependency requirements (if any)

A developer adding DeepSeek, Qwen, or Bytedance must discover this from scattered sources
(package-level README, architecture guide, or source code).

Supported providers per `packages/agent-provider/src/`: Anthropic, OpenAI, Gemini, Gemma,
DeepSeek, Qwen, Bytedance, Ollama (OpenAI-compatible).

Source: pre-release PM audit P2.7 (2026-05-25).

## Change Required

Create `content/guide/providers.md` with:

1. **Provider table**: provider name | import path | install command | auth method
2. **Per-provider section**: config options, supported models, known limits
3. **Local / OpenAI-compatible section**: covers Ollama, LM Studio, llama.cpp
   (can reference `content/guide/local-llm.md` for detail)
4. **Switching providers**: code example showing how to swap with zero other changes

Fix the broken link in `content/quickstart.md` → `/guide/providers` once the file exists.

## Acceptance Criteria

- `content/guide/providers.md` exists and covers all providers in `packages/agent-provider/src/`
- The broken link in `content/quickstart.md` resolves correctly
