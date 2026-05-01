# CLI TUI Input Flow Migration

- **Status**: completed
- **Created**: 2026-04-30
- **Branch**: test/cli-tui-pty-e2e-harness
- **Scope**: packages/agent-cli

## Objective

Move prompt and input semantics out of Ink `useInput` handlers into pure flow modules. TUI components should translate terminal key events into flow actions and apply flow results, while unit tests cover the behavior without rendering Ink.

## Plan

- [x] Extract text prompt input semantics into a pure flow with unit tests.
- [x] Extract selection prompt semantics for confirm/list/menu/permission prompts into pure flows with unit tests.
- [x] Extract input-area autocomplete and paste-label behavior into a pure flow with unit tests.
- [x] Extract CJK text input editing and paste handling into a pure flow with unit tests.
- [x] Update TUI components to use the flow modules as thin shells.
- [x] Update package SPEC to document TUI input flow ownership.
- [x] Run targeted tests, full agent-cli tests, typecheck, lint, build, and harness scan.

## Test Plan

Each migrated flow must have Given/When/Then-style unit assertions that call pure functions directly: text prompt submit/cancel/editing, bounded and wrapping selection, confirmation and permission shortcuts, slash autocomplete submit/tab behavior, paste-label insertion, CJK cursor movement, bracketed paste, multiline paste, and submit effects. Existing Ink component tests remain as integration coverage for terminal wiring, and the PTY E2E harness verifies real pseudo-terminal behavior for provider setup.

## Progress

### 2026-04-30

- Started after PTY E2E harness implementation when the migration scope was expanded to all TUI input-linked semantics.
- Added `src/ui/flows/*` modules for text prompt, shared selection, confirmation, permission, input area, and CJK text input behavior.
- Added direct unit tests for every new flow, using Given/When/Then-style assertions.
- Updated `TextPrompt`, `ConfirmPrompt`, `ListPicker`, `MenuSelect`, `PermissionPrompt`, `InputArea`, and `CjkTextInput` to delegate input meaning to flow modules.
- Updated `packages/agent-cli/docs/SPEC.md` with TUI input flow ownership and file structure.
- Verified targeted flow/component tests, full agent-cli tests, typecheck, lint, build, and `pnpm harness:scan`.

## Decisions

- Keep React/Ink components as imperative shells; pure flow modules own key meaning and state transitions.
- Preserve existing component behavior first, then rely on unit tests for the extracted flow contracts.
- Keep PTY E2E focused on terminal wiring; migrated flow semantics are covered by fast unit tests.

## Blockers

- None.

## Result

Migrated TUI input-linked semantics out of Ink handlers into pure flow modules with unit tests. Components now translate terminal input into flow actions and apply returned effects. Full verification passed, including `@robota-sdk/agent-cli` tests, typecheck, lint, build, and repository harness scan.
