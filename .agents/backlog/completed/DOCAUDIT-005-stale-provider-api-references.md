---
title: 'DOCAUDIT-005: Fix stale provider API references in docs/SPEC after provider consolidation'
status: done
completed: 2026-06-27
created: 2026-06-27
priority: medium
urgency: soon
area: content, packages/agent-framework, packages/agent-provider
depends_on: []
---

## Evidence Log (2026-06-27)

- `content/quickstart.md`: the broken `createOpenAIProvider` import/usage replaced with
  `new OpenAIProvider({ apiKey })` (OpenAI ships a class, not a convenience factory). The
  Anthropic snippet (`createAnthropicProvider`) was already correct (re-exported from root).
- `agent-framework/docs/SPEC.md`: 2 stale `agent-provider-anthropic` / `agent-provider-openai/
google/bytedance` references updated to the consolidated package + sub-paths (lines 1851, 2294).
- `agent-provider/docs/SPEC.md`: added an "Other provider sub-paths" section documenting each
  sub-path's real exports (class + `create*ProviderDefinition`; only Anthropic has a convenience
  factory) — removing the false implication that all expose an Anthropic-style factory.
- Left untouched (intentional, NOT stale): `content/guide/migration.md` and the release notes,
  which legitimately reference the old `agent-provider-*` names to document the migration/history.
- Verified: factories named in the new table all exist; `pnpm harness:scan` 32/32
  (spec-public-surface + docs-structure pass); `createOpenAIProvider` gone from the quickstart.

# Fix stale provider API references after provider consolidation

The nine `agent-provider-*` packages were consolidated into one `@robota-sdk/agent-provider`
with sub-path exports; several docs still reflect the old shape.

## What

1. **Broken quickstart example (`content/quickstart.md:85,88`).** Imports
   `createOpenAIProvider` from `@robota-sdk/agent-provider`, but no such factory is
   exported — only `createOpenAIProviderDefinition` (a provider _definition_ factory) and
   the `OpenAIProvider` class exist. Only Anthropic ships a `createAnthropicProvider`
   convenience factory. Fix the example to the real API (`new OpenAIProvider(...)` or the
   `./openai` sub-path), so a copy-paste quickstart runs.
2. **Stale package names in `agent-framework/docs/SPEC.md`** (e.g. lines ~1851, ~2294
   reference `agent-provider-anthropic`, `agent-provider-openai/google/bytedance`). The
   rule is still correct; update the names to the consolidated package + sub-paths.
3. **Incomplete `agent-provider/docs/SPEC.md` sub-path docs.** Only the Anthropic sub-path
   has a detailed export table; OpenAI/DeepSeek/Gemini/Gemma/Qwen/Bytedance have none,
   which falsely implies they all expose a factory like Anthropic. Document each
   sub-path's actual exports (class + `create*ProviderDefinition` + options types).

## Why

Stale public-API references in a quickstart break the first thing a new user runs, and
SPEC drift after the consolidation misleads on which symbols exist.

## Done When

- The quickstart example imports/uses only symbols that actually exist and runs.
- `agent-framework` SPEC references the consolidated package + sub-paths, not the old names.
- `agent-provider` SPEC documents each sub-path's real exports.
- A grep for `createOpenAIProvider`/`agent-provider-<x>` across content + SPECs returns
  only correct usages.

## Test Plan

- Grep content/ + SPECs for the stale tokens → 0 incorrect.
- Type-check or run the quickstart snippet against the real exports.

## User Execution Test Scenarios

1. Copy the quickstart provider snippet into a scratch file and run it → it resolves and
   constructs a provider (no "is not exported" error). Evidence: _to fill._
