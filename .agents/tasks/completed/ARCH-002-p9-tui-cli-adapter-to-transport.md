---
title: 'ARCH-002-p9: createTuiCliAdapter → agent-transport/tui'
status: done
created: 2026-05-17
priority: high
urgency: now
area: packages/agent-transport, packages/agent-cli
---

# ARCH-002-p9 — createTuiCliAdapter를 agent-transport로 이동

## Context

`cli.ts`의 `createTuiCliAdapter`는 agent-framework 함수들을 `ITuiCliAdapter` 인터페이스로 래핑한다.
`ITuiCliAdapter` 정의는 이미 `agent-transport/src/tui/tui-cli-adapter.ts`에 있고,
`agent-transport`는 이미 `agent-framework`에 의존한다.

따라서 이 팩토리 함수는 agent-transport에 있어야 한다.
cli.ts는 adapter를 생성하는 동작이 아닌 결과만 사용해야 한다.

## Violation

```typescript
// cli.ts — 동작 로직이 composition root 안에 있음
function createTuiCliAdapter(providerDefinitions: readonly IProviderDefinition[]): ITuiCliAdapter {
  return {
    getUserSettingsPath: () => getUserSettingsPath(),
    readSettings: (path) => readSettings(path),
    writeSettings: (path, settings) => writeSettings(path, settings),
    deleteSettings: (path) => deleteSettings(path),
    applyStatusLineSettings: (path, patch) => applyStatusLineSettings(path, patch),
    reloadPluginCommandSource: (registry) => {
      reloadPluginCommandSource(registry);
    },
    applyActiveModelChange: (cwd, modelId, options) => {
      applyActiveModelChange(cwd, modelId, options);
      return { applied: true };
    },
    getGitBranch: (cwd) => resolveGitBranch(cwd),
    getProviderDisplayName: (type) =>
      findProviderDefinition(providerDefinitions, type)?.displayName ?? type,
  };
}
```

## 수정 방법

`agent-transport/src/tui/` 에 `createDefaultTuiCliAdapter.ts` 생성:

```typescript
// agent-transport/src/tui/create-default-tui-cli-adapter.ts
import type { IProviderDefinition } from '@robota-sdk/agent-core';
import type { CommandRegistry } from '@robota-sdk/agent-framework';
import {
  getUserSettingsPath, readSettings, writeSettings, deleteSettings,
  applyStatusLineSettings, applyActiveModelChange, resolveGitBranch,
  findProviderDefinition,
} from '@robota-sdk/agent-framework';
import type { ITuiCliAdapter } from './tui-cli-adapter.js';

export interface IDefaultTuiCliAdapterOptions {
  providerDefinitions: readonly IProviderDefinition[];
  reloadPluginCommandSource: (registry: CommandRegistry) => void;
}

export function createDefaultTuiCliAdapter(
  options: IDefaultTuiCliAdapterOptions,
): ITuiCliAdapter { ... }
```

agent-transport/tui/index.ts 에서 export.
cli.ts 는 이 팩토리를 import해서 호출만 한다.

## Dependencies

없음

## Acceptance Criteria

- `packages/agent-transport-tui/src/` 에 `createDefaultTuiCliAdapter` export됨
- `cli.ts`에 `createTuiCliAdapter` 정의 없음
- `pnpm --filter @robota-sdk/agent-transport build` 통과
- `pnpm --filter @robota-sdk/agent-cli typecheck` 통과
- `pnpm --filter @robota-sdk/agent-cli test` 전체 통과

## Test Plan

- [x] agent-transport 빌드 성공
- [x] agent-cli typecheck 에러 없음
- [x] agent-cli test 111/111 통과
- [x] grep으로 cli.ts에 createTuiCliAdapter 정의 없음 확인

## Evidence

- `packages/agent-transport-tui/src/create-default-tui-cli-adapter.ts` 생성 완료
- `packages/agent-transport-tui/src/index.ts`에 export 추가
- `cli.ts`는 `createDefaultTuiCliAdapter` import 후 호출만 함
- `pnpm --filter @robota-sdk/agent-cli typecheck` 통과 (에러 없음)
- `pnpm --filter @robota-sdk/agent-cli test` 111/111 통과
