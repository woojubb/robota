---
title: 'REFACTOR-005: Transport attach() 계약 불일치 해결 — ISession vs IInteractiveSession'
status: backlog
created: 2026-05-15
priority: high
urgency: soon
area: packages/agent-interface-transport, packages/agent-transport-headless, packages/agent-transport-ws, packages/agent-transport-http
---

## Problem

`ITransportAdapter.attach(session: ISession)` 시그니처이나 세 transport 구현체 모두 즉시 `as unknown as IInteractiveSession`으로 캐스트한다:

```ts
// headless-transport.ts:30
session = s as unknown as IInteractiveSession;

// ws-transport-configurable.ts:46
this.session = session as unknown as IInteractiveSession;

// http-transport.ts:27
session = s as unknown as IInteractiveSession;
```

이는 trust boundary가 아닌 계약 설계 결함이다. 모든 caller는 `IInteractiveSession`을 전달하지만 `attach()` 파라미터는 `ISession`으로 선언되어 구조적으로 호환되지 않는다.

Rule violation: `as unknown as` in production code = contract design issue.

Source: COMBINED-005 (SD-002)

## Scope

Option A (권장): `ITransportAdapter`를 generic으로 변경.

```ts
interface ITransportAdapter<TSession = ISession> {
  attach(session: TSession): void;
  // ...
}
```

각 transport는 `ITransportAdapter<IInteractiveSession>`으로 선언.

Option B: `ISession`에 transport가 실제 사용하는 메서드(`getMessages()`, `on()`, `off()`) 추가. 단, `ISession`이 agent-core 소유이므로 agent-core → agent-sdk 방향 의존이 생기지 않도록 주의.

구현 전 사용자 컨펌 필요.

1. `agent-interface-transport`의 `ITransportAdapter` 시그니처 변경.
2. 세 transport 구현체의 `attach()` 메서드에서 `as unknown as` 제거.
3. `pnpm typecheck` 통과 확인.

## Test Plan

- `pnpm typecheck` — 전체 통과
- `pnpm --filter @robota-sdk/agent-transport-headless test` — 통과
- `pnpm --filter @robota-sdk/agent-transport-ws test` — 통과
- `pnpm --filter @robota-sdk/agent-transport-http test` — 통과
- `grep -r "as unknown as IInteractiveSession" packages/agent-transport-*/src --include="*.ts"` — 결과 없음
- `pnpm build` — 전체 통과

## User Execution Test Scenarios

Not applicable — 타입 계약 정리이며 transport 동작 자체는 변경되지 않는다. 사용자 관찰 가능한 행동 변화 없음.
