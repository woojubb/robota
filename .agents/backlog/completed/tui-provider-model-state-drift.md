# TUI Provider/Model State Drift

Status: completed
Completed: 2026-05-04
Implementation branch: feat/cli-selected-backlogs

## Priority

P0 - release blocker for the CLI beta.

## Problem

The TUI provider and model selection flows can report a successful change while the next CLI session still appears to use the previous provider/model state.

Observed failure mode:

- User switches provider to `qwen` from the TUI/provider command.
- The command reports that the provider changed and exits/restarts.
- Starting the CLI again may still show a Claude Sonnet model, or make it look like the Anthropic provider is still active.

This indicates drift between at least two of these state sources:

- merged effective settings;
- selected `currentProvider`;
- per-provider profile model fields;
- model command settings writes;
- status bar/display projection;
- provider instance created at process startup.

## Scope

- `packages/agent-cli`
- `packages/agent-sdk` command common APIs for provider/model settings
- `packages/agent-command-provider`
- `packages/agent-command-model`

## Constraints

- CLI/TUI must remain a thin renderer and host-effect applier.
- Provider/model semantics must live in SDK command APIs and command packages, not in Ink components or TUI hooks.
- Provider and model commands must not use separate persistence rules that can write to different effective settings scopes.
- Provider-specific defaults and model catalogs must come from provider definitions or SDK-owned provider/model APIs, not CLI branches.
- Provider model availability changes over time. The repository must not treat a hand-maintained provider model list as an immutable truth.

## Provider Model Catalog SSOT

Provider model data needs two layers:

1. **Stable provider-owned capability contract**

   Each provider package owns the stable contract for how models are discovered, validated, and displayed for that provider type. This belongs with provider definitions or SDK provider/model command APIs, not in `agent-cli` rendering code.

2. **Volatile model catalog source**

   Actual model IDs, display names, context limits, deprecation status, and capability metadata are time-sensitive. The catalog should be loaded through a provider-owned catalog adapter that can use, in order:
   - live provider API discovery when the provider exposes it;
   - a generated/cacheable metadata file refreshed by a repository script;
   - a conservative built-in fallback marked with a `lastVerifiedAt` timestamp and provider source URL.

The recommended SSOT is therefore not a static CLI constant. It should be an SDK/provider-facing `IProviderModelCatalog` contract, with provider packages supplying catalog adapters. Built-in fallback metadata can live under the owning provider package only when it is stamped, refreshable, and clearly treated as staleable data.

Required catalog fields should be intentionally small:

- provider type;
- model id;
- display name;
- aliases, if the provider exposes stable aliases;
- context window, if known;
- capabilities needed by command UX, such as tools, vision, JSON/schema output, reasoning, native web, and streaming;
- lifecycle state, such as active, preview, deprecated, or unavailable;
- `lastVerifiedAt` and source metadata for fallback/static entries.

The `/provider` and `/model` flows should consume this catalog contract to:

- show provider-appropriate model choices after a provider switch;
- avoid showing Claude-only models while `qwen`, `gemini`, `openai`, or another provider is active;
- warn when a stored model is no longer present in the latest catalog;
- allow manual model input when the provider has no catalog or the catalog is stale;
- avoid blocking startup solely because a catalog refresh failed.

## Recommended Direction

Make provider and model state use one effective active-profile abstraction.

The command-facing API should expose:

- read effective active provider profile from merged settings;
- determine the settings scope that currently wins for `currentProvider`;
- patch `currentProvider` and the active provider profile in the same effective scope unless an explicit scope is requested;
- list models for the active provider type or show a provider-owned unsupported/unknown-model state;
- resolve provider model catalog data through the provider-owned catalog contract, with stale/fallback status exposed to the command result;
- return a restart effect only after the persisted patch is guaranteed to be visible to the next process.

## Acceptance Criteria

- Switching provider to `qwen` persists `currentProvider: "qwen"` in the settings scope that wins on next startup.
- After restart, `/provider current`, the status bar, and the provider instance all resolve to the same provider profile.
- The model shown after provider switch comes from the active `qwen` profile/default, not from a stale Anthropic/Claude setting.
- `/model` either lists models for the active provider or explicitly reports that the active provider does not expose a model catalog.
- `/model` never shows Claude-only models while the effective active provider is `qwen` or another non-Anthropic provider.
- Provider model catalogs have a clear owner, refresh path, stale-data policy, and minimal metadata contract.
- Static fallback model entries include `lastVerifiedAt` and source metadata.
- Changing model updates the active provider profile, not a hardcoded Anthropic/Claude model setting.
- Success/restart messages include enough effective provider/model information to verify what will be used next.
- Regression tests cover user-level Anthropic settings plus project-local `qwen` settings, provider switch, restart, and model display consistency.
- Regression tests cover changing a model while `qwen` is active and prove Anthropic profile data is not mutated.
- Regression tests cover a stale or unavailable provider catalog and prove the command still supports manual model input.

## Verification Plan

- Add unit tests for SDK provider/model settings common APIs.
- Add unit tests for the provider model catalog contract, including stale fallback and refresh failure behavior.
- Add command package tests for `/provider use` and `/model` persistence behavior.
- Add CLI integration tests around restart-requested effects and status bar projection.
- Run:
  - `pnpm --filter @robota-sdk/agent-command-provider test`
  - `pnpm --filter @robota-sdk/agent-command-model test`
  - `pnpm --filter @robota-sdk/agent-sdk test`
  - `pnpm --filter @robota-sdk/agent-cli test`
  - `pnpm harness:verify -- --scope packages/agent-cli`

## Result

Completed via `.agents/tasks/completed/tui-provider-model-state-drift.md`. Provider/model state now resolves through the effective active profile, `/model` consumes active provider catalog metadata, provider switches write to the effective settings scope, and regression tests cover the observed drift.
