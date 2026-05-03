# Command Migration: `/model`

Status: Completed in `feat/command-model-module`.

## What

Migrate `/model` into a command-module owner that requests model-change effects through the SDK command contract.

## Previous Owner

- Metadata/execution: `packages/agent-sdk/src/commands/system-command.ts`
- Model subcommands: `packages/agent-sdk/src/commands/system-command-metadata.ts`
- Host application: CLI applies `model-change-requested`

## Target Owner

Recommended: `@robota-sdk/agent-command-model`, consuming SDK model registry/common APIs.

## Migration Notes

- Preserve model subcommands from the model registry.
- Preserve typed `model-change-requested` effect.
- Resolve the known restart/apply issue as part of migration: selected model must be applied to the next session after restart.

## Acceptance Criteria

- [x] `/model` is provided by an injected `ICommandModule`.
- [x] Model metadata and command execution are not split.
- [x] Host model change is represented only as typed command effects/adapters.
- [x] Regression test covers restart and selected model application.

## Test Plan

- [x] Add command module tests for usage, valid model request, and descriptor generation.
- [x] Add CLI/TUI integration test proving generic effects start restart flow and preserve selected model.

## Result

- Created `@robota-sdk/agent-command-model` as the `/model` command owner.
- Added SDK model-command common API helpers under `agent-sdk/command-api/model/`.
- Composed the model command module in the CLI default command module list.
- Removed the legacy CLI slash executor model side-effect path and the SDK-default `/model` command implementation.
- Updated CLI/SDK specs, project structure, and the agent package coverage baseline.

## Verification

- `pnpm install`
- `pnpm --filter @robota-sdk/agent-command-model test`
- `pnpm --filter @robota-sdk/agent-command-model test:coverage -- --coverage.reporter=json-summary --coverage.reporter=text-summary`
- `pnpm --filter @robota-sdk/agent-command-model typecheck`
- `pnpm --filter @robota-sdk/agent-command-model lint`
- `pnpm --filter @robota-sdk/agent-sdk test -- src/commands/__tests__/system-command.test.ts src/command-api/__tests__/command-api.test.ts`
- `pnpm --filter @robota-sdk/agent-sdk typecheck`
- `pnpm --filter @robota-sdk/agent-sdk lint`
- `pnpm --filter @robota-sdk/agent-cli test -- src/commands/__tests__/builtin-source.test.ts src/commands/__tests__/slash-executor.test.ts src/ui/__tests__/model-change-side-effect.test.ts`
- `pnpm --filter @robota-sdk/agent-cli typecheck`
- `pnpm --filter @robota-sdk/agent-cli lint`
- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm lint`
- `pnpm harness:scan`
- `git diff --check`
