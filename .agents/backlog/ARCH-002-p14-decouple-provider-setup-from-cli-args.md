---
title: 'ARCH-002-p14: provider setup 오케스트레이션을 IParsedCliArgs에서 분리'
status: backlog
created: 2026-05-17
priority: medium
urgency: later
area: packages/agent-cli, packages/agent-command
---

# ARCH-002-p14 — ensureConfig/runInteractiveProviderSetup → agent-command

## Context

CLI-AUDIT-014. `ensureConfig(cwd, args: IParsedCliArgs, ...)`, `runInteractiveProviderSetup(cwd, args: IParsedCliArgs, ...)`
는 `IParsedCliArgs`에서 `args.provider`와 `args.settingsScope`만 사용한다.
전체 CLI args struct를 전달하면 이 함수들이 CLI 외부에서 재사용 불가능하고
agent-command로 이동할 수 없다.

## 수정 방법

```typescript
// agent-command에 추가
export interface IProviderStartupContext {
  provider?: string;
  settingsScope?: 'user' | 'project-local';
}

export async function ensureProviderConfig(
  cwd: string,
  ctx: IProviderStartupContext,
  promptInput: TPromptInput,
  terminal: ITerminalOutput,
  providerDefinitions: readonly IProviderDefinition[],
): Promise<void>;

export async function runProviderSetupFlow(
  cwd: string,
  ctx: IProviderStartupContext,
  promptInput: TPromptInput,
  terminal: ITerminalOutput,
  providerDefinitions: readonly IProviderDefinition[],
): Promise<void>;
```

agent-cli의 `provider-startup.ts` (p13 이후):

- `handleProviderConfigurationArgs` — CLI-specific, 유지
- `ensureConfig` → agent-command `ensureProviderConfig` 호출
- `runInteractiveProviderSetup` → agent-command `runProviderSetupFlow` 호출
- cli.ts: `IParsedCliArgs` → `IProviderStartupContext` 매핑 후 호출

## Dependencies

ARCH-002-p13 (provider-setup.ts 이동) 완료 후

## Acceptance Criteria

- `ensureProviderConfig` agent-command에서 export
- `provider-startup.ts`에 `ensureConfig`, `runInteractiveProviderSetup` 정의 없음
- typecheck, test 전체 통과
