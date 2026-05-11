---
title: 'SRV-002: WebSocket 정리 setInterval 메모리 누수 수정'
status: done
created: 2026-05-10
priority: high
urgency: soon
area: server
source: qa-prelaunch-report-2026-05-10
---

## Problem

`apps/agent-server/src/websocket-server.ts:56`에서 생성자가 `setInterval`을 호출하지만
반환값을 클래스 필드에 저장하지 않는다. `close()` 메서드에서 `clearInterval`을 호출할 수 없어
서버 종료 후에도 30초마다 `cleanupInactiveConnections()`가 실행된다.

```typescript
// 생성자 — interval ID 저장 안 함
setInterval(this.cleanupInactiveConnections.bind(this), 30_000);

// close() — clearInterval 없음
public close(): void {
  for (const client of this.clients.values()) {
    client.ws.close();
  }
  this.clients.clear();
  this.userSessions.clear();
  this.wss.close();
  // clearInterval 없음
}
```

서버 재시작이나 테스트 환경에서 interval이 누적되어, 이미 닫힌 WebSocket 서버에 접근을 시도한다.

## Required Change

```typescript
// PlaygroundWebSocketServer 클래스
private cleanupInterval: ReturnType<typeof setInterval>;

constructor(server: http.Server) {
  // ...
  this.cleanupInterval = setInterval(
    this.cleanupInactiveConnections.bind(this),
    30_000
  );
}

public close(): void {
  clearInterval(this.cleanupInterval);
  for (const client of this.clients.values()) {
    client.ws.close();
  }
  this.clients.clear();
  this.userSessions.clear();
  this.wss.close();
}
```

## Scope

- `apps/agent-server/src/websocket-server.ts` — interval ID 필드 추가, `close()`에 clearInterval 추가

## Test Plan

- `PlaygroundWebSocketServer` 단위 테스트: `close()` 호출 후 interval이 실행되지 않음 확인
- `jest.useFakeTimers()`로 시뮬레이션

## User Execution Test Scenarios

Not applicable. 이 항목은 서버 내부 메모리 관리 버그 수정이며, 사용자가 CLI/TUI로 직접
관찰할 수 있는 제품 표면이 없다. 아래 Test Plan 검증으로 완료 확인.

**Test Plan 방식으로 검증:**

```typescript
// websocket-server.test.ts
import { PlaygroundWebSocketServer } from '../websocket-server';

test('close() clears the cleanup interval', () => {
  const spy = jest.spyOn(global, 'clearInterval');
  const server = new PlaygroundWebSocketServer(mockHttpServer);
  server.close();
  expect(spy).toHaveBeenCalledWith(expect.anything());
});
```

**Evidence:** PR #354 (fix/agent-server-prelaunch) — `PlaygroundWebSocketServer.close()`에 `clearInterval(this.cleanupInterval)` 추가. `cleanupInterval` 클래스 필드로 interval ID 저장하여 메모리 누수 수정.
