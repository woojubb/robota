---
title: 'UX-012: Provider selection descriptions and category badges'
status: done
completed: 2026-05-23
created: 2026-05-23
priority: critical
urgency: now
area: packages/agent-core, packages/agent-provider, packages/agent-command
depends_on: []
---

## Background

Provider selection showed only names (`anthropic`, `openai`, `gemma`), giving new users no basis
for choosing. Users without prior AI provider knowledge had no way to understand trade-offs.

## Changes Made

- Added `TProviderCategory = 'cloud-paid' | 'cloud-free' | 'local-free'` and optional `category`
  field to `IProviderDefinition` in `packages/agent-core`
- Updated all six provider definitions with `category` and improved `description` text:
  - anthropic: `cloud-paid` — "Claude series — strong at coding tasks. API key required."
  - openai: `cloud-paid` — "GPT series — general-purpose assistant. API key required."
  - deepseek: `cloud-paid` — "High performance at low cost. API key required."
  - gemma: `local-free` — "Local models via LM Studio or Ollama. No API key needed."
  - qwen: `cloud-paid` — "Alibaba Cloud Qwen series. API key required."
  - gemini: `cloud-free` — "Google Gemini series — free tier available."
- Updated `formatProviderSetupChoiceLabel()` in `agent-command` to prepend category badge
  and use em dash separator: `[Cloud/Paid] Anthropic (anthropic) — Claude series…`
- Updated test snapshot to match new format

## Test Plan

- 151/151 agent-command tests passing
- Provider list format: `[Cloud/Paid] Anthropic (anthropic) — Claude series — strong at coding tasks. API key required.`

## User Execution Test Scenarios

Not applicable — UI change; verified via test snapshot.
