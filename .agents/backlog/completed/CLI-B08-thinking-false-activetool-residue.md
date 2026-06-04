---
title: 'CLI-B08: thinking(false) 시 activeTools가 초기화되지 않아 잔존 가능'
status: done
created: 2026-05-31
priority: low
urgency: eventually
area: packages/agent-transport
---

## 증상

`thinking(false)` 이벤트가 발화될 때 `activeTools`가 초기화되지 않아, 정상 흐름(thinking → complete)을 벗어나는 경우에 완료된 툴 항목이 화면에 남을 수 있다.

## 근본 원인

`TuiStateManager.onThinking`:

```typescript
onThinking = (thinking: boolean): void => {
  this.isThinking = thinking;
  if (thinking) {
    // 새 실행 시작: 버퍼와 activeTools 초기화
    this.streamBuf = '';
    this.streamingText = '';
    this.activeTools = [];
  } else {
    this.isAborting = false; // false일 때는 isAborting만 해제, activeTools 미초기화
  }
  this.notify();
};
```

`thinking(false)` 이후에는 보통 `complete` 또는 `interrupted`가 뒤따라 `activeTools = []`를 처리한다. 그러나 두 이벤트가 오지 않는 예외 경로(예: 빠른 abort, 세션 초기화 실패 등)에서 `activeTools`가 잔존할 수 있다.

### 영향 범위

정상 흐름에서는 `complete`가 항상 `activeTools = []`를 처리하므로 실제 발현 빈도가 낮다. 그러나 `interrupted` 경로나 예외 상황에서 재현 가능하다.

## Done gate

- [ ] `thinking(false)` 시 `activeTools`가 초기화됨 (또는 동일 효과가 다른 경로로 보장됨)
- [ ] `pnpm --filter @robota-sdk/agent-transport test` 통과

## User Execution Test Scenarios

### Scenario 1: abort 후 잔존 툴 없음

1. `pnpm robota` 실행
2. 툴 실행이 발생하는 프롬프트 입력
3. 툴 실행 중 ESC로 abort
4. **기대**: abort 후 StreamingIndicator가 사라지고 완료되지 않은 툴이 화면에 잔존하지 않음
