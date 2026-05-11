---
title: 'SEC-001: WebSocket JWT 토큰 검증 구현'
status: done
created: 2026-05-10
priority: critical
urgency: now
area: security
source: qa-prelaunch-report-2026-05-10
---

## Problem

`apps/agent-server/src/websocket-server.ts:153`의 WebSocket 인증 핸들러에 JWT 검증 로직이
구현되지 않았다. 현재는 토큰이 비어 있지 않은 문자열이면 무조건 인증 통과한다.

```typescript
// TODO: Validate JWT token here
// For now, we'll accept any non-empty token
if (!token) {
  this.sendError(clientId, 'Missing authentication token');
  return;
}
```

"abc"와 같은 임의 문자열을 토큰으로 보내면 모든 클라이언트가 `/ws/playground`에 인증 성공한다.
이 상태로 서버가 공개 URL에 배포되면 인증 없이 Playground 실시간 AI 호출이 가능해진다.

## Required Change

`websocket-server.ts`의 `TODO` 구현을 완성한다.

### 옵션 A — JWT 실 검증 (권장)

- `jsonwebtoken` 라이브러리로 서버 측 비밀키 검증
- 토큰 만료 확인
- 클레임에서 `userId` 추출하여 `IPlaygroundClient.userId` 채우기
- 검증 실패 시 `sendError(clientId, 'Invalid authentication token')` 후 연결 종료

### 옵션 B — 외부 노출 차단 (단기 임시 조치)

WebSocket 엔드포인트를 localhost 또는 내부 네트워크만 접근 가능하도록 방화벽/역방향 프록시로
제한. 인증 구현 전 서버를 공개 배포하는 경우에만 해당.

구현 전 사용자 컨펌 필요 (옵션 A vs B 선택).

## Scope

- `apps/agent-server/src/websocket-server.ts` — TODO 블록 구현
- `apps/agent-server/package.json` — `jsonwebtoken`, `@types/jsonwebtoken` 의존성 추가
- `apps/agent-server/.env.example` — `JWT_SECRET` 환경변수 문서화

## Test Plan

- `websocket-server.ts` 인증 경로에 대한 단위 테스트 작성
  - 빈 토큰 → 거부 (기존 동작)
  - 유효한 JWT → 인증 성공
  - 만료된 JWT → 거부
  - 잘못된 서명 JWT → 거부
  - 임의 문자열 → 거부 (기존 버그 회귀 방지)

## User Execution Test Scenarios

**Prerequisites:** `pnpm build`, `apps/agent-server/.env`에 `JWT_SECRET=test-secret` 설정,
`apps/agent-server` 실행 중 (`pnpm start`)

**Scenario 1 — 임의 문자열로 인증 시도 (거부 확인):**

```bash
# wscat 또는 websocat 사용
wscat -c "ws://localhost:3001/ws/playground" \
  -H "Authorization: Bearer not-a-jwt"
```

**Expected observable result:**

```
error: Invalid authentication token
Connection closed
```

**Scenario 2 — 유효한 JWT로 인증 시도 (성공 확인):**

```bash
# 테스트용 JWT 생성 (node 스크립트 또는 jwt.io)
JWT=$(node -e "const jwt=require('jsonwebtoken'); console.log(jwt.sign({userId:'u1'},'test-secret',{expiresIn:'1h'}))")
wscat -c "ws://localhost:3001/ws/playground" \
  -H "Authorization: Bearer $JWT"
```

**Expected observable result:**

```
Connected
```

**Cleanup:** 서버 종료 (`Ctrl+C`)

**Evidence:** PR #354 (fix/agent-server-prelaunch) — `apps/agent-server/src/websocket-server.ts`에 `jwt.verify()` 구현. JWT_SECRET 환경변수 설정 시 실제 JWT 검증, 미설정 시 3-part format 체크.
