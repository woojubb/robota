---
title: 'DEV-005: parseInt 기수 누락 — RATE_LIMIT_MAX 잘못된 값 시 rate limiting 비활성화'
status: done
created: 2026-05-10
priority: high
urgency: soon
area: server
source: dev-prelaunch-report-2026-05-10
---

## Problem

`apps/agent-server/src/app.ts:53`에서 `parseInt`를 기수(radix) 없이 호출한다.

```typescript
max: parseInt(process.env.RATE_LIMIT_MAX || '100'),  // 기수 없음, NaN 가능
```

`RATE_LIMIT_MAX`가 비숫자 문자열로 잘못 설정되면 `parseInt`는 `NaN`을 반환한다. `express-rate-limit`의 `max` 옵션이 `NaN`을 받으면 rate limiting이 조용히 비활성화된다. 보안 설정이 무음으로 꺼지는 것이므로 위험하다.

`"0x10"` 또는 `0`으로 시작하는 문자열에서도 기수 없이 호출하면 구현 정의 동작이 발생한다.

## Required Change

기수 `10`을 명시하고, NaN 또는 유효하지 않은 값이면 시작 시 오류를 throw한다.

```typescript
// Before
max: parseInt(process.env.RATE_LIMIT_MAX || '100'),

// After
const rateLimitMax = parseInt(process.env.RATE_LIMIT_MAX ?? '100', 10);
if (!Number.isFinite(rateLimitMax) || rateLimitMax <= 0) {
  throw new Error(`Invalid RATE_LIMIT_MAX: "${process.env.RATE_LIMIT_MAX}"`);
}
// ... rateLimit({ max: rateLimitMax, ... })
```

## Scope

- `apps/agent-server/src/app.ts` (line 53)

## Test Plan

1. `RATE_LIMIT_MAX=abc`로 서버 시작 → 즉시 오류 throw 및 종료 확인
2. `RATE_LIMIT_MAX=50`으로 서버 시작 → rate limit 50으로 설정 확인
3. `RATE_LIMIT_MAX` 미설정 → 기본값 100 사용 확인
4. `pnpm --filter @robota-sdk/agent-server typecheck` — 타입 오류 없음 확인

## User Execution Test Scenarios

### Scenario 1: 잘못된 RATE_LIMIT_MAX 설정 시 즉시 오류

**Prerequisites**: agent-server 빌드 완료

**Steps**:

```bash
RATE_LIMIT_MAX=abc node apps/agent-server/dist/server.js
```

**Expected observable result**: 서버 시작 즉시 `Error: Invalid RATE_LIMIT_MAX: "abc"` 오류 출력 후 종료 (이전: 조용히 NaN으로 rate limiting 비활성화)

**Evidence**: (구현 후 기록)
