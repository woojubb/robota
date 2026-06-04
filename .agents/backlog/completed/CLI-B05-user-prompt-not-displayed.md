---
title: 'CLI-B05: 사용자 입력 프롬프트가 MessageList에 표시되지 않음 — INFRA-001 회귀'
status: done
created: 2026-05-31
priority: critical
urgency: now
area: packages/agent-transport
regression_introduced_by: INFRA-001 (fix/infra-001-tui-channel-lifecycle, PR #650)
---

## 증상

INFRA-001 수정 후:

- **AI 응답은 화면에 정상 표시됨** — INFRA-001 수정 효과
- **사용자가 입력한 프롬프트 텍스트가 MessageList에 나타나지 않음** — 사용자가 무엇을 물었는지 화면에서 확인 불가

## 근본 원인 분석

`wireSessionEvents()`의 `user_message` 이벤트 핸들러:

```typescript
const onUserMessage = (content: string): void => this.handleAutoNaming(content);
session.on('user_message', onUserMessage);
```

`handleAutoNaming`은 세션 자동 이름 생성만 처리하고 `stateManager.addEntry()` 또는 `syncHistory()`를 호출하지 않는다.

사용자 메시지가 stateManager에 들어오는 경로는 현재:

| 경로                                          | 타이밍           | 상태                         |
| --------------------------------------------- | ---------------- | ---------------------------- |
| `complete` → `syncHistory(getFullHistory())`  | AI 응답 완료 후  | ✅ 동작 (INFRA-001에서 추가) |
| `compact` → `syncHistory(getFullHistory())`   | 컨텍스트 압축 시 | ✅ 동작                      |
| `user_message` → `stateManager.addEntry(...)` | 즉시             | ❌ 없음                      |

### 가능한 원인 두 가지

1. **즉시 표시 경로 없음**: `user_message` 이벤트에서 stateManager에 즉시 추가하지 않아, AI가 응답하기 전까지 사용자 메시지가 화면에 없음
2. **`getFullHistory()` 미포함**: `complete` 시 `getFullHistory()`가 user 메시지를 포함하지 않거나 다른 format으로 반환하여 `syncHistory` 후에도 표시되지 않음

## 조사 순서

1. `packages/agent-framework` `InteractiveSession.getFullHistory()` 반환값 확인 — user 메시지 포함 여부
2. `packages/agent-framework` `InteractiveSession.submit()` 내부 — `user_message` 이벤트 발화 시점과 history 추가 시점
3. `packages/agent-transport/src/tui/TuiInteractionChannel.ts` `wireSessionEvents()` — `user_message` 핸들러 개선 지점

## 예상 수정 방향

`user_message` 핸들러에서 즉시 stateManager에 추가:

```typescript
const onUserMessage = (content: string): void => {
  this.handleAutoNaming(content);
  // user 메시지를 IHistoryEntry 형식으로 변환하여 즉시 추가
  manager.addEntry(/* user message entry */);
};
```

단, `complete` 시 `syncHistory(getFullHistory())`가 전체 히스토리를 덮어쓰므로 중복 없이 처리 가능한지 확인 필요.

## Done gate

- [ ] 회귀 원인 특정 완료
- [ ] 사용자 메시지가 submit 직후 MessageList에 표시됨
- [ ] AI 응답도 정상 표시됨 (INFRA-001 수정 유지)
- [ ] `pnpm --filter @robota-sdk/agent-transport test` 전체 통과

## User Execution Test Scenarios

### Scenario 1: 사용자 메시지 즉시 표시

1. `pnpm robota` 실행
2. "hello" 입력 후 Enter
3. **기대**: 사용자 메시지 "hello"가 MessageList에 즉시 표시되고, 이후 AI 응답도 표시됨

### Scenario 2: slash command와 일반 입력 혼합

1. `/help` 입력 → help 내용 표시
2. "what can you do?" 입력 → 사용자 메시지 표시 후 AI 응답 표시
3. **기대**: 두 유형 모두 화면에 올바르게 표시됨
