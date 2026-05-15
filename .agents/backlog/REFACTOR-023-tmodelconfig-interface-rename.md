---
title: 'REFACTOR-023: TModelConfig / TConfigurationSnapshot → interface 변환'
status: backlog
created: 2026-05-15
priority: low
urgency: backlog
area: packages/agent-core
---

## Problem

`packages/agent-core/src/core/robota.ts:63,73`에서 object shape을 `type` alias로 선언한다:

```ts
type TModelConfig = { provider: string; model: string; temperature?: number; ... };
type TConfigurationSnapshot = { version: number; tools: Array<...>; updatedAt: number; };
```

Object shapes는 `interface`로 선언해야 한다는 규칙 위반.

Rule violation: Object shapes must use `interface`, not `type` alias.

Source: COMBINED-023 (SD-015)

## Scope

1. `type TModelConfig` → `interface IModelConfig` (또는 private용이면 export 없이 `interface`).
2. `type TConfigurationSnapshot` → `interface IConfigurationSnapshot`.
3. 참조 업데이트.

## Test Plan

- `pnpm typecheck` — 전체 통과
- `pnpm --filter @robota-sdk/agent-core test` — 통과

## User Execution Test Scenarios

Not applicable — 내부 타입 선언 형식 변경이며 동작 변화 없음.
