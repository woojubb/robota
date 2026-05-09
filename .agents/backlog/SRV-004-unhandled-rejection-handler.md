---
title: 'SRV-004: agent-server unhandledRejection 프로세스 핸들러 추가'
status: done
created: 2026-05-10
priority: medium
urgency: soon
area: server
source: qa-prelaunch-report-2026-05-10
---

## Problem

`apps/agent-server/src/server.ts`에 `process.on('unhandledRejection', ...)` 핸들러가 없다.
AI 프로바이더 호출 등 비동기 작업에서 처리되지 않은 Promise rejection이 발생하면 Node.js 기본
동작(경고 출력 또는 Node 15+ 기준 프로세스 종료)에 의존한다.

운영 환경에서 원인 불명의 서버 크래시나 오류 추적 실패로 이어질 수 있다.

## Required Change

`server.ts` 또는 `app.ts` 초기화 코드에 핸들러 추가:

```typescript
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Sentry/로깅 서비스 연동 시 이 지점에 추가
  // 서버를 계속 실행하되, 로깅은 필수
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1); // 복구 불가능한 상태 — 재시작 필요
});
```

## Scope

- `apps/agent-server/src/server.ts` 또는 `apps/agent-server/src/app.ts` — 핸들러 추가

## Test Plan

- 테스트 코드에서 `Promise.reject('test')` 발생 후 핸들러가 호출되는지 확인
- 서버가 종료되지 않고 계속 실행되는지 확인

## User Execution Test Scenarios

Not applicable. 프로세스 레벨 에러 핸들러 추가는 사용자가 CLI/TUI로 관찰 가능한 제품
표면이 없다. 런타임 안정성 개선 항목으로 Test Plan 검증으로 완료 확인.

**Test Plan 방식으로 검증:**

```bash
# 서버 로그에서 unhandledRejection 출력 확인 (테스트 환경)
# 실제 미처리 rejection 발생 시 프로세스가 종료되지 않고 로그 출력
```

**Evidence:** PR #354 (fix/agent-server-prelaunch) — `apps/agent-server/src/server.ts`에 `unhandledRejection`, `uncaughtException` 핸들러 추가. unhandledRejection은 로깅 후 서버 계속 실행, uncaughtException은 로깅 후 process.exit(1).
