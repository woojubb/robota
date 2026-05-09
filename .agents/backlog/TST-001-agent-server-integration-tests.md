---
title: 'TST-001: agent-server 통합 테스트 추가'
status: done
created: 2026-05-10
priority: medium
urgency: soon
area: testing
source: qa-prelaunch-report-2026-05-10 + pm-prelaunch-report-2026-05-10
---

## Problem

`apps/agent-server/src/`에 테스트 파일이 단 하나도 없다. `package.json`의 test 스크립트가
`vitest run --passWithNoTests`로 설정되어 0개 테스트도 CI 통과한다.

테스트 없는 핵심 경로:

- `app.ts` — HTTP 라우트 및 미들웨어
- `websocket-server.ts` — WebSocket 연결/인증/메시지 라우팅
- `server.ts` — 서버 초기화 및 graceful shutdown

WebSocket JWT 인증 버그(SEC-001), 미구현 엔드포인트 광고(SRV-003)와 같은 회귀가 테스트 없이는
CI에서 감지되지 않는다.

## Required Change

최소한 다음 경로에 대한 통합/단위 테스트 작성:

### 1. HTTP 라우트 테스트 (`app.test.ts`)

```typescript
describe('GET /api/v1/remote/health', () => {
  it('returns 200 OK', async () => { ... });
});

describe('POST /api/v1/remote/chat', () => {
  it('rejects missing API key with 401', async () => { ... });
  it('rejects unknown provider with 400', async () => { ... });
});

describe('GET /', () => {
  it('does not advertise unimplemented endpoints', async () => {
    const res = await request(app).get('/');
    expect(res.body).not.toHaveProperty('stream');
    expect(res.body).not.toHaveProperty('capabilities');
  });
});
```

### 2. WebSocket 인증 테스트 (`websocket-server.test.ts`)

```typescript
describe('WebSocket authentication', () => {
  it('rejects connections with missing token', async () => { ... });
  it('rejects connections with arbitrary string token', async () => { ... }); // SEC-001 회귀 방지
  it('accepts connections with valid JWT', async () => { ... });
});
```

### 3. setInterval 정리 테스트 (`websocket-server.test.ts`)

```typescript
it('clears cleanup interval on close()', () => {
  const spy = jest.spyOn(global, 'clearInterval');
  const srv = new PlaygroundWebSocketServer(mockHttpServer);
  srv.close();
  expect(spy).toHaveBeenCalled(); // SRV-002 회귀 방지
});
```

## Scope

- `apps/agent-server/src/__tests__/app.test.ts` — 새 파일
- `apps/agent-server/src/__tests__/websocket-server.test.ts` — 새 파일
- `apps/agent-server/package.json` — `supertest`, `@types/supertest` devDependencies 추가
- `apps/agent-server/vitest.config.ts` 또는 `jest.config.js` — 테스트 설정 확인

## Test Plan

- `pnpm --filter @robota-sdk/agent-server test` 실행 후 모든 테스트 통과
- `--passWithNoTests` 제거하여 테스트 없을 시 CI 실패하도록 변경

## User Execution Test Scenarios

Not applicable. 이 항목은 내부 테스트 인프라 추가이며 사용자가 CLI/TUI로 관찰 가능한 제품
표면이 없다.

**Test Plan 방식으로 검증:**

```bash
cd apps/agent-server
pnpm test
# 출력: N tests passed (0 failed)
```

**Evidence:** (구현 후 채울 것)
