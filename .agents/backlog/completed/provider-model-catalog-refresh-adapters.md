# Provider Model Catalog Refresh Adapters

## Status

Completed.

## Priority

P2 - improves provider/model correctness for volatile provider catalogs without making the CLI own
model lists.

## Problem

The active-provider model list now uses provider-owned fallback metadata through
`IProviderDefinition.modelCatalog`, and `/model` no longer falls back to Claude-only choices for
other providers. That solves the CLI beta state-drift path.

The remaining architecture gap is volatility. Provider model IDs, context windows, lifecycle state,
and capabilities can change outside this repository. The current fallback catalog contract includes
status, source URL, and verification timestamps, but there is no provider-owned live/generated
refresh adapter yet.

The CLI/TUI must not solve this by hardcoding model lists or branching on provider names.

## Recommended Direction

Add a provider catalog adapter layer owned by provider packages and consumed through SDK
provider/model common APIs.

Recommended design:

- Provider packages may expose an optional catalog refresh/probe function next to
  `IProviderDefinition.modelCatalog`.
- The SDK common API resolves catalog state in this order:
  1. live provider API discovery when available and explicitly requested or cacheable;
  2. generated/cache metadata refreshed by repository scripts;
  3. built-in fallback catalog metadata already present on provider definitions;
  4. `unavailable` state with a clear manual-input message.
- Startup and `/model` must remain usable when refresh fails. The command result should surface
  stale/unavailable state without blocking manual model input.
- Static or generated entries must include source metadata and `lastVerifiedAt`.

## Acceptance Criteria

- [x] Provider model catalog refresh is represented by a provider-owned public contract or SDK common
      API extension, not a CLI constant.
- [x] At least one provider has a live or generated refresh adapter covered by tests.
- [x] `/model` exposes catalog freshness state when available.
- [x] Refresh failure does not block CLI startup or manual model input.
- [x] Fallback metadata remains source-stamped and provider-owned.
- [x] Package specs identify the owner of live discovery, generated metadata, fallback metadata, and
      stale-data policy.

## Result

Implemented an optional provider-owned `refreshModelCatalog` contract on `IProviderDefinition`.
`@robota-sdk/agent-provider-openai` now provides the first live adapter through the OpenAI Models API,
and `@robota-sdk/agent-sdk` exposes async model command common APIs that invoke refresh hooks without
moving provider logic into command modules or the CLI/TUI. `/model` now surfaces catalog freshness and
keeps manual model input available when refresh is unavailable.

## Verification Plan

- `pnpm --filter @robota-sdk/agent-core test`
- `pnpm --filter @robota-sdk/agent-sdk test -- model`
- `pnpm --filter @robota-sdk/agent-command-model test`
- affected provider package tests
- `pnpm harness:scan:commands`
- `pnpm docs:build`
