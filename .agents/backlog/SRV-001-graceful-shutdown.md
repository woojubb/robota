---
title: 'SRV-001: agent-server Graceful Shutdown 구현'
status: todo
created: 2026-05-10
priority: high
urgency: soon
area: server
source: qa-prelaunch-report-2026-05-10
---

## Problem

`apps/agent-server/src/server.ts:40-48`의 SIGTERM/SIGINT 핸들러가 `process.exit(0)`만 호출한다.
HTTP 서버 닫기, WebSocket 연결 정리, 진행 중인 AI 스트리밍 완료 대기가 없다.

```typescript
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0); // 즉시 종료 — 연결 정리 없음
});
```

배포/재시작 시 응답 중인 스트리밍 요청이 강제로 끊기고, 연결된 WebSocket 클라이언트가
연결 유지 시도를 반복하게 된다.

## Required Change

`server.ts`의 SIGTERM/SIGINT 핸들러를 다음 순서로 구현:

```typescript
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');

  // 1. 새 HTTP 연결 거부
  server.close(() => {
    console.log('HTTP server closed');
  });

  // 2. WebSocket 연결 정리
  if (wsServer) {
    wsServer.close();
  }

  // 3. 진행 중인 요청 완료 대기 (타임아웃: 30초)
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      console.warn('Graceful shutdown timeout, forcing exit');
      resolve();
    }, 30_000);

    server.closeAllConnections?.();
    clearTimeout(timeout);
    resolve();
  });

  process.exit(0);
});
```

## Scope

- `apps/agent-server/src/server.ts` — graceful shutdown 핸들러 구현

## Test Plan

- SIGTERM 신호 전송 후 HTTP 서버 응답 없음 확인
- WebSocket 연결 종료 확인
- 30초 타임아웃 내 종료 확인

## User Execution Test Scenarios

**Prerequisites:** `apps/agent-server` 실행 중

**Scenario — SIGTERM 전송 후 정상 종료 확인:**

```bash
# 서버 PID 확인
lsof -i :3001 -t

# SIGTERM 전송
kill -TERM <PID>
```

**Expected observable result:**

```
SIGTERM received, shutting down gracefully
HTTP server closed
WebSocket server closed
(프로세스 종료, exit code 0)
```

**현재 동작 (버그):** `SIGTERM received, shutting down gracefully` 출력 후 즉시 종료.
연결된 클라이언트에 FIN 없이 RST 전송.

**Cleanup:** 없음

**Evidence:** (구현 후 채울 것)
