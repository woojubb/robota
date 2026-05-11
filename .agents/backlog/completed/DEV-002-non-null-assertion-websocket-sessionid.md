---
title: 'DEV-002: WebSocket handler client.sessionId! non-null assertion — 런타임 크래시 위험'
status: done
created: 2026-05-10
priority: high
urgency: now
area: server
source: dev-prelaunch-report-2026-05-10
---

## Problem

`apps/agent-server/src/websocket-server.ts:143`에서 `client.sessionId!`를 non-null assertion으로 사용한다.

```typescript
case 'playground_update':
    if (client.isAuthenticated) {
        this.broadcastToSession(client.sessionId!, message, clientId);
    } else {
        this.sendError(clientId, 'Authentication required');
    }
```

현재 로직상 `isAuthenticated`가 `true`이면 `sessionId`도 반드시 설정되어 있어 실제 버그는 아니다. 그러나 인증 흐름이 리팩터링되면 assertion이 깨지면서 `Cannot read property of undefined` 런타임 크래시가 발생한다. 같은 패턴이 `lines 203, 226`에도 존재한다(`this.userSessions.get(userId)!`).

## Required Change

명시적 null guard로 교체하여 타입 시스템이 안전성을 보장하도록 한다.

```typescript
// Before
this.broadcastToSession(client.sessionId!, message, clientId);

// After
if (client.isAuthenticated && client.sessionId !== undefined) {
  this.broadcastToSession(client.sessionId, message, clientId);
} else if (client.isAuthenticated) {
  // sessionId가 없는 authenticated 상태는 버그 — 에러 로깅
  this.sendError(clientId, 'Session state error: missing sessionId');
}
```

`userSessions.get(userId)!` 패턴도 동일하게 수정: `.get()` 결과를 변수에 받아 `undefined` 체크 후 사용.

## Scope

- `apps/agent-server/src/websocket-server.ts` (lines 143, 203, 226)

## Test Plan

1. `pnpm --filter @robota-sdk/agent-server typecheck` — non-null assertion 제거 후 타입 오류 없음 확인
2. `pnpm --filter @robota-sdk/agent-server build` — 빌드 성공 확인
3. 인증 흐름 단위 테스트: `isAuthenticated=true, sessionId=undefined` 케이스에서 크래시 없이 에러 메시지 반환 확인

## User Execution Test Scenarios

### Scenario 1: 인증 후 playground_update 메시지 처리

**Prerequisites**: agent-server 로컬 실행, WebSocket 클라이언트(wscat 또는 테스트 스크립트)

**Steps**:

```bash
# agent-server 시작
pnpm --filter @robota-sdk/agent-server dev

# WebSocket 연결 및 인증
wscat -c ws://localhost:3001/ws
# auth 메시지 전송 후 playground_update 메시지 전송
```

**Expected observable result**: 크래시 없이 정상 처리 또는 명확한 에러 메시지 반환

**Evidence**: (구현 후 기록)
