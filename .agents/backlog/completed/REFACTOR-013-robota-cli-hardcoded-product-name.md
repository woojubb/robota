---
title: 'REFACTOR-013: agent-sessions 하드코딩된 robota-cli 제품명 제거'
status: backlog
created: 2026-05-15
priority: medium
urgency: later
area: packages/agent-sessions
---

## Problem

`packages/agent-sessions/src/session.ts:167`에서 `IAgentConfig` 생성 시 `name: 'robota-cli'`를 하드코딩한다:

```ts
const agentConfig: IAgentConfig = {
  name: 'robota-cli',
  ...
};
```

`agent-sessions`는 foundation 패키지로 SDK, transport, 임의의 host가 소비한다. 에이전트 이름은 CLI의 구현 세부사항이지 세션 레이어의 책임이 아니다.

Rule violation: No product names in code. Foundation packages must not reference specific consumer names.

Source: COMBINED-013 (SD-009)

## Scope

1. `ISessionOptions`에 `agentName?: string` 필드 추가.
2. `Session` 생성자가 `options.agentName ?? 'agent'` 형태로 사용. 기본값은 제품 중립적 문자열.
3. `agent-cli`의 session 생성 지점에서 `agentName: 'robota-cli'` 명시적 전달.

## Test Plan

- `pnpm typecheck` — 전체 통과
- `grep -r "'robota-cli'" packages/agent-sessions/src --include="*.ts"` — 결과 없음
- `pnpm --filter @robota-sdk/agent-sessions test` — 통과

## User Execution Test Scenarios

Not applicable — 에이전트 이름은 내부 설정이며 사용자 관찰 가능한 TUI/CLI 동작 변화 없음.
