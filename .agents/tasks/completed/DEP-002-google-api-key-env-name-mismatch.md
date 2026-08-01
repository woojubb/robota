---
title: 'DEP-002: agent-server app.ts의 GoogleProvider가 GOOGLE_API_KEY를 읽으나 실제 키는 GEMINI_API_KEY로 저장'
status: done
created: 2026-05-10
priority: medium
urgency: soon
area: server
source: qa-prelaunch-report-2026-05-10-v2 (QA-M-004)
---

## Problem

`apps/agent-server/src/app.ts:82-85`:

```typescript
if (process.env.GOOGLE_API_KEY) {
  providers.google = new GoogleProvider({
    apiKey: process.env.GOOGLE_API_KEY,
  });
}
```

이전 QA 리포트에서 확인된 실제 키는 `GEMINI_API_KEY`로 저장되어 있었으나, 코드에서는
`GOOGLE_API_KEY`를 읽는다. `.env`에 `GEMINI_API_KEY=...`를 설정하면 Google 프로바이더가
조용히 비활성화된다.

재현: `.env`에 `GEMINI_API_KEY=...` 설정 후 서버 시작 → `/api/v1/remote/health` 응답에서
`providers` 배열에 `google` 미포함.

## Required Change

다음 중 하나를 선택:

**Option A (권장): GEMINI_API_KEY도 폴백으로 지원**

```typescript
const googleApiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
if (googleApiKey) {
  providers.google = new GoogleProvider({ apiKey: googleApiKey });
}
```

**Option B: 환경변수 이름을 GEMINI_API_KEY로 통일**

코드를 `GEMINI_API_KEY`로 변경하고 `apps/agent-server/.env.example`도 업데이트.

**Option C: GOOGLE_API_KEY 이름으로 문서화**

`.env.example`에 `GOOGLE_API_KEY` 이름을 명시하고 사용자가 해당 이름으로 설정하도록 안내.

## Scope

- `apps/agent-server/src/app.ts` — 환경변수 읽기 로직 수정
- `apps/agent-server/.env.example` — 올바른 환경변수 이름 반영

## Test Plan

- `GEMINI_API_KEY` 설정 후 서버 시작 → `/api/v1/remote/health` 응답에 `google` 포함 확인
- `GOOGLE_API_KEY` 설정 후 서버 시작 → 동일하게 `google` 포함 확인
- 두 환경변수 모두 미설정 시 `google` 미포함 확인

## User Execution Test Scenarios

**Prerequisites:** agent-server 빌드 및 실행 환경, `.env` 파일

**Scenario — GEMINI_API_KEY 설정 후:**

```bash
GEMINI_API_KEY=test_key node apps/agent-server/dist/server.js &
curl http://localhost:3000/api/v1/remote/health | jq '.providers'
```

**Expected observable result:** `["google"]` (또는 google 포함 배열)

**Cleanup:** 서버 프로세스 종료

**Evidence:** (구현 후 기록)
