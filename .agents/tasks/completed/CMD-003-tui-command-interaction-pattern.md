---
title: 'CMD-003: TUI command interaction — args 없이 실행 시 dialog/wizard 흐름 선언 + 게이트'
status: done
created: 2026-05-16
priority: high
urgency: soon
area: packages/agent-transport, packages/agent-cli
depends_on: [CMD-001, CMD-002]
---

## Problem

### 현재 동작

TUI에서 슬래시 커맨드를 선택하면 두 결과 중 하나다:

```
{ type: 'insert', value: '/model ' }   // subcommand 있는 경우
{ type: 'submit', value: '/help' }     // subcommand 없는 경우
```

이 두 결과는 **호출자(LLM vs 사람)와 args 제공 여부를 구분하지 않는다**.

### 진짜 문제

`/model`을 사람이 args 없이 선택했을 때와 LLM이 `/model claude-opus-4-7`을 입력했을 때는 전혀 다른 경험이어야 한다:

| 호출 방식                                   | args 있음   | args 없음                           |
| ------------------------------------------- | ----------- | ----------------------------------- |
| LLM (`/model claude-opus-4-7`)              | 즉시 실행 ✓ | — (LLM은 항상 args를 완성해서 보냄) |
| 사람 (`/model claude-opus-4-7` 직접 타이핑) | 즉시 실행 ✓ | —                                   |
| 사람 (autocomplete에서 `/model` 선택)       | 즉시 실행 ✓ | **picker 오픈** ← 현재 없음         |

**args 있음 → 항상 직접 실행** (dialog 불필요, 호출자 무관)  
**args 없음 → 커맨드에 따라 picker/wizard** (사람이 탐색하는 경우)

현재는 "args 없음" 케이스를 모두 `insert`(input 가입력 상태)로 처리하고 있어서,
`/model`을 선택하면 input에 `/model ` 이 삽입되고 사람이 모델명을 직접 타이핑해야 한다.

### 두 번째 문제 (게이트 부재)

새 커맨드가 추가될 때 "args 없이 실행되면 어떤 UI를 보여줄지"를 선언하지 않아도
아무런 경고/오류가 없다. 실수로 `insert` fallback에 남겨진다.

## Goal

1. `args 없이 실행` 시의 TUI 동작을 커맨드 및 서브커맨드 단위로 명시적으로 선언하는 시스템 구축
2. 선언 없이 커맨드가 등록되면 **typecheck 또는 harness에서 실패**하는 게이트 도입
3. picker / wizard 흐름을 실제 구현하여 input 가입력 fallback 탈피

## Design

### 핵심 원칙

```
trigger = (args 없음) AND (커맨드/서브커맨드에 onMissingArgs 선언 있음)
```

- args가 있으면 → 항상 기존대로 submit/execute
- args가 없고 onMissingArgs가 선언되어 있으면 → picker/wizard 오픈
- args가 없고 선언 없으면 → 기존 insert fallback (텍스트 입력 대기)

### 선언 계층

서브커맨드가 있는 커맨드는 **서브커맨드 단위 선언이 기본(norm)**이다.  
서브커맨드로 커버하지 못하는 예외적 케이스(서브커맨드가 없는 커맨드)는 최상위 선언만 한다.

```
커맨드에 서브커맨드 있음 → 서브커맨드별 onMissingArgs 선언 (기본)
커맨드에 서브커맨드 없음 → 최상위 onMissingArgs 선언 (예외)
```

### `onMissingArgs` 선언 타입

```typescript
// packages/agent-transport/src/tui/command-interaction.ts

export type TOnMissingArgsAction =
  | 'picker' // 선택지 목록 즉시 오픈 (model, mode, language, resume 등)
  | 'wizard' // 다단계 입력 흐름 오픈 (provider add, reset 확인 등)
  | 'confirm'; // 단순 yes/no 확인 후 실행 (exit, clear 등)

/** 서브커맨드 단위 인터랙션 */
export interface ITuiSubcommandInteraction {
  /**
   * args 없이 TUI에서 이 서브커맨드가 실행되었을 때의 동작.
   * undefined: 기존 흐름 (input 창에 삽입, 사용자 타이핑 대기).
   */
  onMissingArgs?: TOnMissingArgsAction;
}

export interface ITuiSubcommandPickerInteraction extends ITuiSubcommandInteraction {
  onMissingArgs: 'picker';
  getItems(context: ITuiInteractionContext): ITuiPickerItem[];
}

export interface ITuiSubcommandWizardInteraction extends ITuiSubcommandInteraction {
  onMissingArgs: 'wizard';
  steps: ITuiWizardStep[];
}

export interface ITuiSubcommandConfirmInteraction extends ITuiSubcommandInteraction {
  onMissingArgs: 'confirm';
  message(commandName: string): string;
}

/** 최상위 커맨드 엔트리 */
export interface ITuiCommandEntry {
  /**
   * 서브커맨드 없이 커맨드만 입력된 경우의 동작.
   * 서브커맨드가 있는 커맨드라면 이 값은 "서브커맨드 목록 picker"로 설정하는 것이 일반적.
   * undefined: 기존 insert fallback.
   */
  onMissingArgs?: TOnMissingArgsAction;

  /**
   * 서브커맨드별 인터랙션 선언.
   * - 키: 서브커맨드 name (예: 'add', 'use', 'list')
   * - 값: undefined = 의도적으로 특별 처리 없음 (즉시 실행)
   * - Record로 선언하면 누락 시 TypeScript 컴파일 에러 발생
   */
  subcommands?: Record<string, ITuiSubcommandInteraction | undefined>;
}
```

### 결정 로직

```typescript
// packages/agent-transport/src/tui/flows/input-area-flow.ts

export function resolveCommandSelection(
  value: string,
  command: ICommand,
  entry: ITuiCommandEntry | undefined,
): TCommandSelectionResult {
  const args = extractArgs(value, command.name).trim();
  const hasArgs = args.length > 0;

  if (hasArgs) {
    // args 있음 → 서브커맨드 단위 체크
    const [subcommandName, ...rest] = args.split(/\s+/);
    const subcommandArgs = rest.join(' ').trim();

    // 서브커맨드만 있고 추가 args 없음 → 서브커맨드 onMissingArgs 체크
    if (!subcommandArgs && entry?.subcommands) {
      const subInteraction = entry.subcommands[subcommandName];
      if (subInteraction?.onMissingArgs) {
        return { type: 'open-interaction', commandName: command.name, subcommandName };
      }
    }

    // 서브커맨드 + args 있거나, 서브커맨드에 선언 없음 → 직접 실행
    return { type: 'submit', value: `/${command.name} ${args}` };
  }

  // args 없음 + 최상위 onMissingArgs 선언 → dialog 오픈
  if (entry?.onMissingArgs) {
    return { type: 'open-interaction', commandName: command.name };
  }

  // args 없음 + 선언 없음 → 기존 흐름
  if (command.subcommands && command.subcommands.length > 0) {
    return { type: 'insert', value: `/${command.name} `, selectedIndex: 0 };
  }
  return { type: 'submit', value: `/${command.name}` };
}
```

### `onMissingArgs` 선언 전수 조사 (초안)

#### 서브커맨드 없는 커맨드 (최상위 선언만)

| Command    | onMissingArgs | 이유                            |
| ---------- | ------------- | ------------------------------- |
| `model`    | `picker`      | 사용 가능한 모델 목록에서 선택  |
| `mode`     | `picker`      | 권한 모드 목록에서 선택         |
| `language` | `picker`      | 언어 목록에서 선택              |
| `resume`   | `picker`      | 재개할 세션 목록에서 선택       |
| `exit`     | `confirm`     | "세션을 종료하시겠습니까?"      |
| `clear`    | `confirm`     | "히스토리를 지우시겠습니까?"    |
| `compact`  | _(없음)_      | args 없어도 즉시 실행 가능      |
| `help`     | _(없음)_      | args 불필요, 즉시 실행          |
| `rewind`   | _(없음)_      | optional args                   |
| `rename`   | _(없음)_      | 텍스트 직접 입력 필요           |
| `agent`    | _(없음)_      | natural language args 자유 입력 |
| `cost`     | _(없음)_      | args 불필요, 즉시 실행          |

#### 서브커맨드 있는 커맨드 (서브커맨드 단위 선언)

| Command       | 최상위 onMissingArgs         | 서브커맨드               | 서브커맨드 onMissingArgs |
| ------------- | ---------------------------- | ------------------------ | ------------------------ |
| `provider`    | `picker` (subcommand picker) | `current`                | _(없음)_ — 즉시 실행     |
|               |                              | `list`                   | _(없음)_ — 즉시 실행     |
|               |                              | `use`                    | `picker` — 프로파일 선택 |
|               |                              | `add`                    | `wizard` — provider 추가 |
|               |                              | `test`                   | `picker` — 프로파일 선택 |
| `reset`       | `wizard`                     | _(서브커맨드 없음)_      | —                        |
| `context`     | _(없음)_                     | `add`                    | `wizard` — 파일/URL 추가 |
|               |                              | `list`                   | _(없음)_ — 즉시 실행     |
|               |                              | `remove`                 | `picker` — 항목 선택     |
|               |                              | `clear`                  | `confirm`                |
| `background`  | _(없음)_                     | `list`                   | _(없음)_ — 즉시 실행     |
|               |                              | `cancel`                 | `picker` — 작업 선택     |
|               |                              | `log`                    | `picker` — 작업 선택     |
| `memory`      | _(없음)_                     | `read`                   | _(없음)_ — 즉시 실행     |
|               |                              | `write`                  | `wizard`                 |
| `permissions` | _(없음)_                     | 각 permission subcommand | `picker` or _(없음)_     |
| `plugin`      | _(없음)_                     | `list`                   | _(없음)_                 |
|               |                              | `enable`/`disable`       | `picker` — 플러그인 선택 |
| `statusline`  | _(없음)_                     | 각 subcommand            | _(전수 조사 필요)_       |
| `user-local`  | _(없음)_                     | 각 subcommand            | _(전수 조사 필요)_       |
| `session`     | _(없음)_                     | `list`                   | _(없음)_                 |
|               |                              | `switch`                 | `picker` — 세션 선택     |
| `settings`    | _(없음)_                     | 각 subcommand            | _(전수 조사 필요)_       |
| `skills`      | _(없음)_                     | _(서브커맨드 없음)_      | —                        |

> ⚠️ 위 분류는 초안 — 실제 구현 전 사용자 확인 필요. 각 서브커맨드 전수 조사 필요.

### 게이트 설계

#### 게이트 목표

"모든 커맨드와 서브커맨드가 onMissingArgs를 고려했는가"를 **개발자가 의식적으로 결정**했음을 강제한다.  
`undefined`가 허용되지만, 그 판단을 레지스트리에 **명시적으로 기록**해야 한다.

```typescript
// packages/agent-cli/src/tui-interactions/registry.ts

type TSystemCommandName =
  | 'agent'
  | 'background'
  | 'compact'
  | 'context'
  | 'exit'
  | 'help'
  | 'language'
  | 'memory'
  | 'mode'
  | 'model'
  | 'permissions'
  | 'plugin'
  | 'provider'
  | 'reset'
  | 'rewind'
  | 'clear'
  | 'rename'
  | 'resume'
  | 'cost'
  | 'validate-session'
  | 'settings'
  | 'skills'
  | 'statusline'
  | 'user-local';

// Record로 선언 → 커맨드 추가 시 여기도 추가 필수 (TypeScript 컴파일 에러)
export const TUI_COMMAND_INTERACTIONS: Record<TSystemCommandName, ITuiCommandEntry | undefined> = {
  // 서브커맨드 없는 커맨드 — 최상위 선언만
  model: { onMissingArgs: 'picker', getItems: getModelItems },
  mode: { onMissingArgs: 'picker', getItems: getModeItems },
  language: { onMissingArgs: 'picker', getItems: getLanguageItems },
  resume: { onMissingArgs: 'picker', getItems: getSessionItems },
  exit: { onMissingArgs: 'confirm', message: () => 'Exit the session?' },
  clear: { onMissingArgs: 'confirm', message: () => 'Clear conversation history?' },
  reset: { onMissingArgs: 'wizard', steps: resetWizardSteps },
  agent: undefined, // natural language args, 자유 입력
  compact: undefined, // args 없어도 즉시 실행
  help: undefined, // args 불필요
  rewind: undefined, // optional args
  rename: undefined, // 텍스트 직접 입력 필요
  skills: undefined,
  cost: undefined,
  'validate-session': undefined,

  // 서브커맨드 있는 커맨드 — 서브커맨드 단위 선언
  provider: {
    onMissingArgs: 'picker',
    getItems: getProviderSubcommandItems,
    subcommands: {
      current: undefined,
      list: undefined,
      use: { onMissingArgs: 'picker', getItems: getProviderProfileItems },
      add: { onMissingArgs: 'wizard', steps: providerAddWizardSteps },
      test: { onMissingArgs: 'picker', getItems: getProviderProfileItems },
    },
  },
  context: {
    onMissingArgs: undefined,
    subcommands: {
      add: { onMissingArgs: 'wizard' },
      list: undefined,
      remove: { onMissingArgs: 'picker', getItems: getContextItems },
      clear: { onMissingArgs: 'confirm', message: () => 'Clear all context references?' },
    },
  },
  background: {
    onMissingArgs: undefined,
    subcommands: {
      list: undefined,
      cancel: { onMissingArgs: 'picker', getItems: getBackgroundTaskItems },
      log: { onMissingArgs: 'picker', getItems: getBackgroundTaskItems },
    },
  },
  memory: {
    onMissingArgs: undefined,
    subcommands: {
      read: undefined,
      write: { onMissingArgs: 'wizard' },
    },
  },
  permissions: {
    onMissingArgs: undefined,
    subcommands: {
      // 전수 조사 후 채움
    },
  },
  plugin: {
    onMissingArgs: undefined,
    subcommands: {
      list: undefined,
      enable: { onMissingArgs: 'picker', getItems: getPluginItems },
      disable: { onMissingArgs: 'picker', getItems: getPluginItems },
    },
  },
  session: {
    onMissingArgs: undefined,
    subcommands: {
      list: undefined,
      switch: { onMissingArgs: 'picker', getItems: getSessionItems },
    },
  },
  statusline: {
    onMissingArgs: undefined,
    subcommands: {
      // 전수 조사 후 채움
    },
  },
  'user-local': {
    onMissingArgs: undefined,
    subcommands: {
      // 전수 조사 후 채움
    },
  },
  settings: {
    onMissingArgs: undefined,
    subcommands: {
      // 전수 조사 후 채움
    },
  },
};
```

`undefined`를 명시적으로 기록하는 것이 핵심 — `Record<Name, X | undefined>`이므로 key가 없으면 TypeScript 컴파일 에러.

#### Harness 체크 (이중 게이트)

```typescript
// packages/agent-cli/src/tui-interactions/__tests__/registry-coverage.test.ts
import { TUI_COMMAND_INTERACTIONS } from '../registry.js';

it('TUI interaction registry covers all registered system commands', () => {
  const registeredNames = getRegisteredCommandNames();
  const declaredNames = Object.keys(TUI_COMMAND_INTERACTIONS);
  expect(declaredNames.sort()).toEqual(registeredNames.sort());
});

it('TUI interaction registry covers all subcommands for commands that declare them', () => {
  const registeredNames = getRegisteredCommandNames();

  for (const commandName of registeredNames) {
    const command = getCommandByName(commandName);
    const entry = TUI_COMMAND_INTERACTIONS[commandName as TSystemCommandName];

    if (!command.subcommands?.length || !entry?.subcommands) continue;

    const registeredSubNames = command.subcommands.map((s) => s.name).sort();
    const declaredSubNames = Object.keys(entry.subcommands).sort();

    expect(declaredSubNames).toEqual(registeredSubNames);
  }
});
```

TypeScript는 빌드타임 게이트, 테스트는 런타임 게이트 — 양쪽으로 방어.

### `TCommandSelectionResult` 확장

```typescript
export type TCommandSelectionResult =
  | { type: 'insert'; value: string; selectedIndex?: number }
  | { type: 'submit'; value: string }
  | { type: 'open-interaction'; commandName: string; subcommandName?: string }; // ← 신규
```

`InputArea.tsx`에서 `open-interaction` 결과를 받으면:

- autocomplete 닫기
- `TUI_COMMAND_INTERACTIONS[commandName]` 또는 `.subcommands[subcommandName]`의 `onMissingArgs`에 따라
  picker / wizard / confirm 컴포넌트 마운트
- 완료 시 `onSubmit(builtCommand)` 호출로 실제 실행

## Migration Steps

1. `packages/agent-transport/src/tui/command-interaction.ts` — `TOnMissingArgsAction` + `ITuiSubcommandInteraction` + `ITuiCommandEntry` 인터페이스 정의
2. `packages/agent-transport/src/tui/flows/input-area-flow.ts` — `TCommandSelectionResult`에 `open-interaction` 추가 + `resolveCommandSelection` 교체 (서브커맨드 경로 포함)
3. `packages/agent-transport/src/tui/InputArea.tsx` — `open-interaction` 처리 + 컴포넌트 마운트 로직
4. `packages/agent-cli/src/tui-interactions/registry.ts` — `TUI_COMMAND_INTERACTIONS` 레지스트리 (최상위 + 서브커맨드 전수 선언)
5. picker 구현: `ModelPickerInteraction`, `ModePickerInteraction`, `LanguagePickerInteraction`, `ResumePickerInteraction`
6. 서브커맨드 picker: `ProviderProfilePickerInteraction`, `ContextItemPickerInteraction`, `SessionPickerInteraction`, 등
7. wizard 구현: `ResetWizard`, `ProviderAddWizard`, `MemoryWriteWizard`, `ContextAddWizard`
8. confirm 구현: `ExitConfirmInteraction`, `ClearConfirmInteraction`, `ContextClearConfirmInteraction`
9. `packages/agent-cli/src/tui-interactions/__tests__/registry-coverage.test.ts` — 커버리지 게이트 테스트 (최상위 + 서브커맨드)
10. 각 서브커맨드 전수 조사 완료 후 레지스트리 빈 `subcommands` 채우기
11. SPEC.md 업데이트: agent-transport + agent-cli

## Test Plan

- [ ] typecheck 전체 통과
- [ ] `TUI_COMMAND_INTERACTIONS`에 최상위 커맨드 key 누락 시 TypeScript 오류 발생 확인
- [ ] `subcommands` 선언된 커맨드에서 서브커맨드 key 누락 시 TypeScript 오류 발생 확인
- [ ] `/model` (args 없음) → picker 즉시 오픈 확인
- [ ] `/model claude-opus-4-7` (args 있음) → picker 없이 즉시 실행 확인
- [ ] `/provider` (args 없음) → subcommand picker 오픈 → `add` 선택 → wizard 오픈
- [ ] `/provider add` (subcommand만, 추가 args 없음) → wizard 즉시 오픈
- [ ] `/provider use myProfile` (subcommand + args 있음) → picker 없이 즉시 실행
- [ ] LLM이 `/model claude-opus-4-7` 실행 → picker 없이 즉시 실행 확인
- [ ] `/compact` (args 없음) → 즉시 실행 (picker/wizard 없음) 확인
- [ ] picker에서 ESC → autocomplete 또는 empty input으로 돌아가기 확인
- [ ] registry-coverage 테스트 — 새 커맨드 추가 후 레지스트리 미등록 시 실패 확인
- [ ] registry-coverage 테스트 — 서브커맨드 추가 후 `subcommands` 미등록 시 실패 확인

## User Execution Test Scenarios

### Scenario 1: args 없이 선택 → picker 오픈

**Steps**:

```
User: / → Change Model 선택 (Enter, args 없음)
```

**Expected**: input 삽입 없이 모델 목록 picker 즉시 오픈

**Evidence**: 사용자 직접 확인 (2026-05-17)

### Scenario 2: args 있음 → picker 없이 즉시 실행

**Steps**:

```
User: /model claude-opus-4-7 (직접 타이핑 후 Enter)
```

**Expected**: picker 없이 모델 변경 즉시 실행

**Evidence**: 사용자 직접 확인 (2026-05-17)

### Scenario 3: LLM 경로 — dialog 없이 직접 실행

**Prerequisites**: LLM이 `executeCommand("model", "claude-opus-4-7")` 호출

**Expected**: picker/wizard 없이 즉시 실행 (TUI 인터랙션 우회)

**Evidence**: 코드 검사 확인 — `resolveEnterCommandSelection`에서 `parsed.parentCommand` 있으면 `submit` 즉시 반환

### Scenario 4: 새 커맨드 추가 시 레지스트리 강제

**Steps**:

1. 새 `ISystemCommand` `foo` 추가
2. `TUI_COMMAND_INTERACTIONS` 레지스트리에 `foo` 미등록

**Expected**: TypeScript 컴파일 오류 — 빌드 실패

**Evidence**: `Record<TSystemCommandName, TAnyTuiCommandInteraction | undefined>` 타입 구조로 컴파일타임 강제 확인. registry-coverage.test.ts 3개 테스트 통과 (2026-05-17)

### Scenario 5: confirm 커맨드 (exit)

**Steps**:

```
User: / → Exit Session 선택 (Enter, args 없음)
```

**Expected**: "Exit the session? [y/n]" confirm dialog 오픈 → 확인 후 종료

**Evidence**: 사용자 직접 확인 (2026-05-17)

### Scenario 6: 서브커맨드 단계별 인터랙션 체인

**Steps**:

```
User: / → Provider Setup 선택 → subcommand picker 오픈 → add 선택 → wizard 오픈
```

**Expected**: `/provider`(args 없음) → subcommand picker → `add` 선택 → provider add wizard 오픈

**Evidence**: _(구현 완료 후 스크린샷)_

### Scenario 7: 서브커맨드만 있고 추가 args 없음 → 서브커맨드 인터랙션

**Steps**:

```
User: /provider add (Enter, 추가 args 없음)
```

**Expected**: picker 없이 provider add wizard 즉시 오픈

**Evidence**: _(구현 완료 후 채움)_

## Open Questions

1. **`undefined` vs `{ onMissingArgs: undefined }`**: Record value 타입을 `ITuiCommandEntry | undefined`로 할지, 아니면 모든 entry가 객체 형태여야 하는지? — `undefined` 허용이 더 간결하지만 의도가 덜 명시적.

2. **서브커맨드 목록이 변경될 때 레지스트리 동기화**: 서브커맨드가 동적으로 로드되는 경우(예: 플러그인이 서브커맨드 추가)는 어떻게 처리할지? — 우선 정적 선언만 지원, 동적 서브커맨드는 별도 설계.
