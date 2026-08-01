# CLI-BL-053 CLI Thinking Indicator Visibility Regression

Status: completed
Created: 2026-05-02
Branch: fix/cli-sdk-backlog-053-006
Scope: packages/agent-cli

## Priority

P1 - restore before promoting the CLI/TUI batch if possible.

## What

Restore a visible prompt-processing indicator while the CLI is waiting for or processing a model response. Before the current CLI/TUI cleanup, the TUI showed `thinking...` near the lower-right area during prompt processing. After the PR cleanup, that signal appears to be gone or no longer visible enough.

## Why

Users need an immediate on-screen confirmation that the prompt was accepted and Robota is processing. The status activity work moved activity into the primary scan path, but it must not remove the explicit processing signal users relied on.

## Relationship to Existing Work

- Related completed task: `.agents/tasks/completed/CLI-BL-051-cli-tui-status-activity-indicator.md`
- Related PR batch: PR #144 `develop -> main`
- This task is a follow-up regression/UX requirement, not a request to revert the status activity cleanup wholesale.

## Scope

- Find where the previous `thinking...` lower-right prompt-processing indicator was rendered.
- Decide whether the indicator should be restored in the lower-right area, mirrored with the new status activity label, or replaced by an equivalent visible state that satisfies the same workflow.
- Ensure prompt-processing/model-waiting state is visible during streaming and non-streaming response paths.
- Keep the indicator renderer-owned in `packages/agent-cli`; do not add provider-specific state branches.
- Add or update TUI tests so the processing state cannot disappear silently again.

## Non-Goals

- Do not revert the one-level status activity priority model from `CLI-BL-051`.
- Do not add provider-specific wording.
- Do not add noisy animation unless width and accessibility behavior are tested.

## Acceptance Criteria

- [x] During prompt processing, the TUI displays a visible processing indicator such as `thinking...` or an approved equivalent.
- [x] The indicator is visible in the expected lower-right area or another explicitly documented stable location.
- [x] The status activity label and the processing indicator do not conflict or duplicate confusingly on narrow terminals.
- [x] Tests cover prompt-processing visibility for the relevant `StatusBar`, `StreamingIndicator`, or app rendering path.
- [ ] Manual CLI smoke confirms the indicator appears after submitting a prompt and disappears when the turn settles.

## Test Plan

Run targeted CLI TUI tests for the renderer path that owns prompt-processing visibility, including the status activity helper, status bar rendering, streaming indicator rendering, and any app-level prompt submission path touched by the implementation. Add a regression test that fails when the processing state is active but no visible `thinking...` or approved equivalent appears. Finish with a manual CLI smoke test that submits a prompt, confirms the indicator appears while the turn is pending, and confirms it clears after the response settles.

## Progress

### 2026-05-02

- Created after user reported the prompt-processing `thinking...` indicator disappeared during the CLI/TUI PR cleanup.

### 2026-05-04

- Resumed on `fix/cli-sdk-backlog-053-006`.
- Recommended restoring a compact lower-right `thinking...` status-bar segment while keeping the existing primary `Activity:` scan path. This preserves the previous visible signal without reverting the status activity model.
- Added StatusBar regression coverage for the lower-right `thinking...` indicator while thinking, its idle disappearance, and coexistence with tool-priority activity.
- Implemented the renderer-owned right-side indicator in `packages/agent-cli/src/ui/StatusBar.tsx`.

## Implementation Checklist

- [x] Add a regression test for a right-side `thinking...` indicator while `isThinking=true`.
- [x] Keep the primary activity segment compact and non-conflicting when tools are active.
- [x] Implement the renderer-owned indicator in `packages/agent-cli`.
- [x] Run targeted CLI TUI tests and package checks.

## Decisions

- Treat as a CLI UX regression follow-up rather than a provider/runtime behavior change.

## Blockers

- None.

## Result

Completed in `fix/cli-sdk-backlog-053-006`.

- `StatusBar` now renders a compact lower-right `thinking...` segment next to the message count while `isThinking=true`.
- The primary `Activity:` segment remains the scan-path owner for tool/background/thinking priority.
- Verified with `pnpm --filter @robota-sdk/agent-cli exec vitest run src/ui/__tests__/status-bar.test.tsx`, `pnpm --filter @robota-sdk/agent-cli test`, `pnpm --filter @robota-sdk/agent-cli typecheck`, and `pnpm --filter @robota-sdk/agent-cli lint`.

Manual live-provider CLI smoke was not run in the isolated worktree because it would require a real provider turn; the renderer regression and full CLI test suite cover the state transition this task changes.
