---
title: 'REFACTOR-017: agent-cli findProviderDefinition → agent-sdk 경유'
status: backlog
created: 2026-05-15
priority: low
urgency: backlog
area: packages/agent-cli, packages/agent-sdk
---

## Problem

`packages/agent-cli/src/cli.ts:12`에서 `@robota-sdk/agent-core`의 `findProviderDefinition` 함수를 직접 import한다:

```ts
import { findProviderDefinition } from '@robota-sdk/agent-core';
// cli.ts:507
findProviderDefinition(providerDefinitions, type)?.displayName ?? type,
```

`agent-sdk`의 public API surface에 해당 함수가 노출되어 있지 않아 CLI가 agent-sdk를 우회해 core로 직접 접근한다.

Rule violation: No layer skipping — CLI must not directly use agent-core internals that should be wired through agent-sdk.

Source: COMBINED-017 (SA-009)

## Scope

1. `agent-sdk/src/index.ts`에서 `findProviderDefinition`을 re-export하거나 provider definition lookup을 SDK common API로 래핑.
2. `agent-cli/src/cli.ts`의 import를 `@robota-sdk/agent-sdk`로 변경.

## Test Plan

- `grep -r "from '@robota-sdk/agent-core'" packages/agent-cli/src --include="*.ts" | grep -v "type "` — 로직 함수 직접 import 없음
- `pnpm typecheck` — 전체 통과

## User Execution Test Scenarios

Not applicable — import 경로 변경이며 사용자 관찰 가능한 동작 변화 없음.
