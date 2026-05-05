# Provider Profile Switching Batch

- **Status**: completed
- **Created**: 2026-05-05
- **Branch**: feat/provider-profile-switching
- **Scope**: packages/agent-sdk, packages/agent-command-provider, packages/agent-command-model, packages/agent-cli

## Objective

Implement the active provider profile switching backlog as one batched PR, covering profile naming,
interactive setup defaults, persistent profile selection, one-shot invocation override separation,
and active profile display.

## Plan

- [x] Review `.agents/backlog/cli-provider-profile-naming-research.md`.
- [x] Review `.agents/backlog/cli-provider-profile-switching.md`.
- [x] Add SDK-owned profile name suggestion semantics.
- [x] Update interactive setup and `/provider add` to create model-specific profile keys.
- [x] Keep headless explicit profile names and one-shot `--provider` override semantics separate.
- [x] Show active profile identity in the CLI status area.
- [x] Update package SPECs and backlog records.
- [x] Run targeted package verification.
- [x] Prepare one batched PR for provider profile naming and switching.

## Progress

### 2026-05-05

- Batched provider profile naming and switching into one branch to avoid one-PR-per-backlog churn.
- Added SDK-owned provider profile name suggestion based on model id with numeric suffixes for duplicates.
- Updated interactive setup and `/provider add` to use generated profile keys while preserving explicit headless profile names.
- Updated SDK/CLI/command-provider SPECs, CLI README, and architecture maps to document profile-key
  ownership, one-shot override semantics, and active profile display.
- Ran targeted package tests, package lint/typecheck/build, `pnpm harness:scan`, and
  `pnpm harness:verify -- --base-ref origin/develop --skip-record-check`.

## Decisions

- Recommended default naming policy: use a sanitized model id as the generated profile key, then append `-2`, `-3`, etc. for duplicates.
- Keep secrets out of profile names. Distinguish profiles in lists/status by profile key, provider type, model, and non-secret endpoint fields.
- Treat `--provider <profile>` as a one-shot invocation override unless `--set-current` is also provided.

## Test Plan

- Build `@robota-sdk/agent-sdk` first so dependent workspace packages resolve the updated command API
  exports during local verification.
- Run SDK command API tests for profile name suggestion and provider setup flow coverage.
- Run `@robota-sdk/agent-command-provider` tests for `/provider add`, duplicate profile creation,
  and persisted switch behavior.
- Run targeted `@robota-sdk/agent-cli` tests for provider setup flow, provider configuration,
  provider factory, model-change side effects, and status bar rendering.
- Run package typecheck/lint/build for `agent-sdk`, `agent-command-provider`, and `agent-cli`, then
  run repository harness scan and changed-scope verification.

## Blockers

- None.

## Result

Completed as one provider-profile switching batch. Interactive setup and `/provider add` now create
model-derived profile keys with numeric duplicate suffixes, explicit headless setup preserves the
caller-provided profile key, one-shot provider overrides remain separate from persisted default
selection, and the TUI status area shows active profile identity when available.
