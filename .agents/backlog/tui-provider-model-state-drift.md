# TUI Provider/Model State Drift

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

## Recommended Direction

Make provider and model state use one effective active-profile abstraction.

The command-facing API should expose:

- read effective active provider profile from merged settings;
- determine the settings scope that currently wins for `currentProvider`;
- patch `currentProvider` and the active provider profile in the same effective scope unless an explicit scope is requested;
- list models for the active provider type or show a provider-owned unsupported/unknown-model state;
- return a restart effect only after the persisted patch is guaranteed to be visible to the next process.

## Acceptance Criteria

- Switching provider to `qwen` persists `currentProvider: "qwen"` in the settings scope that wins on next startup.
- After restart, `/provider current`, the status bar, and the provider instance all resolve to the same provider profile.
- The model shown after provider switch comes from the active `qwen` profile/default, not from a stale Anthropic/Claude setting.
- `/model` either lists models for the active provider or explicitly reports that the active provider does not expose a model catalog.
- Changing model updates the active provider profile, not a hardcoded Anthropic/Claude model setting.
- Success/restart messages include enough effective provider/model information to verify what will be used next.
- Regression tests cover user-level Anthropic settings plus project-local `qwen` settings, provider switch, restart, and model display consistency.
- Regression tests cover changing a model while `qwen` is active and prove Anthropic profile data is not mutated.

## Verification Plan

- Add unit tests for SDK provider/model settings common APIs.
- Add command package tests for `/provider use` and `/model` persistence behavior.
- Add CLI integration tests around restart-requested effects and status bar projection.
- Run:
  - `pnpm --filter @robota-sdk/agent-command-provider test`
  - `pnpm --filter @robota-sdk/agent-command-model test`
  - `pnpm --filter @robota-sdk/agent-sdk test`
  - `pnpm --filter @robota-sdk/agent-cli test`
  - `pnpm harness:verify -- --scope packages/agent-cli`
