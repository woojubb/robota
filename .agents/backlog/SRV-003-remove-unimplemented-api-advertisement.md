---
title: 'SRV-003: agent-server 루트 엔드포인트에서 미구현 API 광고 제거'
status: done
created: 2026-05-10
priority: high
urgency: soon
area: server
source: qa-prelaunch-report-2026-05-10
---

## Problem

`apps/agent-server/src/app.ts:129-131`의 `GET /` 응답이 실제로 존재하지 않는 엔드포인트를 나열한다.

```typescript
// app.ts — GET / 응답
{
  stream: '/api/v1/remote/stream',              // ❌ 404 — 미구현
  capabilities: '/api/v1/remote/providers/:provider/capabilities' // ❌ 404 — 미구현
}
```

실제 등록된 라우트:

- `GET /api/v1/remote/health` ✅
- `POST /api/v1/remote/chat` ✅
- `GET /api/v1/remote/ws/status` ✅
- `GET /health` ✅

API 소비자나 자동화 도구가 `/` 응답을 보고 `stream` 또는 `capabilities` 엔드포인트를
호출하면 404를 받는다. 문서와 구현 불일치.

## Required Change

두 가지 선택지:

### 옵션 A — 광고 목록에서 미구현 엔드포인트 제거 (단기 수정)

```typescript
// GET / 응답에서 stream, capabilities 항목 제거
res.json({
  name: 'Agent Server',
  version: process.env.npm_package_version,
  endpoints: {
    health: '/api/v1/remote/health',
    chat: '/api/v1/remote/chat',
    wsStatus: '/api/v1/remote/ws/status',
  },
});
```

### 옵션 B — SSE 스트리밍 엔드포인트 실제 구현 (장기 개선)

`/api/v1/remote/stream`에 SSE(Server-Sent Events) 스트리밍 라우트 구현.
이는 SRV-003과 별개의 작업이므로, 단기 수정은 옵션 A로 진행하고 스트리밍은 별도 백로그로 분리.

## Scope

- `apps/agent-server/src/app.ts` — `GET /` 응답에서 미구현 엔드포인트 제거

## Test Plan

- `GET /` 응답의 `endpoints` 객체에 `stream`, `capabilities` 필드 없음 확인
- 실제 404를 반환하는 경로가 더 이상 광고되지 않음 확인

## User Execution Test Scenarios

**Prerequisites:** `apps/agent-server` 실행 중 (`pnpm dev` 또는 `pnpm start`)

**Scenario — 루트 엔드포인트 광고 내용 확인:**

```bash
curl -s http://localhost:3001/ | jq .
```

**Expected observable result (수정 후):**

```json
{
  "name": "Agent Server",
  "endpoints": {
    "health": "/api/v1/remote/health",
    "chat": "/api/v1/remote/chat"
  }
}
```

`stream`과 `capabilities` 키가 응답에 없어야 한다.

**Cleanup:** 없음

**Evidence:** PR #354 (fix/agent-server-prelaunch) — `apps/agent-server/src/app.ts` GET / 응답에서 `stream`, `capabilities` 키 제거. 실제 등록된 엔드포인트(health, chat, wsStatus)만 광고.
