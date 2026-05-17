---
title: 'CLI-001: agent-cli architectural rules — layer separation and same-level injection'
status: done
created: 2026-05-17
priority: high
urgency: soon
area: packages/agent-cli
---

## Problem

`agent-cli`는 현재 구조적 규칙 없이 모든 관심사가 `cli.ts` 하나에 혼재됩니다.

1. **레이어 없음** — arg 처리, config 관리, runtime 조립, transport 실행이 한 함수 안에 뒤섞임
2. **args 예외 처리 불일치** — 일부 args(`--help`, `--version`, `--reset`)는 즉시 분기하고 일부는 함수로 위임하나 공통 계층 없음
3. **`IParsedCliArgs` 누수** — 원시 args 객체가 `runPrintMode`, `buildAppendSystemPrompt`, `handleProviderConfigurationArgs` 등 하위 함수에 그대로 전달됨. 하위 함수가 CLI 구조를 알아야 하는 구조
4. **동일 레벨이 아닌 것들을 함께 주입** — `createAgentRuntime`에 `commandModules`(command 레이어), `subagentRunnerFactory`(subagent 레이어), `sessionStore`(session 레이어), `transportRegistry`(transport 레이어)가 같은 수준에 섞임
5. **세부 조립이 최상위에 노출** — `createChildProcessSubagentRunnerFactory({ workerPath, providerConfig, logsDir })`같은 저수준 구성이 composition root에 직접 등장

**원칙**: 같은 레벨의 개념만 같은 레이어에서 주입한다. 하위 레이어의 세부 구성은 그 레이어 내부에서 처리하고 상위에는 추상화된 단위만 노출한다.

---

## Current State (as-is)

```typescript
// cli.ts — 186줄, 4개 추상화 레벨 혼재

// Level A: arg 라우팅
if (args.help) { ... return; }
if (args.version) { ... return; }
if (args.reset) { ... return; }

// Level B: config 관리
const { commandHostAdapters, providerDefinitions, commandModules } = buildCommandSetup(...);
await ensureConfig(cwd, args, ...);

// Level C: runtime 조립
const runtime = createAgentRuntime({
  cwd, provider,
  commandModules,             // ← command 레이어
  commandHostAdapters,        // ← command 레이어
  subagentRunnerFactory: createChildProcessSubagentRunnerFactory({ // ← subagent 레이어 세부 구성
    workerPath, providerConfig, logsDir
  }),
  sessionStore,               // ← session 레이어
  transportRegistry,          // ← transport 레이어
  reloadPluginCommandSource,  // ← plugin 레이어
});

// Level D: transport 실행
await tuiTransport.start();
```

---

## Target Design

### Layer Model

```
┌─────────────────────────────────────────────────────┐
│ Layer 0: CLI Pre-flight Dispatch                    │
│  Unified handler for all early-exit commands        │
│  (help, version, update-check, reset)               │
│  Input: IParsedCliArgs → never leaks below          │
└─────────────────────┬───────────────────────────────┘
                      │ resolved: proceed to session
┌─────────────────────▼───────────────────────────────┐
│ Layer 1: Config Phase                               │
│  Provider setup, configure commands                 │
│  Converts args → typed config option objects        │
│  Input: ICliConfigOptions (not IParsedCliArgs)      │
└─────────────────────┬───────────────────────────────┘
                      │ resolved: valid config exists
┌─────────────────────▼───────────────────────────────┐
│ Layer 2: Sub-layer Assembly (same-level grouping)   │
│  Each group built in its own factory:               │
│    ICommandSetup  ← createCommandSetup(cwd, ...)    │
│    ISubagentSetup ← createSubagentSetup(config)     │
│  Output: same-level sub-layer objects               │
└─────────────────────┬───────────────────────────────┘
                      │ grouped dependencies
┌─────────────────────▼───────────────────────────────┐
│ Layer 3: IAgentRuntime Assembly                     │
│  createAgentRuntime receives same-level groups      │
│  Input: ICommandSetup, ISubagentSetup, etc.         │
│  (not individual fields from different layers)      │
└─────────────────────┬───────────────────────────────┘
                      │ runtime
┌─────────────────────▼───────────────────────────────┐
│ Layer 4: Mode / Transport                           │
│  runPrintMode(ISessionRunOptions, runtime)          │
│  TuiTransport({ runtime, ITuiStartOptions })        │
│  Input: typed option objects (not IParsedCliArgs)   │
└─────────────────────────────────────────────────────┘
```

---

### Layer 0 — Pre-flight Dispatch (thin unified handler)

```typescript
// packages/agent-cli/src/startup/preflight.ts

export type TPreflightResult = { handled: true } | { handled: false };

export async function handlePreflightCommands(
  args: IParsedCliArgs,
  ctx: IPreflightContext,
): Promise<TPreflightResult>;
```

현재 `cli.ts`에 흩어진 모든 early-exit 분기(`--help`, `--version`, `--check-update`, `--reset`)를 단일 함수로 통합한다. pre-flight이 처리되지 않은 경우에만 다음 레이어로 진행한다.

---

### Layer 1 — `IParsedCliArgs` → Typed Option Objects (CLI boundary)

```typescript
// IParsedCliArgs는 cli.ts(또는 preflight.ts)에서 소비 완료
// 하위 함수에는 타입화된 옵션 객체만 전달

export interface ICliConfigOptions {
  cwd: string;
  settingsScope?: TSettingsScope;
  providerOverride?: string;
}

export interface ISessionRunOptions {
  permissionMode?: TPermissionMode;
  maxTurns?: number;
  sessionName?: string;
  noSessionPersistence: boolean;
  resumeId?: string;
  continueMode: boolean;
  forkSession?: boolean;
  // ... session-related only
}

export interface ITuiStartOptions {
  providerOverride?: string;
  providerType?: string;
  modelId?: string;
  language?: string;
  version?: string;
  // ... TUI-display-related only
}
```

`runPrintMode(ISessionRunOptions, runtime)` — `IParsedCliArgs` 대신 타입화된 옵션만 수신.

---

### Layer 2 — Same-Level Sub-layer Grouping

`createAgentRuntime`에 개별 필드를 넘기는 대신, 관련 의존성을 동일 레벨 그룹으로 묶는다.

```typescript
// ICommandSetup — command 레이어 담당
export interface ICommandSetup {
  commandModules: readonly ICommandModule[];
  commandHostAdapters: ICommandHostAdapters;
  providerDefinitions: readonly IProviderDefinition[];
  reloadPluginCommandSource: (registry: CommandRegistry) => void;
}
export function createCommandSetup(cwd: string, options?: IStartCliOptions): ICommandSetup;

// ISubagentSetup — subagent 레이어 담당
export interface ISubagentSetup {
  subagentRunnerFactory: TSubagentRunnerFactory;
}
export function createSubagentSetup(config: ISubagentSetupConfig): ISubagentSetup;
// ISubagentSetupConfig는 providerSettings + paths — 세부 구성이 이 함수 안에 캡슐화됨
```

---

### Layer 3 — `createAgentRuntime` receives same-level groups

```typescript
// IAgentRuntimeConfig 개선 — 같은 레벨의 그룹화된 객체만 수신
export interface IAgentRuntimeConfig {
  cwd: string;
  provider: IAIProvider;
  commandSetup?: ICommandSetup; // command 레이어 단위
  subagentSetup?: ISubagentSetup; // subagent 레이어 단위
  sessionStore?: IInteractiveSessionStore;
  transportRegistry?: ITransportRegistryView<IInteractiveSession>;
}
```

---

### Resulting cli.ts (target)

```typescript
export async function startCli(options: IStartCliOptions = {}): Promise<void> {
  const args = parseCliArgs();
  const version = readVersion();

  // Layer 0: pre-flight — single point for all early-exit commands
  if ((await handlePreflightCommands(args, { version })).handled) return;

  const cwd = process.cwd();

  // Layer 1: config phase — typed options, no raw args below this point
  const configOptions = toCliConfigOptions(args, cwd);
  if (await handleConfigPhase(configOptions, ...)) return;

  // Layer 2: sub-layer assembly (same-level grouping)
  const providerSetup = resolveProviderSetup(cwd, args, options);
  const commandSetup = createCommandSetup(cwd, providerSetup, options);
  const subagentSetup = createSubagentSetup({ providerSetup });
  const sessionSetup = createSessionSetup(cwd, toSessionRunOptions(args));

  // Layer 3: runtime
  const runtime = createAgentRuntime({
    cwd,
    provider: providerSetup.provider,
    commandSetup,
    subagentSetup,
    ...sessionSetup,
    transportRegistry: createDefaultTransportRegistry(),
  });

  // Layer 4: mode / transport
  if (args.printMode) {
    await runPrintMode(toSessionRunOptions(args), runtime);
    return;
  }
  await new TuiTransport({ runtime, ...toTuiStartOptions(args, version) }).start();
  process.exit(0);
}
```

---

## Scope

### `packages/agent-cli`

- `src/startup/preflight.ts` 신규 — 모든 pre-flight early-exit 통합
- `src/startup/provider-setup.ts` 신규 (또는 리팩토링) — `IProviderSetup` (provider + settings)
- `src/startup/command-setup.ts` 개선 — `ICommandSetup` 반환, `reloadPluginCommandSource` 포함
- `src/startup/subagent-setup.ts` 신규 — `ISubagentSetup`, `createSubagentSetup`
- `src/startup/session-setup.ts` 신규 — `ISessionSetup`, `createSessionSetup`
- `src/startup/args-to-options.ts` 신규 — `IParsedCliArgs` → typed option objects 변환 함수 모음
- `src/cli.ts` 리팩토링 — 위 레이어들을 조합하는 얇은 orchestrator로 축소
- `src/modes/print-mode.ts` 시그니처 변경 — `IParsedCliArgs` 제거, `ISessionRunOptions` 수신

### `packages/agent-framework` (createAgentRuntime)

- `IAgentRuntimeConfig` 개선 — `commandSetup`, `subagentSetup` 그룹 수용 또는 기존 필드 유지하면서 그룹 오버로드 추가
- 설계에 따라 최소 변경 또는 별도 백로그로 분리

---

## Test Plan

- `agent-cli` 타입체크 통과
- `pnpm test` 전체 통과
- pre-flight 핸들러 유닛 테스트 (각 early-exit 커맨드)
- `toSessionRunOptions`, `toTuiStartOptions` 변환 함수 유닛 테스트
- `createCommandSetup`, `createSubagentSetup` 유닛 테스트

## User Execution Test Scenarios

### Scenario 1: CLI 기본 실행

- Prerequisites: provider 설정 완료
- Steps: `pnpm run cli:dev` → 메시지 입력 → 정상 응답
- Expected: 리팩토링 전후 동일한 동작
- Evidence: Interactive TUI 실행은 비에이전트 환경에서 자동 검증 불가 (TTY 필요). Scenario 3 print mode로 provider + session 조합 동작 검증 완료.

### Scenario 2: Pre-flight commands

- Prerequisites: 없음
- Steps: `npx tsx packages/agent-cli/src/bin.ts --help`, `--version`, `--check-update` 각각 실행
- Expected: 각 커맨드가 단일 preflight 함수를 통해 처리되고 올바른 결과 출력
- Evidence:
  - `--version` → `robota 3.0.0-beta.65` ✅
  - `--help` → Usage 출력 (Options 포함) ✅
  - `--check-update` → `Robota is up to date (3.0.0-beta.65).` ✅
  - 세 커맨드 모두 `handlePreflightCommands` 단일 함수에서 처리됨 (preflight.ts 확인)

### Scenario 3: Print mode (headless)

- Prerequisites: provider 설정 완료
- Steps: `npx tsx packages/agent-cli/src/bin.ts -p "hello" --no-session-persistence` 실행
- Expected: headless 응답 출력, `IParsedCliArgs`가 `runPrintMode`에 전달되지 않음
- Evidence:
  - 출력: `안녕하세요! 👋 Robota 모노레포 작업을 도와드릴 준비가 되었습니다.` ✅
  - `runPrintMode` 시그니처: `(opts: ISessionRunOptions, runtime: IAgentRuntime)` — `IParsedCliArgs` 없음 ✅
