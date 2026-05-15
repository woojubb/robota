---
title: 'REFACTOR-020: agent-server console.* → DI logger'
status: backlog
created: 2026-05-15
priority: low
urgency: backlog
area: apps/agent-server
---

## Problem

`apps/agent-server/src/server.ts`와 `websocket-server.ts`에서 production 코드에 `console.log`, `console.warn`, `console.error`를 20건 이상 직접 호출한다. 이모지가 포함된 메시지도 하드코딩되어 있다:

```ts
// server.ts:41
console.log(`🚀 Robota API Server started on port ${port}`);
// websocket-server.ts:87
console.log(`🔗 New WebSocket connection: ${clientId}`);
```

Rule violation: NEVER use console.\* in production code. Use dependency-injected logger.

Source: COMBINED-020 (SA-011)

## Scope

1. `ILogger` 또는 `IServerLogger` 인터페이스를 `WebSocketServer` 생성자에서 주입받도록 변경.
2. 모든 `console.*` 호출을 DI logger 메서드로 교체.
3. 이모지 prefix 제거 또는 structured fields로 이동.

## Test Plan

- `grep -r "console\." apps/agent-server/src --include="*.ts"` — 결과 없음
- `pnpm --filter apps/agent-server test` — 통과
- `pnpm typecheck` — 통과

## User Execution Test Scenarios

Not applicable — 로깅 구현 변경이며 서버 기능 동작 자체는 변화 없음.
