# CLI Model Change Restart Regression

Status: completed on `fix/cli-model-change-restart`.

## What

Fix the `/model` command flow so confirming a model change actually affects the next session after Robota says it will restart.

## Why

The CLI currently tells the user that changing the model will restart the session, but the selected model is not reliably applied after that restart. This is a user-facing configuration bug: the command confirms an action, exits the current session, and then the next session can still use the old model.

## Current Signals

- `packages/agent-sdk/src/commands/system-command.ts` returns `data.modelId` for the `model` system command and leaves application to the caller.
- `packages/agent-cli/src/ui/hooks/useSlashRouting.ts` maps `data.modelId` to `_pendingModelId`.
- `packages/agent-cli/src/ui/hooks/useSideEffects.ts` confirms the model change, calls `updateModelInSettings()`, and requests shutdown.
- `packages/agent-cli/src/utils/settings-io.ts` updates either `providers[currentProvider].model` or legacy `provider.model`.
- The UI copy says "This will restart the session" and "Model changed ... Restarting...", so the observable contract is already established.

## Scope

- [x] Reproduce the regression with the current settings shapes:
  - `currentProvider` plus `providers`
  - legacy `provider`
  - provider profiles created by `/provider setup`
- [x] Determine whether the failure is settings persistence, config reload, process restart semantics, or active session reuse.
- [x] Make `/model` behavior consistent across slash routing and SDK system command routing.
- [x] Ensure the selected model is applied to `IResolvedConfig.provider.model` for the next session.
- [x] Keep provider-specific model validation in provider definitions/settings, not in generic CLI execution code.
- [x] Add regression tests for settings update and restart/reload behavior.

## Non-Goals

- Do not add provider-specific model-name branches to CLI, SDK, or core.
- Do not change provider profile selection semantics.
- Do not introduce a hidden fallback model if the requested model is invalid.
- Do not make model changes mutate an already-running provider unless that behavior is explicitly designed.

## Acceptance Criteria

- [x] Given a settings file with `currentProvider`, `/model <id>` updates the active provider profile's model.
- [x] Given a legacy settings file, `/model <id>` updates the legacy provider model without losing existing fields.
- [x] After confirming `/model`, the next CLI session resolves the selected model.
- [x] If restart is requested, the CLI either truly restarts or exits with clear behavior that the launcher handles.
- [x] Cancellation leaves settings unchanged.
- [x] Tests cover slash command routing, system command routing, settings persistence, and resolved config behavior.

## Test Plan

- Add unit tests for `updateModelInSettings()` covering current and legacy settings.
- Add a config-resolution test proving the updated settings produce the selected model.
- Add a CLI/TUI side-effect test for confirmed and cancelled model changes.
- Add a PTY or process-level smoke test if restart semantics need end-to-end coverage.

## Promotion Path

1. [x] Move to `.agents/tasks/cli-model-change-restart.md`.
2. [x] Start with a failing regression test that reproduces the user's report.
3. [x] Fix the smallest owner boundary that makes the confirmed model visible to the next session.
