---
title: 'REFACTOR-009: agent-sdk node:fs 직접 사용 → IFileSystem port + adapter injection'
status: backlog
created: 2026-05-15
priority: medium
urgency: later
area: packages/agent-sdk, packages/agent-cli
---

## Problem

Assembly 레이어인 `agent-sdk`가 10개 이상의 production 파일에서 `node:fs`를 직접 import한다:

```ts
// context/task-context.ts:1
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
// memory/pending-memory-store.ts:1
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
// assembly/subagent-logger.ts:9
import { mkdirSync } from 'node:fs';
// plugins/marketplace-registry.ts:8
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
```

이로 인해 agent-sdk를 브라우저나 대안 환경에서 사용하거나 파일 시스템 동작을 mock하는 것이 어렵다.

Rule violation: Side concerns are injectable. Concrete I/O belongs in injected adapters.

Source: COMBINED-009 (SA-007)

## Scope

1. `IFileSystem` port interface 정의 (agent-core 또는 agent-interface-\* 에).
2. 기본 Node.js `fs` 구현 어댑터를 agent-sdk 내부 또는 agent-cli에 배치.
3. `task-context.ts`, `pending-memory-store.ts`, `subagent-logger.ts`, `marketplace-registry.ts` 등에서 direct `node:fs` import를 `IFileSystem` 주입으로 교체.
4. 테스트에서 mock `IFileSystem` 사용 가능하도록 변경.

## Test Plan

- `grep -r "from 'node:fs'" packages/agent-sdk/src --include="*.ts"` — 결과 없음
- `pnpm typecheck` — 전체 통과
- `pnpm --filter @robota-sdk/agent-sdk test` — 통과
- `pnpm build` — 전체 통과

## User Execution Test Scenarios

Not applicable — 내부 I/O 추상화이며 사용자 관찰 가능한 동작 변화 없음. 파일 저장/읽기 동작은 동일하게 유지된다.
