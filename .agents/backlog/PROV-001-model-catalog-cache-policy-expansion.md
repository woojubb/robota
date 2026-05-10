---
title: 'PROV-001: Provider model catalog cache/generation policy expansion beyond OpenAI'
status: todo
created: 2026-05-10
priority: low
urgency: backlog
area: provider
related: [CLI-AUDIT-003]
---

## Problem

`provider-model-catalog-refresh-adapters` (completed) introduced the first live catalog refresh
adapter for `@robota-sdk/agent-provider-openai`. The `IProviderDefinition.refreshModelCatalog`
contract exists in `agent-core`, and SDK model common APIs invoke refresh hooks without touching
command modules or CLI code.

The remaining work from CLI-AUDIT-003 ("partially resolved") is:

- Provider-specific **generated** (pre-built / codegen) catalog refresh adapters for providers other
  than OpenAI (Anthropic, Gemini, Groq, DeepSeek, etc.).
- **Cache invalidation policy**: define a per-provider TTL or event-driven invalidation strategy so
  stale catalog data is refreshed without blocking startup.
- **Freshness metadata propagation**: ensure `lastVerifiedAt` and `source` fields are populated in
  all provider fallback catalogs, not only OpenAI.

This gap is architectural — providers that do not implement `refreshModelCatalog` silently fall back
to static metadata, which can become stale.

## Solution

1. For each `agent-provider-*` package that has a public API for listing models, implement
   `refreshModelCatalog` returning live or generated catalog data.
2. Define a cache invalidation policy (e.g., max-age TTL in provider definition) consumed by the SDK
   model command common API.
3. Ensure all fallback `modelCatalog` entries have non-empty `source` and `lastVerifiedAt` metadata.
4. Update `agent-system.md` CLI-AUDIT-003 status to "resolved" once all provider adapters and the
   cache policy are in place.

## Acceptance Criteria

- [ ] All `agent-provider-*` packages with a public model list endpoint implement `refreshModelCatalog`.
- [ ] SDK model common API uses per-provider cache TTL or explicit invalidation before calling refresh.
- [ ] All static fallback catalog entries include `source` and `lastVerifiedAt`.
- [ ] `pnpm harness:scan:commands` passes.
- [ ] CLI-AUDIT-003 status can be updated to "resolved" with commit evidence.

## Test Plan

- Each provider package: unit test for `refreshModelCatalog` returning catalog data.
- SDK: unit test cache invalidation triggers a refresh on TTL expiry.
- CLI smoke: `/model` shows freshness state for all configured providers.

## User Execution Test Scenarios

1. Run CLI with an Anthropic provider configured.
2. Type `/model` — the command should show freshness state (or "static catalog" if no live adapter yet).
3. Confirm no startup error occurs regardless of network availability.

## Verification Evidence

(완료 후 각 provider 구현 commit hash 및 harness:scan:commands 결과 기록)
