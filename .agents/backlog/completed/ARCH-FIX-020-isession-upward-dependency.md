---
title: 'ARCH-FIX-020: ISession 타입을 agent-core로 이동해 agent-interface-transport 상향 의존 제거'
status: done
created: 2026-05-11
priority: high
urgency: soon
area: architecture
---

## Problem

`agent-interface-transport`는 Domain/Contract 레이어에 위치하는 순수 타입 계약 패키지다.
그런데 `ITransportAdapter.attach(session)` 시그니처에 필요한 `ISession` 타입을
`@robota-sdk/agent-sessions`(Session services 레이어)에서 import하고 있다.

```
Domain (agent-core, agent-interface-transport)   ← 의도된 위치
    ↑ 잘못된 상향 의존
Session services (agent-sessions)                ← 실제 ISession 출처
```

`packages/agent-sessions/src/session-interface.ts`의 주석이 이 문제를 스스로 인정한다:

> "Keeps agent-interface-transport free of agent-sdk circular dependencies."

`agent-sdk` 순환 의존을 피하기 위해 `agent-sessions`로 우회했지만,
이것 역시 상향 의존이다. `ISession`의 정의는 `{ readonly sessionId: string }` — trivial 타입이다.

## Rule Violated

- `.agents/specs/architecture-map/dependency-direction.md` — 단방향 의존 원칙
- Domain contracts 레이어는 상위 레이어(Session services)에 의존해서는 안 된다

## Required Change

`ISession`을 `agent-core`(Domain 레이어)로 이동한다:

1. `packages/agent-core/src/interfaces/session.ts` 생성:

   ```ts
   /** Minimal session abstraction shared across contract layers. */
   export interface ISession {
     readonly sessionId: string;
   }
   ```

2. `packages/agent-sessions/src/session-interface.ts`를 삭제하고
   `agent-sessions` index에서 `ISession`을 `agent-core`로부터 re-export.

3. `packages/agent-interface-transport/src/transport-adapter.ts`에서
   import 경로를 `@robota-sdk/agent-sessions` → `@robota-sdk/agent-core`로 변경.

4. `packages/agent-interface-transport/package.json`에서
   `@robota-sdk/agent-sessions` 의존성 제거.

5. 영향받는 다른 패키지의 `ISession` import 경로를 확인해 `agent-core`에서 오도록 수정.

## Scope

- `packages/agent-core/src/` — `ISession` 추가
- `packages/agent-sessions/src/session-interface.ts` — 삭제 후 agent-core re-export
- `packages/agent-interface-transport/src/` — import 경로 수정
- `packages/agent-interface-transport/package.json` — agent-sessions 의존성 제거
- 영향받는 기타 패키지 import 경로 수정

## Test Plan

1. `pnpm typecheck` 전체 통과
2. `pnpm test` 전체 통과
3. `agent-interface-transport/package.json`에 `@robota-sdk/agent-sessions` 없음 확인
4. `ISession` import가 전부 `@robota-sdk/agent-core`에서 오는지 확인

## User Execution Test Scenarios

### 시나리오: 의존성 방향 검증

**agent-executability**: `agent-executable`

**실행 단계**:

```bash
pnpm typecheck
pnpm test
grep -r "agent-sessions" packages/agent-interface-transport/package.json
```

**기대 결과**: typecheck/test PASS, grep 결과 없음 (agent-sessions 의존 제거됨)

**증거 필드** (구현 후 기입):

- 관찰 결과: `pnpm typecheck` + `pnpm test` 전체 통과. `grep` 결과 없음(agent-interface-transport에 agent-sessions 의존 없음). ISession이 agent-core에서 정의되고 agent-sessions/agent-cli/agent-transport-tui/agent-transport-headless/agent-transport-ws/agent-sdk 등 전 패키지에서 agent-core로부터 import. 브랜치: `fix/arch-020-isession-to-agent-core`.
- 종료 코드: 0
