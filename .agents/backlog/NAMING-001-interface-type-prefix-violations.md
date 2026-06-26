---
title: 'NAMING-001: Fix I-/T-prefix interface/type naming violations + add a mechanical guard'
status: todo
created: 2026-06-27
priority: low
urgency: soon
area: packages (multiple), .eslintrc.json
depends_on: []
---

# Fix I-/T-prefix naming violations + enforce mechanically

## What

`code-quality.md` mandates `I*` for interfaces and `T*` for type aliases; the reverse (or
neither) is a violation. Found 2026-06-27 (verified samples):

**Type aliases wrongly using `I*` (should be `T*`):**

- `agent-interface-transport/src/interaction-contracts.ts:34` `IActionRequest`
- `…interaction-contracts.ts:38` `IActionResponse`
- `…interaction-contracts.ts:50` `ICommandInteractionHint`
- `agent-session-analytics/src/types.ts:12` `ISessionAnalysisInput`
- `agent-transport-tui/src/tui-state-manager.ts:28` `IContextState`

**Interfaces wrongly using `T*` (should be `I*`):**

- `agent-tools/src/types/tool-result.ts:4` `TToolResult`
- `agent-preset/src/preset-types.ts:32` `TResolvedPresetOptions`

**Interface missing the `I` prefix:**

- `agent-framework/src/utils/skill-prompt.ts:5` `SkillPromptContext`

Rename each to the correct prefix and update all references/SPECs. `TToolResult` is widely
used — rename carefully across consumers.

Secondary (prevent recurrence): add an ESLint `@typescript-eslint/naming-convention` rule that
enforces `I`-prefix for `interface` and `T`-prefix for `typeAlias`, so a future violation fails
lint (pairs with HARNESS-019's `consistent-type-definitions`). This turns a prose convention
into a mechanical gate.

## Why

The naming convention is documented but unenforced, so violations accumulate (8 found in one
sweep); a mechanical rule plus a one-time cleanup makes the convention real and self-policing.

## Done When

- All listed symbols use the correct `I`/`T` prefix; references/SPECs updated; `pnpm typecheck`
  passes.
- An ESLint naming-convention rule enforces the interface/type prefix; `pnpm lint` passes and a
  deliberate violation fails lint.

## Test Plan

- Grep `export type I*` and `export interface T*` / unprefixed exported interfaces across
  shipped `src/` → 0 violations.
- Add a throwaway `export type IBad = string` → `pnpm lint` errors; remove it.

## User Execution Test Scenarios

Not applicable — naming refactor + lint rule; no runtime behavior change. Evidence = 0 grep
violations + lint rule rejecting a planted violation.
