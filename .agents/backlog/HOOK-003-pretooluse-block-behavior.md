---
title: 'HOOK-003: PreToolUse 차단 동작 Claude Code 호환 방식으로 수정'
status: todo
created: 2026-05-09
priority: high
urgency: soon
area: hooks
depends_on: HOOK-001
---

## Problem

CC 스펙에서 PreToolUse 훅이 exit 2를 반환하면 stderr가 사용자에게 표시되고 도구 실행 자체가 취소된다.
AI는 도구 실행 결과를 받지 않는다.

SDK 현재 동작:

- `tool-hook-helpers.ts`의 `runPreToolHook()`이 `{ success: false, error: "Blocked by hook: ..." }`를 **tool result로 반환**
- AI는 "도구가 실행되어 실패했다"는 결과를 받고 대화를 계속 진행
- CC 기준 훅 작성자가 예상하는 "차단 후 재계획" 흐름과 다름

## Required Change

### `packages/agent-sessions/src/tool-hook-helpers.ts`

`runPreToolHook()`의 반환값 처리를 `PermissionEnforcer`가 인식할 수 있는 신호로 변경.

현재:

```typescript
if (hookResult.blocked) {
  return {
    success: true,
    data: JSON.stringify({
      success: false,
      output: '',
      error: `Blocked by hook: ${hookResult.reason}`,
    }),
    metadata: {},
  };
}
```

변경 방향:

- `blocked: true`일 때 `null`이 아닌 별도의 "blocked" 신호를 반환
- `PermissionEnforcer.wrapToolWithPermission()`에서 이 신호를 받으면 tool result를 history에 추가하지 않고 차단 사유를 stderr/UI로만 전달

또는 더 단순한 방향:

- tool result는 반환하되, 메시지 포맷을 CC와 동일하게 맞추고 AI에게 "재계획 요청" 신호를 줌

**설계 결정이 필요하므로 구현 전 사용자 컨펌 필요.**

## Design Options

**Option A (CC 완전 호환):** blocked 시 tool result history 항목 자체를 추가하지 않음. 대신 다음 AI 메시지에 차단 사유를 system-reminder로 주입. 구현 복잡도: 높음.

**Option B (실용적 호환):** 현재처럼 tool result는 반환하되, 포맷을 `{ "blocked": true, "reason": "..." }`로 변경. AI가 차단 인식 후 재계획하도록 유도. 구현 복잡도: 낮음.

## Test Plan

- PreToolUse 훅이 exit 2를 반환할 때 AI conversation history를 확인
- CC 동작과 일치하는지 비교

## User Execution Test Scenarios

실제 훅 스크립트를 연결하고 차단 시나리오를 테스트하여 AI 재계획 동작 확인.
