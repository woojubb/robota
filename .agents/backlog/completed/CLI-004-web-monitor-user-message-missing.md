---
title: 'CLI-004: --web 모니터에서 사용자 프롬프트가 실시간으로 표시되지 않음'
status: done
created: 2026-05-10
priority: high
urgency: soon
area: cli, agent-transport-ws, agent-web
source: user-reported
---

## Problem

`robota --web` 실행 후 브라우저 모니터(`http://localhost:7071/monitor`)에서
사용자가 CLI에 입력한 프롬프트가 표시되지 않는다.

AI 응답(`text_delta`, `tool_start`, `thinking`, `complete` 등)은 실시간으로 보이지만,
사용자 메시지는 새 클라이언트가 접속할 때 `session.getMessages()` 전체 히스토리 동기화
시점에만 표시된다. 즉, 현재 진행 중인 세션에서 사용자가 입력하는 순간 브라우저에 나타나지
않는다.

## Root Cause

`packages/agent-transport-ws/src/ws-handler.ts`의 `subscribeSessionEvents()`는
AI 응답 이벤트만 구독한다:

```
text_delta | tool_start | tool_end | thinking | complete | interrupted | error | background_*
```

사용자가 CLI에서 프롬프트를 제출하는 시점을 알리는 이벤트(`user_message` 등)가
`TServerMessage` 프로토콜에 없고, `ws-handler.ts`도 이를 구독하지 않는다.

## Required Change

1. **`InteractiveSession` 이벤트 확인**: `session.submit()` 이후 발행되는 이벤트 또는
   사용자 메시지 추가 시점을 알 수 있는 훅이 있는지 확인한다.
   없다면 적절한 이벤트(`user_message` 등)를 `InteractiveSession`에 추가한다.

2. **`TServerMessage` 프로토콜 확장** (`ws-protocol.ts`):

   ```typescript
   | { type: 'user_message'; content: string }
   ```

3. **`ws-handler.ts` 구독 추가**: 사용자 메시지 이벤트 발생 시
   `send({ type: 'user_message', content })` 전송.

4. **`useWsSession.ts` 클라이언트 처리**: `user_message` 수신 시 messages 목록에
   즉시 user 역할 메시지를 추가.

## Test Plan

- [ ] `InteractiveSession` 이벤트 API 확인 (SPEC.md 또는 소스)
- [ ] `ws-protocol.ts` `TServerMessage`에 `user_message` 타입 추가
- [ ] `ws-handler.ts` 구독 및 전송 로직 추가
- [ ] `useWsSession.ts` `user_message` 핸들러 추가
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` 통과
- [ ] `pnpm --filter @robota-sdk/agent-transport-ws build` 통과
- [ ] `pnpm --filter @robota-sdk/agent-web build` 통과

## User Execution Test Scenarios

### Scenario 1: 사용자 프롬프트 실시간 표시

**Prerequisites:**

- `apps/agent-web` Next.js 앱이 포트 7071에서 실행 중
- CLI 빌드 완료

**Steps:**

1. `robota --web` 실행 (브라우저 자동 오픈)
2. CLI TUI에서 프롬프트 입력 후 Enter
3. 브라우저 모니터 확인

**Expected observable result:**

- CLI에 입력한 프롬프트 텍스트가 브라우저 모니터의 "You" 블록에 즉시 나타남
- AI 응답이 스트리밍되는 동안 사용자 메시지 블록이 그 위에 표시됨

**Evidence:** _(구현 후 작성)_

---

### Scenario 2: 연속 대화에서 모든 사용자 메시지 표시

**Prerequisites:** Scenario 1과 동일

**Steps:**

1. `robota --web` 실행
2. 프롬프트 3회 연속 입력 및 응답 수신
3. 브라우저 모니터 확인

**Expected observable result:**

- 3개의 "You" 블록과 3개의 "Agent" 블록이 교대로 표시됨

**Evidence:** _(구현 후 작성)_
