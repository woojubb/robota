---
title: 'SRV2-001: Firebase handler req:any 타입 오류 및 cors:true CORS 화이트리스트 무력화'
status: todo
created: 2026-05-10
priority: high
urgency: now
area: server
source: qa-prelaunch-report-2026-05-10-v2, dev-prelaunch-report-2026-05-10
---

## Problem

`apps/agent-server/src/index.ts:28`에 두 가지 문제가 동시에 존재한다.

1. **`req: any, res: any` 타입 사용**: Firebase Functions health check 핸들러가 `(req: any, res: any)` 타입으로 선언되어 있다. 프로젝트 전체의 `strict: true`, `noImplicitAny: true` 규칙(tsconfig.base.json)을 위반한다. 컴파일 타임에 잘못된 속성 접근을 감지할 수 없다.

2. **이중 CORS 적용으로 화이트리스트 무력화**: `index.ts`의 Firebase Functions에서 `cors: true`가 설정되고(`index.ts:14, 23`), `createApp()` 내부에서 `cors` 미들웨어가 또 한 번 적용된다(`app.ts:39`). Firebase `cors: true`는 Firebase가 자체적으로 모든 origin을 허용하도록 설정하므로 `app.ts`의 화이트리스트(`robota.io` 등)가 무력화된다. CORS 정책이 의도와 달리 모든 origin에 열려 API가 외부에 노출된다.

**참조**: QA-H-003, DEV-C-001 (중복 → 단일 이슈로 통합)

## Required Change

1. `index.ts`에서 Firebase Functions 옵션의 `cors: true` → `cors: false`로 변경하여 Express의 CORS 미들웨어만 동작하도록 수정
2. `req: any, res: any` → `req: Request, res: Response`로 수정 (`firebase-functions/v2/https`에서 import)

```typescript
// Before
import { onRequest } from 'firebase-functions/v2/https';

export const health = onRequest({
  cors: true,  // 모든 origin 허용 → 화이트리스트 무력화
  region: 'us-central1',
  ...
}, (req: any, res: any) => {  // any 타입 → strict 위반
  res.json({ ... });
});

// After
import { onRequest } from 'firebase-functions/v2/https';
import type { Request, Response } from 'firebase-functions/v2/https';

export const health = onRequest({
  cors: false,  // Express CORS 미들웨어가 화이트리스트 적용
  region: 'us-central1',
  ...
}, (req: Request, res: Response) => {
  res.json({ ... });
});
```

## Scope

- `apps/agent-server/src/index.ts`
- TypeScript 타입 검사 통과 확인

## Test Plan

1. `pnpm --filter @robota-sdk/agent-server typecheck` — `any` 제거 후 타입 오류 없음 확인
2. `pnpm --filter @robota-sdk/agent-server build` — 빌드 성공 확인
3. 로컬에서 Firebase Functions Emulator 실행 후 health endpoint에 `Origin: https://evil.com` 헤더로 요청 → `Access-Control-Allow-Origin: https://evil.com` 응답이 없어야 함
4. `Origin: https://robota.io` 헤더로 요청 → CORS 허용 확인

## User Execution Test Scenarios

### Scenario 1: CORS 화이트리스트 동작 확인

**Prerequisites**: Firebase Emulator 또는 배포된 agent-server 환경

**Steps**:

```bash
# 허용되지 않은 origin 요청 → CORS 거부 확인
curl -s -I -H "Origin: https://evil.com" http://localhost:5001/<project>/us-central1/health
# 응답 헤더에 Access-Control-Allow-Origin: https://evil.com 없어야 함

# 허용된 origin 요청 → CORS 허용 확인
curl -s -I -H "Origin: https://robota.io" http://localhost:5001/<project>/us-central1/health
# 응답 헤더에 Access-Control-Allow-Origin: https://robota.io 있어야 함
```

**Expected observable result**: evil.com origin은 CORS 거부, robota.io는 허용

**Evidence**: (구현 후 기록)
