---
title: 'DEV-009: useInteractiveSession이 렌더 본문에서 세션 초기화 — React strict mode 이중 초기화 위험'
status: todo
created: 2026-05-10
priority: medium
urgency: later
area: cli
source: dev-prelaunch-report-2026-05-10 (DEV-M-002)
---

## Problem

`packages/agent-cli/src/ui/hooks/useInteractiveSession.ts:197-200`:

```typescript
if (stateRef.current === null) {
  stateRef.current = initializeSession(props, permissionHandler);
}
```

세션 초기화가 렌더 함수 본문에서 실행된다. Ink는 strict mode로 실행되지 않으므로 현재는
동작하지만, React strict mode에서는 렌더가 두 번 호출되어 이중 초기화가 발생할 수 있다.

`ref`가 null 체크로 한 번만 실행되도록 막고 있으나, 이는 동시성 기능(Concurrent Mode)과
호환되지 않는 패턴이다.

## Required Change

렌더 본문에서 `useEffect` 또는 `useState` lazy initializer로 이동:

**Option A (권장): `useRef` + lazy factory 패턴**

```typescript
// 최초 render 시 한 번만 실행되는 패턴
const stateRef = useRef<IInitState | null>(null);
if (stateRef.current === null) {
  stateRef.current = initializeSession(props, permissionHandler);
}
```

이 패턴은 React 18 공식 문서에서 "stable ref initialization"으로 인정되므로 현재 구현은
실제로는 올바른 패턴이다. 다만 Ink가 React 18 Concurrent Mode를 사용하지 않는 동안은 안전.

**Option B: `useState` lazy initializer 사용**

```typescript
const [state] = useState<IInitState>(() => initializeSession(props, permissionHandler));
```

`useState`의 lazy initializer는 React에서 보장된 "최초 1회 실행" 패턴이다.

현재 Ink 버전이 Concurrent Mode를 지원하지 않는다면 즉각 수정 불필요 — Low urgency 로 유지.
Ink가 React 18 Concurrent Mode 사용 버전으로 업그레이드될 때 함께 수정.

## Scope

- `packages/agent-cli/src/ui/hooks/useInteractiveSession.ts:197-200` — 초기화 패턴 수정

## Test Plan

- `pnpm typecheck` 통과 확인
- 기존 세션 초기화 테스트 통과 확인
- 세션이 정확히 1번만 초기화되는지 단위 테스트로 확인

## User Execution Test Scenarios

Not applicable — 내부 React 패턴 변경. 외부 관찰 가능한 TUI 동작 변화 없음.
세션이 두 번 초기화되는 버그(strict mode에서만 발현)를 예방하는 변경.

## Verification Evidence

```bash
pnpm typecheck && pnpm build
# Expected: 오류 없음
```

**Evidence:** (구현 후 기록)
