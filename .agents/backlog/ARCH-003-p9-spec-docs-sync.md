---
title: 'ARCH-003-p9: SPEC.md + docs sync'
status: todo
created: 2026-05-30
priority: high
urgency: soon
area: packages/agent-framework, packages/agent-transport, packages/agent-cli, packages/agent-command
depends_on: [ARCH-003-p8a, ARCH-003-p8b]
---

## Background

All implementation phases (p1–p8b) are complete. This phase synchronises documentation to
reflect the new interaction channel architecture.
See [ARCH-003 overview](ARCH-003-cli-interaction-channel-abstraction.md).

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

- `ITuiPickerInteraction`, `ITuiConfirmInteraction`, `TAnyTuiCommandInteraction` —
  superseded by `IActionRequest` in `agent-framework`. Remove if no other consumers.
- `ITuiPickerItem` — superseded by `IPickItem` in `agent-framework`. Remove if no other consumers.
- Any remaining types that are NOT covered by framework types → keep with updated JSDoc.
- If the package is empty after removal, deprecate and schedule for deletion in a follow-up.

### `content/` stale API check

```bash
# Check for stale references to removed/renamed APIs
grep -r 'TuiTransport'                  content/
grep -r 'useInteractiveSession'         content/
grep -r 'command-interaction-registry'  content/
grep -r 'ITuiPickerInteraction'         content/
grep -r 'ITuiConfirmInteraction'        content/
```

Replace any found references with updated API names.

### `.agents/project-structure.md`

Add note under `agent-framework`:

> Owns the `IInteractionChannel` contract and `createInteractiveRuntime` factory.
> Transport packages implement `IInteractionChannel`; `agent-cli` composes them.

## Done gate

- [ ] All SPEC.md files listed above updated
- [ ] `grep` stale-API check returns no results in `content/`
- [ ] `agent-interface-tui` audit complete; superseded types removed or documented
- [ ] `project-structure.md` reflects interaction contract ownership
- [ ] `pnpm docs:build` succeeds (no broken references)

## User Execution Test Scenarios (full regression, run after p9)

### 시나리오 A: TUI — args 있는 커맨드

```bash
pnpm robota
# /mode plan
```

기대: 다이얼로그 없이 즉시 mode 변경

### 시나리오 B: TUI — args 없는 커맨드

```bash
# /mode
```

기대: picker 표시 → 선택 → mode 변경 (외관 동일)

### 시나리오 C: TUI — confirm 커맨드

```bash
# /exit
```

기대: confirm 표시 → y → 종료

### 시나리오 D: 헤드리스

```bash
pnpm robota -p "hello"
```

기대: AI 응답 출력, 종료 코드 0

### 시나리오 E: 프로그래매틱 테스트 (framework)

```bash
pnpm --filter @robota-sdk/agent-framework test
```

기대: 전체 통과, PTY 없음

### 시나리오 F: TUI dialog 테스트

```bash
pnpm --filter @robota-sdk/agent-transport test
```

기대: picker/confirm 테스트 전체 통과

### 시나리오 G: Web 채널 타입 호환 검증

`WebInteractionChannel implements IInteractionChannel` 스켈레톤이 타입 에러 없이 컴파일됨
