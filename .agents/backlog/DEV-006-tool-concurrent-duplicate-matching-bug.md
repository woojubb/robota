---
title: 'DEV-006: onToolEnd 중복 도구 이름 매칭 버그 — 동시 동일 도구 실행 시 상태 불일치'
status: todo
created: 2026-05-10
priority: high
urgency: soon
area: cli
source: dev-prelaunch-report-2026-05-10
---

## Problem

`packages/agent-cli/src/ui/tui-state-manager.ts:90`의 `onToolEnd`에서 활성 도구를 `toolName`으로만 매칭한다.

```typescript
onToolEnd = (state: IToolState): void => {
    const idx = this.activeTools.findIndex(
        (t) => t.toolName === state.toolName && t.isRunning  // 이름만으로 매칭
    );
    ...
};
```

동일한 도구(예: `Bash`)가 동시에 두 번 실행되면 `findIndex`는 첫 번째 항목만 반환한다. 두 번째 실행이 완료되어도 첫 번째 항목이 잘못 업데이트되고, 두 번째 항목은 영구적으로 "실행 중" 상태로 남아 TUI에 표시된다.

## Required Change

도구 호출을 안정적인 `toolCallId`로 식별한다. `IToolState`가 `toolCallId`를 제공하는지 확인하고, 제공한다면 `onToolStart`에서 ID를 기록하여 `onToolEnd`에서 매칭한다. SDK가 call ID를 제공하지 않는다면 삽입 순서 기반 인덱스로 추적한다.

```typescript
// IToolState에 toolCallId가 있는 경우
onToolEnd = (state: IToolState): void => {
    const idx = this.activeTools.findIndex(
        (t) => t.toolCallId === state.toolCallId
    );
    ...
};

// toolCallId가 없는 경우 — onToolStart에서 인덱스 기반 추적
private toolStartOrder: Map<string, number[]> = new Map();

onToolStart = (state: IToolState): void => {
    const order = this.toolStartOrder.get(state.toolName) ?? [];
    order.push(this.activeTools.length);
    this.toolStartOrder.set(state.toolName, order);
    this.activeTools.push({ ...state, isRunning: true });
    this.notify();
};

onToolEnd = (state: IToolState): void => {
    const order = this.toolStartOrder.get(state.toolName);
    const idx = order?.shift() ?? -1;
    if (idx !== -1) {
        this.activeTools[idx] = { ...this.activeTools[idx], isRunning: false };
    }
    this.notify();
};
```

## Scope

- `packages/agent-cli/src/ui/tui-state-manager.ts`
- `IToolState` 인터페이스 확인 (toolCallId 존재 여부)

## Test Plan

1. 동일 도구 2회 동시 실행 시나리오 단위 테스트 추가
2. `onToolStart` 2회 → `onToolEnd` 2회 호출 후 `activeTools`에 완료 상태 2개 확인
3. `pnpm --filter @robota-sdk/agent-cli test` — 기존 테스트 통과 확인
4. `pnpm --filter @robota-sdk/agent-cli typecheck` — 타입 오류 없음 확인

## User Execution Test Scenarios

### Scenario 1: 병렬 Bash 도구 실행 후 TUI 상태 확인

**Prerequisites**: robota CLI TUI 모드, 병렬 도구 실행을 트리거하는 프롬프트

**Steps**:

```bash
robota
# TUI 시작 후
# 병렬 도구 실행을 유도하는 프롬프트 입력
# 예: "동시에 두 파일을 읽어서 비교해줘"
```

**Expected observable result**: 두 도구가 모두 완료된 후 TUI의 도구 상태 표시에서 두 항목 모두 완료(running 아님)로 표시됨. 이전에는 하나가 영구적으로 "실행 중"으로 남음.

**Evidence**: (구현 후 기록)
