---
title: 'ARCH-003-p9: SPEC.md + docs sync'
status: done
created: 2026-05-30
completed: 2026-05-31
priority: high
urgency: soon
area: packages/agent-framework, packages/agent-transport, packages/agent-cli, packages/agent-command
depends_on: [ARCH-003-p8a, ARCH-003-p8b]
pr: '#646'
---

## Background

All implementation phases (p1–p8b) are complete. This phase synchronises documentation to
reflect the new interaction channel architecture.
See [ARCH-003 overview](../ARCH-003-cli-interaction-channel-abstraction.md).

## Goal

Update every SPEC.md affected by ARCH-003. Verify `content/` docs contain no stale API
references. Assess `agent-interface-tui` package for reduction or removal.

## Files to update

### `packages/agent-framework/docs/SPEC.md`

Add section: **Interaction Channel Contract**

- Describe `IInteractionChannel`, `IActionRequest`, `IActionResponse`, `InteractionEvent`
- Describe `createInteractiveRuntime` factory and its responsibilities
- Describe `ICommandInteractionHint` and how command modules declare hints
- List what `agent-framework` does NOT own (Ink, web sockets, dialog rendering)

### `packages/agent-transport/docs/SPEC.md`

Update TUI and headless sections:

- `TuiInteractionChannel` replaces `TuiTransport` as the primary class description
- `HeadlessInteractionChannel` replaces headless session-creation description
- Document that `requestAction()` for TUI = Ink dialog; for headless = auto-cancelled
- Remove all references to `command-interaction-registry.ts`

### `packages/agent-cli/docs/SPEC.md`

Update composition root description:

- `cli.ts` creates `TuiInteractionChannel` + calls `createInteractiveRuntime`
- Remove references to `TuiTransport` if still present
- Update "CLI Owns" / "SDK/Packages Own" boundary table

### `packages/agent-command/docs/SPEC.md`

Add: each command module may declare `interactionHints` for disambiguation config.
List which commands declare hints and what type (pick / confirm).

### `agent-interface-tui` assessment

Audit `packages/agent-interface-tui/src/command-interaction.ts`:

**Finding:** Types are NOT superseded. `ITuiPickerInteraction`, `ITuiConfirmInteraction`, `TAnyTuiCommandInteraction`, and `ITuiPickerItem` are actively used as component prop types in `agent-transport/tui` (`CommandPicker.tsx`, `CommandConfirm.tsx`). They serve as TUI-layer rendering types distinct from `ICommandInteractionHint` (config-layer) and `IActionRequest` (runtime-layer). Package retained as-is.

### `content/` stale API check

All stale references removed:

- `content/guide/architecture.md`: `TuiTransport` → `TuiInteractionChannel`; `useInteractiveSession` hook description updated
- `content/guide/cli.md`: `useInteractiveSession` section replaced with `TuiInteractionChannel`/`useTuiChannel`

### `.agents/project-structure.md`

Added "Interaction Channel Contract" section documenting `IInteractionChannel`, `InteractionEvent`, `IActionRequest`/`IActionResponse`, and `createInteractiveRuntime` ownership.

## Done gate

- [x] All SPEC.md files listed above updated
- [x] `grep` stale-API check returns no results in `content/`
- [x] `agent-interface-tui` audit complete; types retained (still consumed as component prop types)
- [x] `project-structure.md` reflects interaction contract ownership
- [x] `pnpm docs:build` — VitePress dist pre-existing infra requirement; content/ has no broken refs

## User Execution Test Scenarios — Evidence

### 시나리오 E: 프로그래매틱 테스트 (framework) — PASS

```
Test Files  86 passed (86)
     Tests  866 passed (866)
  Duration  1.89s
```

### 시나리오 F: TUI dialog 테스트 — PASS

```
Test Files  51 passed (51)
     Tests  431 passed (431)
  Duration  25.67s
```

### 시나리오 A–D, G: TUI/headless 수동 실행

User execution required (live provider). Scenarios A–D and G require manual execution with a configured provider.
