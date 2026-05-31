---
title: 'CLI-B06: AI 호출 오류 시 사용자에게 아무 피드백이 없음'
status: done
created: 2026-05-31
priority: critical
urgency: now
area: packages/agent-transport
depends_on: [CLI-B05]
---

## 증상

AI 호출 중 네트워크 오류, API 오류 등이 발생할 경우:

- 스트리밍 텍스트가 사라짐 (`onError`가 `streamingText = ''` 처리)
- MessageList에 오류 메시지가 표시되지 않음
- 사용자는 무슨 일이 일어났는지 알 수 없음 — **무음 실패(silent failure)**

## 근본 원인

`TuiInteractionChannel.wireSessionEvents()`의 현재 `onError` 핸들러:

```typescript
const onError = (): void => {
  manager.onError(); // 스트리밍 버퍼만 초기화
  manager.syncHistory(session.getFullHistory()); // session이 error entry를 history에 넣었을 때만 표시됨
};
```

`manager.onError()`는 `streamingText`, `activeTools`만 초기화하고 오류 내용을 stateManager에 직접 추가하지 않는다. `syncHistory(getFullHistory())`는 `InteractiveSession`이 오류 항목을 자체 히스토리에 기록한 경우에만 화면에 표시된다.

### 조사 필요 사항

- `InteractiveSession`이 `error` 이벤트 발화 시 자체 히스토리에 오류 항목을 추가하는지 확인
- 추가하지 않는다면 TUI 측에서 `stateManager.addEntry(errorEntry)`를 직접 호출해야 함

## Done gate

- [x] `error` 이벤트 발화 시 오류 메시지가 MessageList에 즉시 표시됨
- [x] `pnpm --filter @robota-sdk/agent-transport test` 통과 (450/450)

## Implementation notes

조사 결과: `interactive-session-prompt.ts`에서 error entry를 `histTracker.push()` 후 `ctx.onError()` 호출 순서 확인.
즉, `error` 이벤트 발화 시점에 이미 `getFullHistory()`에 error entry 포함.
`wireSessionEvents()`의 `onError` 핸들러가 `syncHistory(session.getFullHistory())`를 호출하므로 자동 해결됨.
D3 display-contract test로 회귀 방지 확보.

## User Execution Test Scenarios

### Scenario 1: API 오류 시 오류 메시지 표시

1. 유효하지 않은 API 키로 `pnpm robota` 실행
2. "hello" 입력
3. **기대**: "오류 발생: ..." 등의 오류 메시지가 MessageList에 표시됨
