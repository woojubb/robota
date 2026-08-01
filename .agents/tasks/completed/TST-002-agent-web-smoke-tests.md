---
title: 'TST-002: agent-web 스모크 테스트 추가'
status: done
created: 2026-05-10
priority: medium
urgency: later
area: testing
source: qa-prelaunch-report-2026-05-10
---

## Problem

`apps/agent-web/src/`에 테스트 파일이 없다. Jest 설정(`"test": "jest --passWithNoTests"`)이
있으나 실제 테스트 없음. Next.js 페이지 렌더링, API 설정, 캐시 로직 변경으로 인한 회귀를
감지할 수 없다.

## Required Change

최소한 다음 스모크 테스트 작성:

### 1. 캐시 유닛 테스트 (`src/lib/cache.test.ts`)

```typescript
import { SimpleCache } from './cache';

describe('SimpleCache', () => {
  it('returns stored value within TTL', () => { ... });
  it('returns undefined after TTL expires', () => { ... });
  it('supports manual invalidation', () => { ... });
});
```

### 2. 레이아웃 렌더링 스모크 테스트

```typescript
import { render } from '@testing-library/react';
import RootLayout from '@/app/layout';

it('renders without crashing', () => {
  expect(() => render(<RootLayout>{null}</RootLayout>)).not.toThrow();
});
```

## Scope

- `apps/agent-web/src/lib/cache.test.ts` — 새 파일
- `apps/agent-web/src/app/layout.test.tsx` — 새 파일 (선택)
- `apps/agent-web/package.json` — `@testing-library/react` 추가 여부 검토

## Test Plan

- `pnpm --filter agent-web test` 실행 후 작성된 테스트 통과
- `--passWithNoTests` 제거 검토

## User Execution Test Scenarios

Not applicable. 내부 테스트 인프라 추가.

**Test Plan 방식으로 검증:**

```bash
cd apps/agent-web
pnpm test
# 출력: N tests passed
```

**Evidence:** PR #357 (test/agent-web-and-docs) — `apps/agent-web/src/lib/cache.test.ts` 8개 테스트 추가. TTL 내 값 반환, TTL 만료 후 undefined 반환, 수동 무효화 등 SimpleCache 핵심 동작 검증. `pnpm --filter agent-web test` 전체 통과.
