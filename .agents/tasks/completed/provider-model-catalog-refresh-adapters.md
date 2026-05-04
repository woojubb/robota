# Provider Model Catalog Refresh Adapters

- **Status**: completed
- **Created**: 2026-05-05
- **Branch**: feat/provider-model-catalog-refresh
- **Scope**: packages/agent-core, packages/agent-sdk, packages/agent-command-model, packages/agent-provider-openai

## Objective

Add a provider-owned model catalog refresh contract so volatile provider model lists can be queried
without moving model metadata into the CLI/TUI layer.

## Plan

- [x] Research provider model catalog discovery options and current command boundaries.
- [x] Update core/SDK/provider specs before implementation.
- [x] Add failing tests for provider-owned refresh and SDK model common API behavior.
- [x] Implement provider catalog refresh contract and OpenAI live adapter.
- [x] Surface catalog freshness state through `/model` usage output without blocking manual input.
- [x] Update docs and architecture notes.
- [x] Run targeted and repository verification.
- [x] Move backlog/task records to completed.

## Decisions

- Keep provider packages as the owner of live/generative/fallback catalog data.
- Add an optional async refresh contract to provider definitions; CLI/TUI must not branch on provider
  names or call provider APIs directly.
- Implement OpenAI first because the official API exposes model listing through `/v1/models` and the
  existing provider already owns OpenAI client credentials.
- Keep `/model <model-id>` manual input available even when live refresh fails.

## Research Notes

- OpenAI documents a Models API for listing and describing API models.
- Static fallback catalog metadata remains provider-owned and source-stamped.

## Test Plan

- `pnpm --filter @robota-sdk/agent-core test -- provider-definition`
- `pnpm --filter @robota-sdk/agent-provider-openai test -- provider-definition`
- `pnpm --filter @robota-sdk/agent-sdk test -- model-command-api`
- `pnpm --filter @robota-sdk/agent-command-model test`
- `pnpm harness:scan:commands`

## Progress

### 2026-05-05

- Added provider-owned model catalog refresh contract to `agent-core`.
- Implemented OpenAI live catalog refresh adapter and provider definition hook.
- Added SDK async model command common API refresh orchestration.
- Updated `/model` command usage to surface catalog freshness without blocking manual input.
- Updated affected specs, READMEs, SDK public-surface documentation, and architecture map notes.
- Verified targeted package tests/builds, workspace typecheck, docs build, workspace build, and harness scans.

## Result

Completed provider-owned catalog refresh support. OpenAI is the first live adapter, and generic
SDK/command layers invoke it only through injected provider definitions. CLI/TUI remains a render
layer and does not own provider-specific model metadata.
