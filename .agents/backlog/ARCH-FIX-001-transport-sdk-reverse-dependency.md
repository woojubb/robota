---
title: 'ARCH-FIX-001: agent-transport-ws/http의 agent-sdk 역방향 의존 제거'
status: todo
created: 2026-05-10
priority: critical
urgency: next
area: architecture
related: [V-DEP-001, ARCH-CONF-006]
---

## Problem

`agent-transport-ws`와 `agent-transport-http`는 `dependency-direction.md` 기준으로 Adapters 레이어 소속이다. Adapters 레이어는 Domain(`agent-core`) 방향으로만 의존해야 하지만, 두 패키지 모두 Assembly 레이어인 `@robota-sdk/agent-sdk`를 직접 의존한다.

```
agent-transport-ws/package.json  → @robota-sdk/agent-sdk  (역방향)
agent-transport-http/package.json → @robota-sdk/agent-sdk  (역방향)
```

이는 Adapters → Assembly 방향의 레이어 역전이며, layered assembly 아키텍처 규칙 위반이다.

## Solution

1. `agent-transport-ws`와 `agent-transport-http`가 `agent-sdk`에서 사용하는 타입·인터페이스를 조사한다.
2. 해당 심볼을 `agent-core`(Domain 레이어) 또는 적절한 계약 패키지로 이동한다.
3. transport 패키지의 `agent-sdk` 의존성을 제거하고 `agent-core` 또는 계약 패키지로 교체한다.
4. `dependency-direction.md` 레이어 다이어그램을 업데이트해 실제 의존 관계를 반영한다.

## Test Plan

- `pnpm typecheck` 전체 통과
- `pnpm build` 전체 통과
- `agent-transport-ws/package.json`과 `agent-transport-http/package.json`에 `agent-sdk` 의존성 없음 확인
- `pnpm --filter @robota-sdk/agent-transport-ws test` 통과
- `pnpm --filter @robota-sdk/agent-transport-http test` 통과
- harness verify: `pnpm harness:verify -- --scope packages/agent-transport-ws`
- harness verify: `pnpm harness:verify -- --scope packages/agent-transport-http`

## User Execution Test Scenarios

### 시나리오: WebSocket transport를 사용하는 CLI --web 모드 정상 동작 확인

**전제 조건**: Node.js 22+, pnpm 빌드 완료

**실행 단계**:

```bash
pnpm build
robota --web
```

**기대 결과**: `--web` 플래그가 정상 동작하고 WebSocket 사이드카 서버가 실행된다. 빌드 오류 없음.

**증거**: (구현 후 기록)
