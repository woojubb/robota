---
title: 'REFACTOR-002: agent-sdk pass-through re-export 제거'
status: backlog
created: 2026-05-15
priority: high
urgency: soon
area: packages/agent-sdk, packages/agent-cli
---

## Problem

`packages/agent-sdk/src/background-tasks/index.ts`와 `packages/agent-sdk/src/subagents/index.ts`가 `BackgroundTaskManager`, `SubagentManager`, `WorktreeSubagentRunner`, `BackgroundTaskError` 등 agent-runtime 소유 심벌을 그대로 re-export한다.

```ts
// agent-sdk/src/background-tasks/index.ts:1
export { BackgroundTaskManager } from '@robota-sdk/agent-runtime';

// agent-sdk/src/subagents/index.ts:1
export { SubagentManager } from '@robota-sdk/agent-runtime';
export { WorktreeSubagentRunner, createWorktreeSubagentRunner } from '@robota-sdk/agent-runtime';
```

이로 인해 agent-runtime 소유 심벌이 agent-sdk 공개 표면에 중복 노출되고, 소비자가 두 경로 모두에서 import 가능한 혼란이 생긴다.

Rule violation: common-mistakes 규칙 4 — Pass-through re-exports 금지.

Source: COMBINED-002 (SA-002)

## Scope

1. `agent-sdk/src/background-tasks/index.ts`에서 agent-runtime 소유 클래스 re-export 제거.
2. `agent-sdk/src/subagents/index.ts`에서 동일하게 제거.
3. `agent-sdk/src/index.ts`에서 해당 심벌들의 re-export 라인 제거.
4. 소비자(`agent-cli` 등)에서 해당 심벌을 `@robota-sdk/agent-runtime`에서 직접 import하도록 변경.
5. SDK-레이어 facade가 필요한 경우 agent-sdk 소유 wrapper 타입/클래스를 별도 정의.

## Test Plan

- `pnpm typecheck` — 전체 통과
- `pnpm --filter @robota-sdk/agent-sdk test` — 통과
- `pnpm --filter @robota-sdk/agent-cli test` — 통과
- `pnpm build` — 전체 통과

## User Execution Test Scenarios

Not applicable — 공개 API 재구성이나 사용자 관찰 가능한 CLI 동작 변화 없음. import 경로 변경은 내부 소비자(agent-cli)만 영향받으며 동일 세션을 동일한 방식으로 실행한다.
