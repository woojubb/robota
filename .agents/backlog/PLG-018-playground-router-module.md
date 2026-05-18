---
title: 'PLG-018: Playground Router Module — /api/playground/* 전용 라우터 분리 + BYOK 키 sanitizer 미들웨어'
status: todo
created: 2026-05-19
priority: medium
urgency: soon
area: apps/agent-server
depends_on: []
---

## Background

현재 `apps/agent-server/src/app.ts`에 모든 API 핸들러가 인라인으로 작성되어 있다.
PLG-015~017 작업으로 `/api/playground/*` 엔드포인트가 추가되면 `app.ts`가 비대해진다.
또한 BYOK 키(`X-Provider-API-Key` 헤더)가 다양한 핸들러에 흩어져 로그에 노출될 위험이 있다.

이 작업은 playground 관련 엔드포인트를 전용 Express 라우터 모듈로 분리하고,
BYOK 키가 절대 로그에 기록되지 않도록 sanitizer 미들웨어를 중앙화한다.

## Goals

1. `apps/agent-server/src/routes/playground.ts` 파일 생성 — 전용 Express Router
2. `app.ts`에서 `app.use('/api/playground', playgroundRouter)` 한 줄로 마운트
3. BYOK Key Sanitizer 미들웨어 구현:
   - `X-Provider-API-Key` 헤더 값을 요청 처리 후 메모리에서 즉시 제거
   - Express 로거가 해당 헤더를 기록하지 않도록 before-log 필터 적용
   - `req.byokKey` 타입-안전 속성으로 핸들러에 전달 (string | undefined)
4. 기존 `/api/v1/byok/chat` 엔드포인트를 새 라우터로 이전 (URL은 유지)
5. 향후 PLG-015~017 핸들러가 이 라우터에 추가될 수 있는 구조 확보

## Non-Goals

- 기존 `/api/v1/remote/*` 엔드포인트 이전 (scope 외)
- 인증 시스템 변경
- WebSocket 서버 변경

## Architecture

```
apps/agent-server/src/
├── app.ts                    ← 간결하게 유지, 라우터 마운트만
└── routes/
    └── playground.ts         ← /api/playground/* 전용 라우터
        ├── middleware/
        │   └── byok-sanitizer.ts  ← BYOK 키 sanitizer
        └── handlers/
            └── byok-chat.ts  ← 기존 /api/v1/byok/chat 이전
```

## Test Plan

- 단위 테스트: byok-sanitizer 미들웨어
  - `X-Provider-API-Key` 헤더가 `req.byokKey`로 전달되는지 확인
  - 요청 완료 후 헤더 값이 로그 필터에서 제거되는지 확인
- 통합 테스트: 기존 `/api/v1/byok/chat` 동작 유지 확인
- `pnpm typecheck && pnpm lint` 통과

## User Execution Test Scenarios

Not applicable — 순수 서버 내부 코드 조직화 작업. 기존 동작은 변경 없음.
기능 검증은 Test Plan의 통합 테스트로 대체한다.
