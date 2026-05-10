---
title: 'ARCH-FIX-016: agent-server SPEC.md에 Graceful Shutdown 요건 섹션 추가'
status: todo
created: 2026-05-10
priority: medium
urgency: backlog
area: documentation
related: [V-CON-005, SRV-001]
---

## Problem

`agent-server`는 graceful shutdown 코드가 구현되어 있으나(`SRV-001` 완료), `apps/agent-server/docs/SPEC.md`에 graceful shutdown 요건 섹션이 없다.

`api-boundary.md` 규칙: "All server processes must document their graceful shutdown behavior in SPEC.md — signal handling (SIGTERM/SIGINT), in-flight request drain timeout, WebSocket connection teardown sequence."

구현은 있지만 SPEC에 계약으로 명시되지 않아 향후 변경 시 요건을 모르고 제거할 위험이 있다.

## Solution

`apps/agent-server/docs/SPEC.md`에 Graceful Shutdown 섹션을 추가한다:

- 처리하는 시그널 목록 (SIGTERM, SIGINT)
- in-flight request drain 타임아웃
- WebSocket 연결 해제 순서
- 종료 순서 (HTTP 서버 → WebSocket 서버 순)
- 비정상 종료 시 동작

현재 구현된 코드와 일치하도록 작성한다.

## Test Plan

- `apps/agent-server/docs/SPEC.md`에 Graceful Shutdown 섹션 존재 확인
- 섹션 내용이 실제 `server.ts` 구현과 일치하는지 수동 대조

## User Execution Test Scenarios

Not applicable — documentation-only change. No runnable user-facing behavior change.

## Verification Evidence

(완료 후 SPEC.md 해당 섹션 링크 기록)
