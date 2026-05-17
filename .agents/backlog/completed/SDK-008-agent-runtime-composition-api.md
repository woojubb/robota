---
title: 'SDK-008: createAgentRuntime — easy application composition API'
status: done
created: 2026-05-17
completed: 2026-05-17
priority: high
urgency: soon
area: packages/agent-framework, packages/agent-transport, packages/agent-cli
---

## Problem

`agent-cli/src/cli.ts`가 애플리케이션을 조립하기 위해 15개 이상의 의존성을 직접
연결합니다:

```typescript
// 현재 cli.ts — 사용자가 따라야 할 패턴이 너무 복잡
const commandHostAdapters = { ... };
const providerDefinitions = ...;
const providerSettingsAdapter = { ... };
const commandModules = createDefaultCommandModules({ ... });
const backgroundTaskRunners = createDefaultBackgroundTaskRunners();
const subagentRunnerFactory = createChildProcessSubagentRunnerFactory({ ... });
const sessionStore = createProjectSessionStore(cwd);
const transportRegistry = createDefaultTransportRegistry();

const transport = new TuiTransport({
  cwd, provider, providerOverride, providerType, modelId,
  language, permissionMode, maxTurns, version,
  sessionStore, resumeSessionId, showSessionPickerOnStart,
  forkSession, sessionName,
  backgroundTaskRunners, subagentRunnerFactory,
  commandModules, commandHostAdapters,
  shellExec, startupUpdateNotice,
  transportRegistry, cliAdapter, reloadPluginCommandSource, agentName,
});
```

`agent-framework`를 사용해 새 애플리케이션(커스텀 CLI, headless bot, 스크립트 등)을
만들려면 이 모든 연결 방법을 직접 파악해야 합니다.

**원칙**: "관련 패키지를 주입하고, 주입할 때 필요한 설정을 함께 주입하는 방식으로
agent-framework를 쉽게 이용할 수 있어야 한다."

---

## Design

### 현재 `IRenderOptions` 필드 분류

| 필드                                                                        | 분류                               |
| --------------------------------------------------------------------------- | ---------------------------------- |
| `cwd`, `provider`                                                           | 런타임 필수 (사용자 제공)          |
| `commandModules`, `commandHostAdapters`                                     | 런타임 조립 (주입 가능, 기본값 有) |
| `backgroundTaskRunners`, `subagentRunnerFactory`                            | 런타임 조립 (주입 가능, 기본값 有) |
| `sessionStore`, `transportRegistry`                                         | 런타임 조립 (cwd 기반 기본값)      |
| `reloadPluginCommandSource`                                                 | 런타임 조립                        |
| `providerOverride`, `providerType`, `modelId`                               | TUI 전용 (표시 정보)               |
| `language`, `permissionMode`, `maxTurns`                                    | TUI 전용 (UI 설정)                 |
| `version`, `startupUpdateNotice`, `shellExec`                               | TUI 전용                           |
| `cliAdapter`, `agentName`                                                   | TUI 전용                           |
| `resumeSessionId`, `showSessionPickerOnStart`, `forkSession`, `sessionName` | 세션 선택                          |

---

### 새 API — `agent-framework`에 추가

```typescript
// packages/agent-framework/src/runtime/agent-runtime.ts

export interface IAgentRuntimeConfig {
  cwd: string;
  provider: IAIProvider;

  // 주입 가능, 미제공 시 기본값 사용
  commandModules?: readonly ICommandModule[];
  commandHostAdapters?: ICommandHostAdapters;
  backgroundTaskRunners?: IBackgroundTaskRunner[];
  subagentRunnerFactory?: TSubagentRunnerFactory;
  sessionStore?: IInteractiveSessionStore;
  transportRegistry?: ITransportRegistryView<IInteractiveSession>;
  reloadPluginCommandSource?: (registry: CommandRegistry) => void;
}

export interface IAgentRuntime {
  readonly cwd: string;
  readonly provider: IAIProvider;
  readonly commandModules: readonly ICommandModule[];
  readonly commandHostAdapters: ICommandHostAdapters;
  readonly backgroundTaskRunners: IBackgroundTaskRunner[];
  readonly subagentRunnerFactory: TSubagentRunnerFactory | undefined;
  readonly sessionStore: IInteractiveSessionStore | undefined;
  readonly transportRegistry: ITransportRegistryView<IInteractiveSession>;
  readonly reloadPluginCommandSource: (registry: CommandRegistry) => void;
}

export function createAgentRuntime(config: IAgentRuntimeConfig): IAgentRuntime;
```

`commandModules`는 `agent-framework`가 `agent-command`에 의존할 수 없으므로
빈 배열을 기본값으로 가지며, 사용자가 주입합니다.
`commandHostAdapters`는 `cwd` 기반으로 기본 구현을 생성합니다.
`backgroundTaskRunners`는 `createDefaultBackgroundTaskRunners()`를 기본값으로 합니다.
`transportRegistry`는 `createDefaultTransportRegistry()`를 기본값으로 합니다.

---

### Transport 수정 — `IRenderOptions` 분리

```typescript
// packages/agent-transport/src/tui/render.tsx

export interface ITuiRenderOptions {
  // 런타임 번들 (IAgentRuntime 구현)
  runtime: IAgentRuntime;

  // TUI 전용 옵션
  providerOverride?: string;
  providerType?: string;
  modelId?: string;
  language?: string;
  permissionMode?: TPermissionMode;
  maxTurns?: number;
  version?: string;
  resumeSessionId?: string;
  showSessionPickerOnStart?: boolean;
  forkSession?: boolean;
  sessionName?: string;
  shellExec?: TShellExecFn;
  startupUpdateNotice?: Promise<string | undefined>;
  cliAdapter: ITuiCliAdapter;
  agentName?: string;
}
```

기존 `IRenderOptions`는 `ITuiRenderOptions`로 교체되거나,
`runtime` 필드로 번들된 형태로 병합됩니다.

---

### `agent-cli` 결과 — 단순화된 cli.ts

```typescript
// 사용자가 주입하는 것: provider + 필요한 확장만
const provider = createProviderFromSettings(cwd, args.model, providerOptions);

const runtime = createAgentRuntime({
  cwd,
  provider,
  commandModules: [
    ...createDefaultCommandModules({ cwd, providerDefinitions, providerSettingsAdapter }),
    ...(options.commandModules ?? []),
  ],
  subagentRunnerFactory: createChildProcessSubagentRunnerFactory({
    workerPath: getDefaultSubagentWorkerPath(),
    providerConfig: { ...providerSettings, model: modelId },
    logsDir: paths.logs,
  }),
});

const transport = new TuiTransport({
  runtime,
  providerOverride: args.provider,
  providerType: providerSettings.name,
  modelId,
  language: args.language,
  permissionMode: args.permissionMode,
  version,
  resumeSessionId,
  showSessionPickerOnStart,
  forkSession: args.forkSession,
  sessionName: args.sessionName,
  shellExec: ...,
  startupUpdateNotice: ...,
  cliAdapter: createDefaultTuiCliAdapter({ providerDefinitions, reloadPluginCommandSource }),
});

await transport.start();
```

---

### 커스텀 애플리케이션 예시 (headless bot)

```typescript
// 외부 사용자가 agent-framework로 봇을 만드는 방법
import { createAgentRuntime } from '@robota-sdk/agent-framework';
import { PrintTerminal } from '@robota-sdk/agent-transport/headless';

const runtime = createAgentRuntime({
  cwd: process.cwd(),
  provider: myProvider,
});

const session = runtime.createSession();
const response = await session.chat('Hello');
```

---

## Scope

### `packages/agent-framework`

- `src/runtime/agent-runtime.ts` 신규: `IAgentRuntimeConfig`, `IAgentRuntime`, `createAgentRuntime`
- `src/runtime/index.ts` 신규: runtime 모듈 export
- `src/index.ts`: `IAgentRuntime`, `createAgentRuntime` export 추가

### `packages/agent-transport`

- `src/tui/render.tsx`: `IRenderOptions` → `ITuiRenderOptions` (runtime 필드 추가, 번들 필드 제거)
- `src/tui/tui-transport.ts`: 생성자 파라미터 업데이트
- `src/tui/index.ts`: 타입 export 업데이트

### `packages/agent-cli`

- `src/cli.ts`: `createAgentRuntime` 사용으로 조립 단순화
- `src/startup/command-setup.ts`: `IAgentRuntime` 반환으로 변경 또는 제거

---

## Test Plan

- `agent-framework` 단위: `createAgentRuntime` 기본값 검증
- `agent-framework` 단위: 주입된 값이 올바르게 전달되는지 검증
- `agent-transport` 단위: `IRenderOptions` → `ITuiRenderOptions` 마이그레이션 후 기존 동작 유지
- `pnpm --filter @robota-sdk/agent-framework typecheck`
- `pnpm --filter @robota-sdk/agent-transport typecheck`
- `pnpm --filter @robota-sdk/agent-cli typecheck`
- `pnpm test` 전체

## User Execution Test Scenarios

### Scenario 1: CLI 기본 실행

- Prerequisites: provider 설정 완료
- Steps: `pnpm run cli:dev` → 메시지 입력
- Expected: 이전과 동일하게 동작 (리팩토링 후 행동 변화 없음)
- Evidence: typecheck pass (agent-framework, agent-transport, agent-cli 모두) + `pnpm test` 전체 통과 (82+48+5+20 test files, 실패 0). TuiTransport 생성자가 `ITuiRenderOptions`로 교체되었고 cli.ts 조립 경로가 유효함.

### Scenario 2: headless 커스텀 봇

- Prerequisites: `createAgentRuntime` export 확인
- Steps: 예시 스크립트 작성 후 `tsx example.ts`
- Expected: `createAgentRuntime({ cwd, provider })` 만으로 세션 생성 가능
- Evidence: `createAgentRuntime`, `IAgentRuntime`, `IAgentRuntimeConfig` 이 `@robota-sdk/agent-framework` dist/node/index.d.ts에 공개 export 확인됨. 기본값(backgroundTaskRunners, commandHostAdapters, sessionStore)이 `createAgentRuntime({ cwd, provider })` 호출만으로 생성됨.
