---
title: 'ARCH-FIX-031: move resetUserConfig orchestration to agent-framework'
status: backlog
created: 2026-05-17
priority: medium
urgency: soon
area: packages/agent-cli, packages/agent-framework
---

## Problem

`packages/agent-cli/src/startup/reset-config.ts`가 설정 초기화 로직을 소유하고 있다.
내부적으로 `getUserSettingsPath()` + `deleteSettings()` (모두 `agent-framework` 소유)를
조합하는 orchestration인데, 이 조합 자체가 CLI에 묶여 있다.

또한 `process.stdout.write`를 직접 사용해 `ITerminalOutput` 추상화를 우회하고 있어
테스트가 불가능하다.

CLI 외의 환경(headless, web, programmatic API)에서도 설정 초기화가 가능해야 한다.

## Proposed Change

`agent-framework`에 결과 반환형 유틸리티 함수를 추가한다:

```typescript
// packages/agent-framework/src/...
export function resetUserConfig(): { deleted: boolean; path: string };
```

`agent-cli/src/startup/reset-config.ts`:

```typescript
import { resetUserConfig } from '@robota-sdk/agent-framework';
import type { ITerminalOutput } from '@robota-sdk/agent-core';

export function runResetConfig(terminal: ITerminalOutput): void {
  const result = resetUserConfig();
  if (result.deleted) {
    terminal.writeLine(`Deleted ${result.path}`);
  } else {
    terminal.writeLine('No user settings found.');
  }
}
```

- `process.stdout.write` 직접 호출 제거
- `ITerminalOutput` 주입으로 테스트 가능하게 변경
- 로직 자체는 `agent-framework` 소유

## Scope

- `packages/agent-framework/src/` — `resetUserConfig` 추가 및 export
- `packages/agent-cli/src/startup/reset-config.ts` — 결과 수신 + terminal 출력으로 교체
- 호출 지점 (`bin.ts` 또는 startup flow) — `ITerminalOutput` 전달 방식으로 업데이트

## Test Plan

- `agent-framework` 단위 테스트: 파일 존재 시 `{ deleted: true, path }` 반환
- `agent-framework` 단위 테스트: 파일 없을 시 `{ deleted: false, path }` 반환
- `agent-cli` 단위 테스트: terminal mock으로 출력 메시지 검증
- `pnpm --filter @robota-sdk/agent-framework typecheck`
- `pnpm --filter @robota-sdk/agent-cli typecheck`
- `pnpm --filter @robota-sdk/agent-framework test`
- `pnpm --filter @robota-sdk/agent-cli test`

## User Execution Test Scenarios

### Scenario 1: 설정 파일이 존재할 때 reset

- Prerequisites: `~/.robota/settings.json` 파일이 존재
- Steps: `robota --reset-config`
- Expected: `Deleted /Users/<user>/.robota/settings.json` 출력, 파일 삭제 확인
- Evidence: _(to be filled after implementation)_

### Scenario 2: 설정 파일이 없을 때 reset

- Prerequisites: `~/.robota/settings.json` 파일 없음
- Steps: `robota --reset-config`
- Expected: `No user settings found.` 출력, 오류 없이 종료
- Evidence: _(to be filled after implementation)_
