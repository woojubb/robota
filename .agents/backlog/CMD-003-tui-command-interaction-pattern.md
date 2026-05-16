---
title: 'CMD-003: TUI command interaction pattern 선언 + 게이트 — dialog/wizard 흐름 강제'
status: backlog
created: 2026-05-16
priority: high
urgency: soon
area: packages/agent-transport, packages/agent-cli
depends_on: [CMD-001, CMD-002]
---

## Problem

현재 TUI에서 슬래시 커맨드를 선택하는 흐름이 두 가지 케이스로 동작한다.

```
# 케이스 A: subcommand가 없는 command (대부분)
User: / → Tab on /compact → input 창에 "/compact " 삽입 → 사용자 추가 입력 대기

# 케이스 B: subcommand가 있는 command
User: / → Enter on /model → input 창에 "/model " 삽입 → 사용자 모델명 직접 입력 대기
```

두 케이스 모두 **"input 창에 가입력 상태로 전환 후 사용자의 추가 입력 대기"** 흐름이다.

### 왜 문제인가

이 흐름은 다음 커맨드들에서 나쁜 UX를 만든다:

| Command         | 현재 흐름                           | 기대 흐름                         |
| --------------- | ----------------------------------- | --------------------------------- |
| `/model`        | `/model ` 삽입 → 모델명 직접 타이핑 | 즉시 모델 목록 picker 오픈 → 선택 |
| `/mode`         | `/mode ` 삽입 → 모드명 타이핑       | 즉시 모드 목록 picker 오픈 → 선택 |
| `/language`     | `/language ` 삽입 → 언어명 타이핑   | 즉시 언어 목록 picker 오픈 → 선택 |
| `/resume`       | `/resume ` 삽입 → 세션 ID 타이핑    | 즉시 세션 목록 picker 오픈 → 선택 |
| `/provider add` | `/provider add` 제출 → 텍스트 출력  | multi-step wizard로 provider 설정 |
| `/clear`        | `/clear` 제출                       | 확인 dialog 후 실행               |
| `/exit`         | `/exit` 제출                        | 확인 dialog 후 종료               |

**근본 원인**: 현재 TUI는 `resolveTabCompletion` / `resolveEnterCommandSelection` 두 함수만으로 모든 커맨드 선택 흐름을 처리한다. 커맨드별로 "어떤 UI 흐름으로 실행되어야 하는가"를 선언하는 레이어가 없다.

**두 번째 문제**: 새 커맨드가 추가될 때 TUI 인터랙션 패턴을 선언하지 않아도 아무런 경고/오류가 발생하지 않는다. 관례를 강제하는 게이트가 없다.

## Goal

1. 각 커맨드가 TUI에서 어떤 방식으로 실행되어야 하는지를 **명시적으로 선언**하는 시스템 구축
2. 선언 없이 커맨드가 등록되면 **typecheck 또는 harness에서 실패**하는 게이트 도입
3. picker / wizard / dialog 흐름을 **실제 구현** (Input 삽입 흐름 탈피)

## Design

### 인터랙션 패턴 분류

```typescript
// packages/agent-transport/src/tui/command-interaction.ts

export type TCommandInteractionPattern =
  | 'input' // 기존 흐름: input 창에 삽입 후 사용자 추가 입력 대기
  | 'immediate' // 즉시 실행: args 없이 선택만으로 submit
  | 'picker' // 인라인 목록 picker 즉시 오픈 (SelectInput)
  | 'wizard'; // 다단계 흐름 (multi-step dialog)
```

### 패턴별 적용 대상 (전수 조사 기준)

| Pattern     | Commands                                                                                                                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `immediate` | `help`, `cost`, `clear` (확인 없이), `validate-session`                                                                                                                                                      |
| `picker`    | `model`, `mode`, `language`, `resume`, `provider use`, `plugin list`                                                                                                                                         |
| `wizard`    | `provider add`, `provider test`, `reset` (확인 포함)                                                                                                                                                         |
| `input`     | `compact [instructions]`, `rename <name>`, `context add <path>`, `memory`, `agent`, `background`, `skills`, `statusline`, `user-local`, `rewind`, `exit` (→ 확인 후 실행이므로 사실상 wizard), `permissions` |

> ⚠️ 위 분류는 초안 — 실제 구현 전 사용자 확인 필요.

### 인터페이스 설계 (agent-transport 레이어)

```typescript
// packages/agent-transport/src/tui/command-interaction.ts

export interface ITuiCommandInteraction {
  /** 이 커맨드의 TUI 인터랙션 패턴 */
  pattern: TCommandInteractionPattern;
}

export interface ITuiPickerInteraction extends ITuiCommandInteraction {
  pattern: 'picker';
  /** picker에 보여줄 항목 목록을 런타임에 생성 */
  getItems(context: ITuiInteractionContext): ITuiPickerItem[];
}

export interface ITuiWizardInteraction extends ITuiCommandInteraction {
  pattern: 'wizard';
  /** wizard step 목록 (순서대로 진행) */
  steps: ITuiWizardStep[];
}

export interface ITuiImmediateInteraction extends ITuiCommandInteraction {
  pattern: 'immediate';
  /** 선택 즉시 제출할 커맨드 문자열 생성 */
  buildCommand(): string;
}
```

### 게이트 설계: 두 가지 중 하나 선택

#### Option A: TypeScript 타입 수준 강제 (추천)

```typescript
// packages/agent-cli/src/tui-interactions/index.ts

// 모든 커맨드 이름의 유니온 타입
type TSystemCommandName = 'agent' | 'background' | 'compact' | 'context' | ...;

// 모든 커맨드가 반드시 인터랙션을 선언해야 하는 Record
const TUI_COMMAND_INTERACTIONS: Record<TSystemCommandName, ITuiCommandInteraction> = {
  agent:      { pattern: 'input' },
  background: { pattern: 'input' },
  compact:    { pattern: 'input' },
  model:      { pattern: 'picker', getItems: getModelPickerItems },
  mode:       { pattern: 'picker', getItems: getModePickerItems },
  // ...
};
// → 커맨드 추가 시 이 Record에 추가하지 않으면 TypeScript 컴파일 에러 발생
```

**장점**: 빌드 타임 강제, 별도 harness 불필요  
**단점**: `TSystemCommandName` 타입을 수동으로 유지해야 함 (커맨드 추가 시 2곳 수정)

#### Option B: Harness 체크

```bash
# .agents/harness/check-tui-interactions.ts
# 등록된 모든 ISystemCommand.name과 TUI_COMMAND_INTERACTIONS의 key 집합 비교
# 누락된 커맨드가 있으면 harness:verify 실패
```

**장점**: SSOT — 커맨드 목록은 코드에서 자동 추출  
**단점**: 빌드 타임이 아닌 harness 실행 시점에 감지

#### 결론

두 방식을 조합:

- **TypeScript Record** (Option A): 즉각적인 개발자 피드백
- **Harness 체크** (Option B): CI/pre-push 게이트

### TUI 실행 흐름 변경

현재 `resolveEnterCommandSelection()` 반환값(`{ type: 'insert' | 'submit' }`)에 `'open-picker' | 'open-wizard'`를 추가:

```typescript
export type TCommandSelectionResult =
  | { type: 'insert'; value: string; selectedIndex?: number }
  | { type: 'submit'; value: string }
  | { type: 'open-interaction'; commandName: string }; // ← 신규
```

`InputArea.tsx`에서 `open-interaction` 결과를 받으면:

- autocomplete를 닫고
- `TUI_COMMAND_INTERACTIONS[commandName]`에 따라 picker/wizard 컴포넌트를 마운트

picker/wizard가 완료되면 `onSubmit(builtCommand)`를 호출해 실제 실행.

## Migration Steps

1. `packages/agent-transport/src/tui/command-interaction.ts` — 패턴 타입 + 인터페이스 정의
2. `packages/agent-transport/src/tui/flows/input-area-flow.ts` — `TCommandSelectionResult`에 `open-interaction` 추가, `resolveEnterCommandSelection` 수정
3. `packages/agent-transport/src/tui/InputArea.tsx` — `open-interaction` 처리 로직 추가
4. `packages/agent-cli/src/tui-interactions/index.ts` — `TUI_COMMAND_INTERACTIONS` 레지스트리 (모든 커맨드 전수 선언)
5. picker 구현: `ModelPickerInteraction`, `ModePickerInteraction`, `LanguagePickerInteraction`, `ResumePickerInteraction`
6. wizard 구현: `ProviderAddWizard`, `ResetWizard`
7. harness 체크: `packages/agent-transport` 스코프에 `tui-interaction-coverage` 체크 추가
8. SPEC.md 업데이트: agent-transport + agent-cli

## Test Plan

- [ ] typecheck 전체 통과
- [ ] `TUI_COMMAND_INTERACTIONS`에 누락된 커맨드가 있으면 TypeScript 오류 발생 확인
- [ ] `/model` 선택 시 picker가 즉시 열리고 Tab/Enter 없이 모델 선택 가능 확인
- [ ] `/mode` 선택 시 picker 즉시 열림 확인
- [ ] `/compact` 선택 시 기존 input 흐름 유지 확인
- [ ] picker에서 ESC 시 autocomplete로 돌아오는 cancel 동작 확인

## User Execution Test Scenarios

### Scenario 1: picker 커맨드 즉시 실행

**Steps**:

```
User: / → (autocomplete 오픈)
User: Change Model 선택 (Enter)
```

**Expected**: input 삽입 없이 모델 목록 picker가 즉시 오픈됨

**Evidence**: _(구현 완료 후 스크린샷)_

### Scenario 2: input 커맨드 기존 흐름 유지

**Steps**:

```
User: / → Compact Context 선택 (Tab)
```

**Expected**: input 창에 `/compact ` 삽입 (기존 동작 유지)

**Evidence**: _(구현 완료 후 채움)_

### Scenario 3: 새 커맨드 추가 시 강제 선언

**Steps**:

1. `ISystemCommand`에 새 커맨드 `foo` 추가
2. `TUI_COMMAND_INTERACTIONS`에 `foo` 누락

**Expected**: TypeScript 컴파일 오류 발생 — 빌드 실패

**Evidence**: _(타입 에러 스크린샷)_

### Scenario 4: wizard 커맨드 (provider add)

**Steps**:

```
User: /provider → add 선택 (Enter)
```

**Expected**: multi-step wizard 오픈 (provider type → credentials → 확인)

**Evidence**: _(구현 완료 후 스크린샷)_

## Open Questions

1. **picker UI 컴포넌트**: 기존 `MenuSelect.tsx` / `ListPicker.tsx` 재사용 가능한가, 아니면 새 컴포넌트 필요한가?
2. **wizard step 취소 흐름**: wizard 도중 ESC 시 어디로 돌아가야 하는가 (autocomplete? empty input?)
3. **`'input'` 패턴의 명시적 선언**: 모든 커맨드에 선언을 강제할지, `'input'`을 default fallback으로 허용할지?
   - 강제 선언 시: 커맨드 추가 시 한 곳 더 수정 필요 → 명시적이고 의도가 드러남
   - fallback 허용 시: 선언 누락을 알아채기 어려움 → 게이트 효과 반감
   - **추천**: 강제 선언 (fallback 없음)
4. **subcommand별 인터랙션**: `/provider current`(immediate)와 `/provider add`(wizard)는 같은 `provider` 커맨드의 subcommand — subcommand 단위 선언이 필요한가?
