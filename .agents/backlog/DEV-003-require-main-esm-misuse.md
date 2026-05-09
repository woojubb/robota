---
title: 'DEV-003: server.ts의 require.main === module — ESM 전환 시 startServer() 미실행 위험'
status: todo
created: 2026-05-10
priority: high
urgency: soon
area: server
source: dev-prelaunch-report-2026-05-10
---

## Problem

`apps/agent-server/src/server.ts:72`에서 CJS 전용 관용구를 사용한다.

```typescript
if (require.main === module) {
  startServer();
}
```

현재 agent-server는 `"type": "module"` 없이 CJS로 컴파일되고 `tsx`로 개발 실행하므로 런타임에는 동작한다. 그러나 빌드 출력이 ESM 타겟으로 전환되면 이 조건은 항상 `false`가 되어 `startServer()`가 절대 호출되지 않는다. 에러 메시지도 없이 서버가 시작되지 않는 침묵의 장애가 발생한다.

ESM 동등 관용구는 `import.meta.url === new URL(process.argv[1], 'file://').href`이나, `server.ts`는 `node dist/server.js`로 직접 실행되므로 guard 자체가 불필요하다(`index.ts`가 Firebase export를 별도로 처리함).

**참조**: QA-011 업데이트 항목 (v2 보고서 확인)

## Required Change

guard를 제거하고 `startServer()`를 무조건 호출한다. `index.ts`가 Firebase Functions export를 담당하므로 `server.ts`는 직접 실행 진입점으로만 사용된다.

```typescript
// Before
if (require.main === module) {
  startServer();
}

// After
startServer();
```

ESM 전환을 고려한다면 ESM-safe 형태로 교체:

```typescript
// ESM-safe alternative (if ESM output is intended)
const isMain = import.meta.url === new URL(process.argv[1], 'file://').href;
if (isMain) {
  startServer();
}
```

## Scope

- `apps/agent-server/src/server.ts` (line 72)

## Test Plan

1. `pnpm --filter @robota-sdk/agent-server build` — 빌드 성공 확인
2. `node dist/server.js` 직접 실행 → 서버 정상 시작 확인
3. `pnpm --filter @robota-sdk/agent-server typecheck` — 타입 오류 없음 확인

## User Execution Test Scenarios

### Scenario 1: 빌드 후 서버 직접 실행

**Prerequisites**: `apps/agent-server` 빌드 완료

**Steps**:

```bash
pnpm --filter @robota-sdk/agent-server build
node apps/agent-server/dist/server.js
```

**Expected observable result**: 서버가 정상적으로 시작되며 `Listening on port 3001` (또는 설정된 포트) 로그 출력

**Evidence**: (구현 후 기록)
