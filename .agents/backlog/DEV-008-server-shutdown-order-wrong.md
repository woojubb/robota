---
title: 'DEV-008: agent-server 종료 시 HTTP server.close() 후 wsServer.close() 순서 역전 — 활성 WebSocket이 30s 타임아웃 강제 종료 유발'
status: todo
created: 2026-05-10
priority: medium
urgency: soon
area: server
source: dev-prelaunch-report-2026-05-10 (DEV-M-006)
---

## Problem

`apps/agent-server/src/server.ts:50-61`:

```typescript
server.close(() => { ... process.exit(0); });
wsServer.close();
```

`server.close()`를 먼저 호출하면 새 연결 수락은 중단되지만, 콜백은 기존 연결이 모두 닫힌
후에만 실행된다. 활성 WebSocket 연결이 HTTP 서버를 계속 열어두어 `server.close()` 콜백이
지연된다. 결국 30초 타임아웃이 먼저 발동하여 `process.exit(1)`으로 강제 종료된다.

올바른 순서: WebSocket 연결을 먼저 닫아야 HTTP 서버가 즉시 drain된다.

## Required Change

`apps/agent-server/src/server.ts` 종료 핸들러에서 순서 교체:

```typescript
// BEFORE
server.close(() => { ... process.exit(0); });
wsServer.close();

// AFTER
wsServer.close();
server.close(() => {
  logger.info('HTTP server closed');
  process.exit(0);
});
```

## Scope

- `apps/agent-server/src/server.ts` — 종료 핸들러 순서 수정

## Test Plan

- `SIGTERM` 시그널 전송 후 30초 타임아웃 없이 정상 종료(exit code 0) 확인
- 활성 WebSocket 연결이 있는 상태에서 `SIGTERM` → 연결 종료 후 HTTP 서버 종료 순서 확인

## User Execution Test Scenarios

**Prerequisites:** agent-server 빌드 및 실행 환경, WebSocket 클라이언트 도구

**Scenario — SIGTERM 정상 종료:**

```bash
node apps/agent-server/dist/server.js &
SERVER_PID=$!
# (WebSocket 연결 없는 경우)
kill -TERM $SERVER_PID
# 30초 이내 종료 확인
```

**Expected observable result:** 30초 타임아웃 없이 정상 종료 메시지 출력 후 exit code 0

**Cleanup:** 없음 (프로세스 이미 종료됨)

**Evidence:** (구현 후 기록)
