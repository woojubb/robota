---
title: 'REFACTOR-018: agent-interface-transport agent-core 의존 최소화'
status: backlog
created: 2026-05-15
priority: low
urgency: backlog
area: packages/agent-interface-transport, packages/agent-core
---

## Problem

순수 계약 패키지인 `packages/agent-interface-transport`가 `@robota-sdk/agent-core`를 production dependency로 보유한다:

```ts
// transport-adapter.ts:7
import type { ISession } from '@robota-sdk/agent-core';
// transport-config.ts:5
import type { TUniversalValue } from '@robota-sdk/agent-core';
```

`agent-interface-*` 패키지는 cross-cutting contracts의 SSOT로서 최소 의존을 가져야 한다. agent-core 변화에 종속됨으로써 독립성이 낮아진다.

Source: COMBINED-018 (SA-010)

## Scope

Option A: `ISession`과 `TUniversalValue`를 더 하위 primitive contract 패키지(`agent-interface-core` 등)로 이동. 가장 이상적.

Option B: `@robota-sdk/agent-core`를 devDependency 또는 peerDependency로 변경.

Option C: transport adapter contract에서 `ISession`을 제거하고 generic parameter로 처리 (REFACTOR-005와 연계).

구현 전 사용자 컨펌 필요.

## Test Plan

- `pnpm typecheck` — 전체 통과
- `pnpm build` — 전체 통과

## User Execution Test Scenarios

Not applicable — 패키지 의존 재구성이며 사용자 관찰 가능한 동작 변화 없음.
