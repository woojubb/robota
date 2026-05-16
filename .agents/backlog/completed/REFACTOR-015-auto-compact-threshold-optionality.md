---
title: 'REFACTOR-015: getAutoCompactThreshold optionality 일관화'
status: backlog
created: 2026-05-15
priority: medium
urgency: later
area: packages/agent-sdk
---

## Problem

`packages/agent-sdk/src/command-api/host-context.ts`에서 같은 동작이 두 인터페이스에서 다른 optionality를 가진다:

- `ICommandSessionRuntime` (line 64): `getAutoCompactThreshold?(): number | false` (optional)
- `ICommandHostContext` (line 79): `getAutoCompactThreshold(): TAutoCompactThreshold` (required)

두 인터페이스가 composition 관계(`ICommandHostContext.getSession()` → `ICommandSessionRuntime`)임에도 동일 동작에 두 가지 계약이 존재한다. `ICommandSessionRuntime` 호출자는 `?.` 가드가 필요하고 `ICommandHostContext` 호출자는 불필요하다.

Rule violation: Consistent interface contracts.

Source: COMBINED-015 (SD-011)

## Scope

1. `getAutoCompactThreshold`가 실제로 항상 사용 가능한지 여부를 기준으로 canonical optionality를 결정.
2. 두 인터페이스에서 동일하게 통일 (required 또는 optional).
3. 모든 caller 업데이트.

## Test Plan

- `pnpm typecheck` — 전체 통과
- `pnpm --filter @robota-sdk/agent-sdk test` — 통과

## User Execution Test Scenarios

Not applicable — 내부 계약 일관화이며 사용자 관찰 가능한 동작 변화 없음.
