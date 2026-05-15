---
title: 'REFACTOR-021: getCwd() process.cwd() silent fallback 제거'
status: backlog
created: 2026-05-15
priority: low
urgency: backlog
area: packages/agent-sdk
---

## Problem

`packages/agent-sdk/src/interactive/interactive-session.ts:655`:

```ts
getCwd(): string {
  return this.cwd ?? process.cwd();
}
```

`cwd` 미제공 시 `process.cwd()`로 무음 폴백한다. 테스트 환경과 프로덕션 환경에서 결과가 달라지는 비결정론적 동작이며, 파일을 쓰는 도구에서 cwd가 없는 경우를 오류가 아닌 정상으로 처리한다.

Rule violation: No fallback — absent value = bug.

Source: COMBINED-021 (SD-013)

## Scope

1. `IInteractiveSessionStandardOptions`에서 `cwd`가 이미 required인지 확인.
2. `IInteractiveSessionInjectedOptions` 경로에서 `cwd`가 undefined일 때 `getCwd()` 호출 시 명시적 오류 throw.
3. 또는 `cwd`를 항상 required로 만들고 session 생성 시 caller가 제공하도록 강제.

## Test Plan

- `grep -r "process.cwd()" packages/agent-sdk/src --include="*.ts"` — fallback 용도 없음
- `pnpm typecheck` — 전체 통과
- `pnpm --filter @robota-sdk/agent-sdk test` — 통과

## User Execution Test Scenarios

Not applicable — 에러 핸들링 강화이며 올바른 사용에서 동작 변화 없음.
