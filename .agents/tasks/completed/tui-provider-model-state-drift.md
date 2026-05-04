# TUI Provider/Model State Drift

- **Status**: completed
- **Created**: 2026-05-04
- **Branch**: feat/cli-selected-backlogs
- **Scope**: packages/agent-cli, packages/agent-sdk, packages/agent-command-provider, packages/agent-command-model

## Objective

Resolve provider/model state drift so TUI provider changes, model choices, persisted settings, restart effects, and next-startup provider construction all use the same effective active provider profile.

## Plan

- [x] Audit current provider/model command APIs, settings persistence, and TUI status projection.
- [x] Update specs for the effective active-profile and provider model catalog contract.
- [x] Add failing regression tests for provider switch scope, active-provider model listing, and model persistence.
- [x] Implement the active-profile and provider-model catalog behavior.
- [x] Run focused package tests and harness verification.
- [x] Archive the completed backlog/task record.

## Progress

### 2026-05-04

- Started implementation branch from `develop`.
- Identified two root causes: `/provider use` writes through a user-settings target that can be masked by project-local settings, and `/model` always exposes Claude model subcommands regardless of the effective active provider.
- Updated package specs for provider-owned model catalogs and effective-scope provider/model settings writes.
- Added provider-owned fallback model catalog metadata to provider definitions and SDK command APIs for active-provider model listing.
- Updated `/model` command construction so model choices are generated from the effective active provider instead of Claude defaults.
- Updated provider settings writes so provider switches patch the settings document that wins in the merged effective settings chain.
- Added regression coverage for project-local provider settings masking user settings and for non-Anthropic model listing behavior.
- Verified targeted builds, tests, typecheck, lint, and `pnpm cli:dev --version` source startup.

## Decisions

- Provider model lists must be exposed through provider-owned `IProviderDefinition` catalog metadata and SDK command APIs, not static CLI constants.
- Runtime provider/model command writes must target the settings document that wins in the merged provider settings chain.
- Use conservative built-in fallback catalogs with `lastVerifiedAt` and source URL metadata; live model discovery remains a future provider-catalog adapter concern.

## Blockers

- (none)

## Result

Completed provider/model state alignment for the CLI beta path. Provider switches now write to the effective settings scope, `/model` uses the active provider catalog when available, provider definitions own fallback model catalog metadata, and regression tests cover the previously observed project-local/user-settings drift.
