---
title: "PROV-006: every provider populates a per-model capability vocabulary (tools/vision/json_schema/reasoning/native_web/streaming) that no engine, tool-assembly, or /model command reads — and deepseek's runtime supportsTools() contradicts its own catalog entry for deepseek-reasoner"
status: todo
created: 2026-08-13
priority: high
urgency: soon
area: packages/agent-core, packages/agent-provider-openai-compatible, packages/agent-provider-anthropic, packages/agent-provider-gemini
depends_on: []
---

# PROV-006: per-model capabilities are a dead contract

## Problem

The provider catalog contract carries a per-model `capabilities` set precisely to express "this model
of this provider can't do X", and every provider populates it with real per-model distinctions. But
nothing reads it: tool/vision gating happens at provider granularity via a per-provider boolean, so a
no-`tools` model still gets tools and `vision` is never checked before sending images. Worse, deepseek's
`supportsTools()` returns unconditional `true`, directly contradicting its own catalog entry for
`deepseek-reasoner`.

## Evidence (round-2 cross-cluster critic, 2026-08-13)

- `packages/agent-core/src/interfaces/provider-definition.ts:66-74` — `TProviderModelCapability`
  (`'tools' | 'vision' | 'json_schema' | 'reasoning' | 'native_web' | 'streaming'`) on
  `IProviderModelCatalogEntry.capabilities`; providers populate real distinctions, e.g.
  `agent-provider-openai-compatible/src/deepseek/model-catalog.ts:40-49` gives `deepseek-reasoner`
  `['reasoning','json_schema','streaming']` (NO `'tools'`); anthropic/gemini/qwen/gemma all declare
  per-model sets.
- The only repo-wide references outside declarations are the two re-export lines
  (`agent-core/src/index.ts:66`, `interfaces/index.ts:78`) — no engine, tool-assembly, framework, or
  `/model` command reads `entry.capabilities`.
- Tool gating uses only the per-provider boolean: `agent-core/src/executors/local-executor.ts:180-182`
  checks `provider.supportsTools()`, and deepseek's returns unconditional `true`
  (`agent-provider-openai-compatible/src/deepseek/provider.ts:184-186`) — contradicting its own
  `deepseek-reasoner` catalog entry.

## Direction

Either consume the per-model flags — model-aware tool/vision gating in the engine or at
profile/model-selection time, plus `/model` display — or delete the vocabulary from the catalog
contract as forward-provisioned-but-unused (a published-contract change, semver/changeset gate).
Resolve the deepseek `supportsTools()`-vs-catalog self-contradiction either way (make `supportsTools`
model-aware, or correct one side).

## Test Plan

- Red-first: selecting a model whose catalog entry lacks `tools` results in tools NOT being offered to
  it (fails today — tools are offered); an image request to a non-`vision` model is rejected or
  flagged. OR (if deleting) the `capabilities` field is gone from the catalog contract.
- Red-first: deepseek's `supportsTools()` and its `deepseek-reasoner` catalog entry agree.
- `pnpm harness:verify` over agent-core + the provider packages green; changeset if the contract
  changes.

## User Execution Test Scenarios

**Applies** (model selection is a CLI product surface).

- Prerequisites: built CLI + a DeepSeek key.
- Steps: select `deepseek-reasoner` (which its catalog marks as no-`tools`), ask a question that would
  require a tool call.
- Expected (after the "consume" fix): tools are not offered to that model, and the CLI/model behaves
  consistently with the declared capability (or `/model` shows the capability).
- Expected (before fix, contrast): tools are offered to `deepseek-reasoner` despite the catalog saying
  it has none, because `supportsTools()` returns true unconditionally.
- Cleanup: none.
- Evidence (fill in after implementation): the model's tool-availability behavior vs its catalog entry.
