---
title: 'PLG-001: Web Playground가 ws://localhost:3001/ws로 하드코딩 — 공개 사이트에서 동작 불가'
status: done
created: 2026-05-10
priority: critical
urgency: now
area: playground
source: pm-prelaunch-report-2026-05-10-v2 (PM-C-003)
---

## Problem

`packages/agent-playground/src/playground/components/PlaygroundApp.tsx`:

```typescript
export function PlaygroundApp(props: { defaultServerUrl?: string }): React.ReactElement {
  return (
    <PlaygroundProvider defaultServerUrl={props.defaultServerUrl ?? 'ws://localhost:3001/ws'}>
```

`apps/agent-web/src/app/playground/page.tsx`에서 `PlaygroundApp`을 props 없이 호출:

```typescript
export default function PlaygroundPage() {
  return <PlaygroundApp />;  // defaultServerUrl 전달 없음 → localhost:3001 폴백
}
```

`apps/agent-web/.env.example`에도 playground 서버 URL 환경변수가 없다.
공개 사이트(robota.io)에서 Playground를 사용하면 localhost:3001에 연결을 시도하고 실패한다.

## Required Change

**Option A (권장): 환경변수화**

1. `apps/agent-web/.env.example`에 추가:

   ```
   NEXT_PUBLIC_PLAYGROUND_WS_URL=ws://localhost:3001/ws
   ```

2. `apps/agent-web/src/app/playground/page.tsx` 수정:
   ```typescript
   export default function PlaygroundPage() {
     return <PlaygroundApp defaultServerUrl={process.env.NEXT_PUBLIC_PLAYGROUND_WS_URL} />;
   }
   ```

**Option B: 서버 미연결 시 안내 UI 표시**

`PlaygroundProvider` 내에서 연결 실패 시 "서버 연결이 필요합니다" 안내 메시지 표시.
`defaultServerUrl`이 undefined면 연결 시도 자체를 건너뜀.

**Option C: Playground를 self-hosted 기능으로 명시**

- `/playground` 페이지에 "self-hosted agent-server 필요" 안내 추가
- `/playground/demo` (정적 시각화)를 전면에 내세움

## Scope

- `apps/agent-web/.env.example` — `NEXT_PUBLIC_PLAYGROUND_WS_URL` 추가
- `apps/agent-web/src/app/playground/page.tsx` — 환경변수 전달
- (Option B 선택 시) `packages/agent-playground/src/playground/` — 연결 실패 UI

## Test Plan

- `NEXT_PUBLIC_PLAYGROUND_WS_URL` 미설정 시 동작 확인 (Option A: undefined 전달, Option B: 안내 UI)
- `.env.example` 환경변수 이름 문서화 확인
- `pnpm typecheck && pnpm build` 통과 확인

## User Execution Test Scenarios

**Prerequisites:** `pnpm build` (agent-web), 로컬 개발 서버 실행 (`pnpm --filter agent-web dev`)

**Scenario — 환경변수 미설정 (Option A):**

브라우저에서 `http://localhost:3000/playground` 접속.

**Expected observable result:** 서버 URL 미설정 안내 또는 연결 실패 메시지 (빈 화면 아님)

**Scenario — 환경변수 설정 후:**

`.env.local`에 `NEXT_PUBLIC_PLAYGROUND_WS_URL=ws://localhost:3001/ws` 설정 후 접속.

**Expected observable result:** WebSocket 연결 시도 (agent-server 실행 시 실제 연결)

**Cleanup:** `.env.local` 파일 삭제

**Evidence:** 이미 구현됨. `apps/agent-web/src/app/playground/page.tsx`가 `process.env.NEXT_PUBLIC_PLAYGROUND_WS_URL`을 `defaultServerUrl`로 전달. `apps/agent-web/.env.example`에 `NEXT_PUBLIC_PLAYGROUND_WS_URL` 주석 문서화 완료.
