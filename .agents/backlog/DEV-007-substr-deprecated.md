---
title: 'DEV-007: websocket-server.ts의 substr deprecated — slice로 교체'
status: todo
created: 2026-05-10
priority: medium
urgency: later
area: server
source: dev-prelaunch-report-2026-05-10
---

## Problem

`apps/agent-server/src/websocket-server.ts:297`에서 `String.prototype.substr`을 사용한다.

```typescript
return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
```

`substr`은 ES2015부터 deprecated이며 Annex B 스펙에서 제거되었다. 표준 `slice`로 교체해야 한다.

또한 QA-013 리포트에서 이미 지적되었으나 미수정 상태다(v2 보고서 업데이트 항목 확인).

**참조**: QA-013, DEV-M-001 (동일 이슈)

## Required Change

```typescript
// Before
return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// After
return `client_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
```

`substr(2, 9)`는 인덱스 2부터 길이 9를 추출한다. `slice`로 변환 시 `slice(2, 11)`이 동등하다 (시작 2, 끝 2+9=11).

추가로 DEV-L-004에서 지적한 것처럼 `Math.random()` 대신 `crypto.randomUUID()`로 개선하는 것을 고려한다.

## Scope

- `apps/agent-server/src/websocket-server.ts` (line 297)

## Test Plan

1. `pnpm --filter @robota-sdk/agent-server typecheck` — 타입 오류 없음 확인
2. `pnpm --filter @robota-sdk/agent-server build` — 빌드 성공 확인
3. `rg "substr" apps/agent-server/src/` — substr 사용 잔존 없음 확인

## User Execution Test Scenarios

Not applicable. `substr` → `slice` 교체는 런타임 동작이 동일한 내부 구현 변경이다. 사용자가 관찰 가능한 동작 변화가 없으므로 User Execution Test Scenario가 해당되지 않는다. 검증은 타입체크 및 빌드 성공으로 충분하다.
