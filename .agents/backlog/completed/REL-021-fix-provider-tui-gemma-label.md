---
title: 'REL-021: Fix confusing "Gemma / LM Studio" provider label in CLI config TUI'
status: done
done_at: 2026-05-25
created: 2026-05-25
priority: low
urgency: post-launch
area: packages/agent-cli/src/
depends_on: []
---

## Background

The interactive `robota --configure` TUI presents local model users with a provider option
labeled "Gemma / LM Studio." This is confusing for two reasons:

1. Ollama is a separate local model runtime not named in the option
2. LM Studio supports many model families beyond Gemma
3. The underlying protocol is "OpenAI-compatible" — that is what matters, not the model family

A developer running Ollama with Mistral or llama3 models will not recognize
"Gemma / LM Studio" as applicable to their setup.

Source: pre-release PM audit §6 (2026-05-25).

## Change Required

Find the provider selection list in the CLI config TUI (likely in
`packages/agent-cli/src/interactive/` or `packages/agent-cli/src/config/`).

Change the option label from "Gemma / LM Studio" to one of:

- "Local (OpenAI-compatible)" — most accurate
- "Ollama / LM Studio / llama.cpp" — most recognizable

Update the associated help text to clarify it works with any OpenAI-compatible local server.

## Acceptance Criteria

- `robota --configure` no longer shows "Gemma / LM Studio" as a provider option name
- New label accurately describes the OpenAI-compatible local server option
- `content/guide/local-llm.md` terminology is consistent with the TUI label
