---
title: 'DEP-001: agent-server 미사용 의존성 — express-winston, winston, @robota-sdk/agent-provider-bytedance'
status: todo
created: 2026-05-10
priority: medium
urgency: soon
area: server
source: qa-prelaunch-report-2026-05-10-v2 (QA-M-001)
---

## Problem

`apps/agent-server/package.json`에 다음 의존성이 선언되어 있으나 `src/` 디렉토리 내
어디에서도 import되지 않는다:

- `express-winston: "^4.2.0"` — 미사용
- `winston: "^3.11.0"` — 미사용
- `@robota-sdk/agent-provider-bytedance` — 미사용 (`app.ts`에서 BytedanceProvider 참조 없음)

설치/번들 크기가 불필요하게 증가한다. `@robota-sdk/agent-provider-bytedance`는 이전 리포트에서
확인된 실제 ByteDance API 키(`BYTEDANCE_API_KEY`)와 연관될 수 있어 사용 의도 불명확.

## Required Change

`apps/agent-server/package.json`에서 미사용 의존성 3개 제거:

```bash
pnpm --filter agent-server remove express-winston winston @robota-sdk/agent-provider-bytedance
```

ByteDance 프로바이더를 실제로 지원할 계획이라면 `app.ts`에 해당 로직을 추가하는 별도 작업으로 처리.

## Scope

- `apps/agent-server/package.json` — 의존성 3개 제거
- `apps/agent-server/src/` — 혹시 누락된 import가 있는지 grep 확인 후 제거

## Test Plan

- 제거 후 `pnpm --filter agent-server typecheck` 통과 확인
- `pnpm --filter agent-server build` 통과 확인
- `src/` 디렉토리 내 `express-winston | winston | bytedance` grep → 결과 없음 확인

## User Execution Test Scenarios

Not applicable — 패키지 의존성 정리. 외부 관찰 가능한 서버 동작 변화 없음.

## Verification Evidence

```bash
pnpm --filter agent-server typecheck
# Expected: 오류 없음

grep -r "express-winston\|winston\|bytedance" apps/agent-server/src/
# Expected: 결과 없음
```

**Evidence:** (구현 후 기록)
