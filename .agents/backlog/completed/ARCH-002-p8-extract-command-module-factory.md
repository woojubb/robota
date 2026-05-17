---
title: 'ARCH-002-p8: createDefaultCliCommandModules를 cli.ts에서 agent-framework으로 추출'
status: done
created: 2026-05-17
priority: medium
urgency: later
area: packages/agent-cli, packages/agent-framework
---

# ARCH-002-p8 — createDefaultCliCommandModules 추출

## Context

ARCH-002 원칙에 따라 `cli.ts`는 composition root여야 한다.
현재 `cli.ts`에는 `createDefaultCliCommandModules` 팩토리 함수가 인라인으로 정의되어 있으며
이 함수는 `@robota-sdk/agent-command`의 command module 생성자들만 조합한다.

CLI에 특화된 로직이 없어 agent-framework으로 이동하면:

1. `cli.ts`가 더 짧아지고 composition root 역할에 집중할 수 있다.
2. headless 환경, server 환경에서도 동일한 기본 command 세트를 재사용할 수 있다.
3. `IStartCliOptions.commandModules`로 확장하는 패턴과 분리가 명확해진다.

## Violation

### `cli.ts`에 인라인 정의된 command module 팩토리

```typescript
export function createDefaultCliCommandModules({
  cwd,
  providerDefinitions,
}: ICreateDefaultCliCommandModulesOptions): readonly ICommandModule[] {
  return [
    createSkillsCommandModule({ cwd }),
    createHelpCommandModule(),
    createAgentCommandModule(),
    createModelCommandModule({
      providerDefinitions,
      settings: { readMergedSettings: () => readMergedProviderSettings(cwd) },
    }),
    // ... 16개 command module 생성자 ...
  ];
}
```

- **위반 이유**: 순수한 command module 조립 로직이 cli.ts composition root 안에 혼재한다.
  `@robota-sdk/agent-command`와 `@robota-sdk/agent-framework`만 의존하므로 cli.ts에 있을
  이유가 없다.
- **수정**: `packages/agent-framework/src/cli/default-command-modules.ts`로 추출.
  `ICreateDefaultCliCommandModulesOptions`, `createDefaultCliCommandModules` 모두 이동.
  agent-framework에서 export, cli.ts에서 import.

## Dependencies

- ARCH-002-p6 선행 필요: `readMergedProviderSettings`가 agent-framework으로 이동해야
  `createDefaultCliCommandModules`가 agent-framework 내에서 내부 import로 사용할 수 있다.

## Acceptance Criteria

- `packages/agent-framework`에 `createDefaultCliCommandModules`가 export된다.
- `cli.ts`에 `createDefaultCliCommandModules` 정의가 없다.
- `cli.ts`는 agent-framework에서 `createDefaultCliCommandModules`를 import한다.
- `pnpm --filter @robota-sdk/agent-cli typecheck` 통과.
- `pnpm --filter @robota-sdk/agent-framework typecheck` 통과.
- `pnpm --filter @robota-sdk/agent-cli test` 전체 통과.

## Test Plan

- [ ] `pnpm --filter @robota-sdk/agent-framework typecheck` 에러 없음
- [ ] `pnpm --filter @robota-sdk/agent-cli typecheck` 에러 없음
- [ ] `pnpm --filter @robota-sdk/agent-cli test` 전부 통과
- [ ] `grep -n "createDefaultCliCommandModules" packages/agent-cli/src/cli.ts` — import 라인만 남고 정의 없음
- [ ] `grep -n "createDefaultCliCommandModules" packages/agent-framework/src` — 정의 존재

## User Execution Test Scenarios

이 작업은 내부 리팩토링이다. 기본 command 세트는 이동 후에도 동일해야 한다.

### Scenario 1: 슬래시 커맨드 목록 확인

**Prerequisites**: robota CLI 빌드 완료, TUI 실행 가능 환경

**Steps**:

1. `robota` 실행 — TUI 진입
2. `/help` 입력

**Expected**: 기존과 동일한 커맨드 목록 표시 (help, agent, model, provider 등)

**Evidence**: (구현 후 채움)

### Scenario 2: 모델 변경 커맨드 동작 확인

**Prerequisites**: robota CLI 빌드 완료, provider 설정 완료

**Steps**:

1. `robota` 실행 — TUI 진입
2. `/model` 입력 — 모델 선택 UI 표시 확인

**Expected**: 모델 선택 UI 정상 표시, 선택 후 모델 변경 적용

**Evidence**: (구현 후 채움)
