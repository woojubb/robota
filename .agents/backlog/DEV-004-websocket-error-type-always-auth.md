---
title: 'DEV-004: sendError가 모든 에러에 type:auth 전송 — 잘못된 WebSocket 프로토콜'
status: todo
created: 2026-05-10
priority: high
urgency: soon
area: server
source: dev-prelaunch-report-2026-05-10
---

## Problem

`apps/agent-server/src/websocket-server.ts:250-259`의 `sendError` 메서드가 인증 오류가 아닌 모든 에러(Invalid message format, Unknown message type, Authentication required 등)를 `type: 'auth'`로 전송한다.

```typescript
private sendError(clientId: string, error: string): void {
    this.sendMessage(clientId, {
        type: 'auth',   // 항상 'auth' — 비인증 오류에도 동일
        timestamp: new Date().toISOString(),
        data: { success: false, error },
    });
}
```

`message.type`으로 라우팅하는 클라이언트는 런타임 오류를 인증 응답으로 오해한다. 예를 들어 "Invalid message format" 오류가 `type: 'auth'`로 오면 클라이언트는 인증이 실패했다고 판단하여 재인증을 시도하는 무한 루프가 발생할 수 있다.

## Required Change

`TPlaygroundWebSocketMessageKind`에 `'error'` 타입을 추가하고, `sendError`는 `type: 'error'`를 사용한다. `type: 'auth'`는 인증 응답 전용으로 예약한다.

```typescript
// TPlaygroundWebSocketMessageKind에 'error' 추가
type TPlaygroundWebSocketMessageKind = 'auth' | 'error' | 'message' | ...;

// sendError 수정
private sendError(clientId: string, error: string): void {
    this.sendMessage(clientId, {
        type: 'error',
        timestamp: new Date().toISOString(),
        data: { success: false, error },
    });
}
```

인증 실패는 기존 auth 응답 경로에서 `success: false`로 처리하므로 `sendError`와 분리된다.

## Scope

- `apps/agent-server/src/websocket-server.ts`
- `TPlaygroundWebSocketMessageKind` 타입 정의 파일
- `packages/agent-playground/` 클라이언트 측 메시지 핸들러 (타입 동기화)

## Test Plan

1. `pnpm --filter @robota-sdk/agent-server typecheck` — 타입 오류 없음 확인
2. `pnpm --filter @robota-sdk/agent-playground typecheck` — 클라이언트 타입 동기화 확인
3. WebSocket 통합 테스트: 잘못된 메시지 전송 시 `type: 'error'` 응답 수신 확인
4. 인증 실패 시 여전히 `type: 'auth', success: false` 응답 수신 확인

## User Execution Test Scenarios

### Scenario 1: 잘못된 메시지 포맷 전송 시 에러 타입 확인

**Prerequisites**: agent-server 로컬 실행, wscat 설치

**Steps**:

```bash
# agent-server 시작
pnpm --filter @robota-sdk/agent-server dev

# WebSocket 연결 후 잘못된 메시지 전송
wscat -c ws://localhost:3001/ws
> {"type":"invalid_type","data":{}}
```

**Expected observable result**: `{"type":"error","data":{"success":false,"error":"Unknown message type"}}` 형태의 응답 수신 (이전: `type: 'auth'`로 잘못 반환됨)

**Evidence**: (구현 후 기록)
