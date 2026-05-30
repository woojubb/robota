---
title: 'CLI-B07: tool_end 후 완료된 툴이 activeTools에 잔존 — StreamingIndicator 오표시'
status: todo
created: 2026-05-31
priority: medium
urgency: soon
area: packages/agent-transport
---

## 증상

툴 실행이 완료된 후(`tool_end`) `complete` 이벤트가 오기 전 짧은 순간:

- `activeTools` 배열에 `isRunning: false`인 툴이 남아 있음
- App.tsx의 렌더 조건 `(isThinking || activeTools.length > 0)` 에 의해 StreamingIndicator가 계속 표시됨
- 이미 완료된 툴을 "실행 중"처럼 보여주는 시각적 오류

## 근본 원인

`TuiStateManager.onToolEnd`:

```typescript
onToolEnd = (state: IToolState): void => {
  const idx = this.activeTools.findLastIndex((t) => t.toolName === state.toolName && t.isRunning);
  if (idx !== -1) {
    const updated = [...this.activeTools];
    updated[idx] = state; // isRunning: false로 업데이트만 함, 배열에서 제거 안 함
    this.activeTools = updated;
  }
  this.notify();
};
```

`complete` / `interrupted` / `error`가 오면 `activeTools = []`로 초기화되므로 정상 흐름에서는 짧게 나타난다. 그러나 여러 툴이 순차 실행될 때, 혹은 느린 렌더 환경에서는 사용자가 인지할 수 있다.

### 조사 필요 사항

- `tool_end` 시 `isRunning: false`인 툴을 즉시 배열에서 제거하는 게 맞는지, 아니면 "완료됨" 상태로 잠깐 표시 후 제거하는 게 맞는지 UX 결정 필요
- StreamingIndicator가 `isRunning: false`인 항목을 어떻게 렌더하는지 확인

## Done gate

- [ ] `tool_end` 후 완료된 툴이 불필요하게 StreamingIndicator에 잔존하지 않음
- [ ] `pnpm --filter @robota-sdk/agent-transport test` 통과

## User Execution Test Scenarios

### Scenario 1: 툴 실행 완료 후 StreamingIndicator 상태

1. `pnpm robota` 실행
2. 파일 읽기나 bash 툴이 실행되는 프롬프트 입력
3. **기대**: 툴 실행 완료 후 AI가 응답 중일 때는 StreamingIndicator만 표시, 완료된 툴 항목이 잔존하지 않음
