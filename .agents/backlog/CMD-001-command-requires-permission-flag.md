---
title: 'CMD-001: ISystemCommand에 requiresPermission 옵션 추가 — command 실행 권한 정책 선언'
status: backlog
created: 2026-05-16
priority: medium
urgency: soon
area: packages/agent-framework, packages/agent-command
depends_on: []
---

## Problem

현재 slash command 실행 시 권한(permission) 확인이 발생하는 지점이 두 가지 있다.

1. **Tool-level 권한**: command 내부에서 사용하는 도구(Bash, Edit, Write 등)가 PermissionEnforcer를 통해 사용자에게 승인 요청
2. **Effect-level 확인**: command가 `TCommandEffect`를 반환할 때, TUI가 일부 effect에 대해 ConfirmPrompt를 표시 (예: `model-change-requested` → ConfirmPrompt)

그런데 `ISystemCommand`에는 "이 command 실행 자체가 권한 확인 없이 실행되어야 하는가"를 선언하는 필드가 없다.

결과적으로:

- 어떤 command가 내부적으로 tool 권한을 유발하더라도, 개발자가 해당 command에 "이 command는 권한 없이 실행돼도 된다"는 의도를 표현할 방법이 없다
- `/rewind`, `/resume`, `/agent` 같이 context에 따라 권한 요청 없이 실행되어야 하는 command들이 있는데, 이를 per-command 정책으로 선언할 수 없다
- 어떤 command가 "위험한지" 아닌지는 `safety` 필드로 일부 표현되지만, "실행 전 확인 필요 여부"는 별개의 개념이다

## Goal

`ISystemCommand` 인터페이스에 `requiresPermission?: boolean` 필드를 추가하여, command별로 "실행 시 권한/확인 요청이 필요한가"를 명시적으로 선언할 수 있게 한다.

- `requiresPermission: false` → 해당 command는 권한 확인 없이 즉시 실행
- `requiresPermission: true` (명시) → 실행 전 사용자 확인 필요
- `requiresPermission` 미설정 (undefined) → 기존 동작 유지 (safety + context에서 추론)

## Design

### 추천 레이어: agent-framework

**근거:**

| 레이어              | 역할                                 | 이 기능과의 관계                                  |
| ------------------- | ------------------------------------ | ------------------------------------------------- |
| agent-framework     | command 실행 CONTRACT 정의           | ✅ `ISystemCommand` 인터페이스 소유자             |
| agent-framework     | skill-router / SystemCommandExecutor | ✅ 실행 전 정책 검사 위치                         |
| agent-command       | 개별 command 구현체                  | ✅ 각 command가 `requiresPermission` 선언         |
| agent-transport/tui | TUI-level effect 처리                | 🔸 effect-level 확인은 여기지만, 선언은 framework |
| agent-cli           | transport 소비자                     | ❌ 정책 선언 위치 아님                            |

**이유:**

- `ISystemCommand`의 계약(contract)은 `agent-framework/src/command-api/contracts.ts`가 SSOT
- 실행 정책(`requiresPermission`)은 transport-agnostic한 프레임워크 수준 개념
- agent-command는 선언만 하고, 집행(enforcement)은 framework의 skill-router가 담당

### 구체적 변경

#### 1. `ISystemCommand` 인터페이스 확장 (agent-framework)

```typescript
// packages/agent-framework/src/command-api/contracts.ts

export interface ISystemCommand {
  name: string;
  description: string;
  modelInvocable?: boolean;
  userInvocable?: boolean;
  argumentHint?: string;
  safety?: TCapabilitySafety;
  subcommands?: readonly ICommand[];
  lifecycle?: TSystemCommandLifecycle;

  /**
   * Whether executing this command requires explicit user permission/confirmation.
   * - false: command runs immediately without any approval gate
   * - true: user confirmation is required before execution
   * - undefined (default): derived from safety + invocation source
   *   ('read-only' → false, 'write'/'process'/'network'/'background-agent' → true)
   */
  requiresPermission?: boolean;

  execute(context: ICommandHostContext, args: string): Promise<ICommandResult> | ICommandResult;
}
```

#### 2. 집행 위치: `SystemCommandExecutor` (agent-framework)

```typescript
// packages/agent-framework/src/commands/system-command-executor.ts

private resolveRequiresPermission(command: ISystemCommand): boolean {
  if (command.requiresPermission !== undefined) return command.requiresPermission;
  // 기본값: read-only는 false, 나머지는 true
  return command.safety !== 'read-only';
}

async executeCommand(
  command: ISystemCommand,
  session: ICommandHostContext,
  args: string,
): Promise<ICommandResult> {
  if (this.resolveRequiresPermission(command)) {
    // 향후: 권한 확인 로직 주입 (현재는 pass-through)
  }
  return command.execute(session, args);
}
```

> **Note**: 현재는 permission gate가 실제로 user를 막지 않더라도, 필드가 있어야 향후 TUI/headless가 이를 활용할 수 있다. 우선 선언적 메타데이터로 시작하고, enforcement는 단계적으로 추가한다.

#### 3. 각 command 모듈 선언 (agent-command)

전수 조사 후 각 command에 명시. 사용자 제시 예시:

| Command        | 제안값                       | 근거                                          |
| -------------- | ---------------------------- | --------------------------------------------- |
| `/rewind`      | `requiresPermission: false`  | 대화 이력 되돌리기 — 사용자가 명시적으로 입력 |
| `/resume`      | `requiresPermission: false`  | 세션/작업 재개 — 실행 흐름 제어               |
| `/agent`       | `requiresPermission: false`  | 에이전트 관리 — 명시적 사용자 액션            |
| `/help`        | `requiresPermission: false`  | read-only, 항상 안전                          |
| `/context`     | `requiresPermission: false`  | read-only                                     |
| `/statusline`  | `requiresPermission: false`  | UI 설정 변경만                                |
| `/compact`     | `requiresPermission: false`  | 맥락 압축 — 주로 자동화                       |
| `/model`       | `requiresPermission: true`   | 모델 변경 → 현재 TUI ConfirmPrompt 존재       |
| `/permissions` | `requiresPermission: true`   | 보안 설정 변경 → 항상 확인 필요               |
| `/reset`       | `requiresPermission: true`   | 파괴적 조작                                   |
| `/exit`        | `requiresPermission: true`   | 세션 종료                                     |
| `/background`  | _(전수 조사 필요)_           | —                                             |
| `/session`     | _(전수 조사 필요)_           | —                                             |
| ...            | _(20개 전체 전수 조사 필요)_ | —                                             |

**⚠️ 전수 조사 주의사항**: subcommand별로 다를 수 있음. 예) `/agent list` vs `/agent spawn`은 같은 command module에서 다른 requiresPermission을 가질 수 있음.

### 미결 설계 결정 (사용자 확인 필요)

1. **enforcement 범위**: `requiresPermission: false`가 의미하는 것이 정확히 무엇인가?
   - A. command 실행 전 TUI-level 확인 창 미표시 (effect 기준)
   - B. command 내부에서 사용하는 tool의 permission도 일시 bypass
   - C. A만 (추천 — tool 권한은 별도 관심사)

2. **subcommand 단위 선언**: `/agent list`(safe)와 `/agent spawn`(risky)처럼 subcommand별로 다른 정책이 필요한 경우, `ICommand` 인터페이스에도 동일 필드가 필요한가?

3. **model-invocable과의 관계**: `modelInvocable: true`인 command가 `requiresPermission: false`이면, AI가 확인 없이 자동 실행 가능. 이것이 의도된 동작인가?

## Migration Steps

1. `agent-framework/src/command-api/contracts.ts` — `ISystemCommand`에 `requiresPermission?: boolean` 추가
2. (선택적) `SystemCommandExecutor` — `resolveRequiresPermission()` 헬퍼 추가
3. `agent-command/src/*/` — 20개 command 전수 조사 후 각각 선언
4. 향후 단계: TUI layer(App.tsx 또는 hooks)에서 이 값을 읽어 effect 처리 시 ConfirmPrompt 스킵
5. SPEC.md 업데이트: agent-framework + agent-command

## Test Plan

- [ ] `ISystemCommand.requiresPermission` 타입 정의 추가 후 전체 typecheck 통과
- [ ] 각 command 모듈에 `requiresPermission` 선언 추가 후 기존 unit test 유지
- [ ] `resolveRequiresPermission()` 헬퍼 단위 테스트 (true/false/undefined 각 케이스)
- [ ] 전수 조사 결과 반영 후 새 command 테스트 추가

## User Execution Test Scenarios

### Scenario 1: requiresPermission: false인 command는 확인 없이 즉시 실행

**Prerequisites**: `requiresPermission: false`로 선언된 command (예: /rewind)

**Steps**:

```
User: /rewind
```

**Expected**: 확인 프롬프트 없이 즉시 실행됨

**Evidence**: _(구현 완료 후 채움)_

### Scenario 2: requiresPermission: true인 command는 확인 후 실행

**Prerequisites**: `requiresPermission: true`로 선언된 command (예: /permissions bypassPermissions)

**Steps**:

```
User: /permissions bypassPermissions
```

**Expected**: 확인 프롬프트 표시 → 사용자 승인 후 실행

**Evidence**: _(구현 완료 후 채움)_

### Scenario 3: 20개 command 전수 조사 결과 선언

**Steps**: 각 command 실행 후 `requiresPermission` 선언 값과 실제 동작이 일치하는지 확인

**Evidence**: _(전수 조사 완료 후 표로 채움)_
