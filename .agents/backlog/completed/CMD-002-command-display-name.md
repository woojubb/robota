---
title: 'CMD-002: ISystemCommand / ICommand에 displayName 추가 — TUI에 사용자 친화적 이름 표시'
status: done
created: 2026-05-16
completed: 2026-05-16
priority: medium
urgency: soon
area: packages/agent-framework, packages/agent-command, packages/agent-transport
depends_on: []
---

## Problem

현재 slash command가 TUI에서 노출될 때 `ICommand.name`(기술 ID)이 그대로 표시된다.

```
/compact     Compact conversation context
/rewind      Rewind conversation history
/background  Background task management
/statusline  Configure status line
```

`compact`, `rewind`, `background`, `statusline`은 개발자용 ID이지 사용자 친화적 이름이 아니다. 예를 들어 `/background`보다 "Background Tasks", `/compact`보다 "Compact Context"가 훨씬 직관적이다.

또한 Command가 permission 요청이나 실행 로그 등 다른 UI 요소에 노출될 때도 기술 ID 그대로 나온다.

## Goal

`ICommand` 및 `ISystemCommand`에 `displayName?: string` 필드를 추가하여:

- TUI 자동완성(SlashAutocomplete)에서 `displayName`이 있으면 기술 ID 대신 표시
- `/help` command 목록에서도 `displayName` 사용
- Permission prompt(CMD-001 구현 시) 등 사용자 대면 UI에서 일관되게 `displayName` 사용
- 슬래시 입력 자체(`/compact`)는 변경 없음 — 기술 ID로 실행, 표시만 friendly name

## Design

### 추천 레이어: agent-framework + agent-command

**근거:**

| 변경 위치                                                               | 이유                                                |
| ----------------------------------------------------------------------- | --------------------------------------------------- |
| `agent-framework/src/command-api/types.ts` (`ICommand`)                 | TUI가 소비하는 인터페이스 — `displayName` 필드 추가 |
| `agent-framework/src/command-api/contracts.ts` (`ISystemCommand`)       | command 정의 계약 — `displayName` 필드 추가         |
| `agent-framework/src/command-api/host-context.ts` (`ICommandListEntry`) | `listCommands()` 반환 타입 — `displayName` 추가     |
| `agent-command/src/*/`                                                  | 20개 command 각각 `displayName` 선언                |
| `agent-transport/src/tui/SlashAutocomplete.tsx`                         | `cmd.displayName ?? cmd.name` 사용                  |

**transport 레이어(SlashAutocomplete)는 소비자** — 필드 추가는 framework+command에서 하고, TUI는 렌더링 방식만 변경.

### 구체적 변경

#### 1. `ICommand` 인터페이스 확장 (agent-framework)

```typescript
// packages/agent-framework/src/command-api/types.ts

export interface ICommand {
  /** Command name without slash (e.g., "compact") — used for invocation */
  name: string;

  /**
   * User-friendly display name shown in TUI (e.g., "Compact Context").
   * Falls back to `name` if not set.
   */
  displayName?: string;

  /** Short description shown in autocomplete */
  description: string;
  // ... 나머지 필드 유지
}
```

#### 2. `ISystemCommand` 인터페이스 확장 (agent-framework)

```typescript
// packages/agent-framework/src/command-api/contracts.ts

export interface ISystemCommand {
  name: string;
  displayName?: string; // ← 추가
  description: string;
  // ... 나머지 필드 유지
}
```

#### 3. `ICommandListEntry` 확장 (agent-framework)

```typescript
// packages/agent-framework/src/command-api/host-context.ts

export interface ICommandListEntry {
  name: string;
  displayName?: string; // ← 추가
  description: string;
}
```

#### 4. TUI SlashAutocomplete 렌더링 변경 (agent-transport)

```typescript
// packages/agent-transport/src/tui/SlashAutocomplete.tsx

// 변경 전
const namePart = capName(cmd.name, nameColWidth);
const text = `${indicator}/${namePart}  ${cmd.description ?? ''}`;

// 변경 후
const displayLabel = cmd.displayName ?? cmd.name;
const namePart = capName(displayLabel, nameColWidth);
const text = `${indicator}/${namePart}  ${cmd.description ?? ''}`;
```

> **중요**: Tab 삽입 시 입력창에 들어가는 값은 `cmd.name`(기술 ID)을 유지 — `displayName`은 표시 전용.

#### 5. 각 command displayName 선언 (agent-command)

전수 조사 후 선언. 초안:

| Command ID    | 제안 displayName   | 비고               |
| ------------- | ------------------ | ------------------ |
| `agent`       | Agent Jobs         | 에이전트 작업 관리 |
| `background`  | Background Tasks   | 백그라운드 태스크  |
| `compact`     | Compact Context    | 맥락 압축          |
| `context`     | Context References | 참조 파일          |
| `exit`        | Exit Session       | 세션 종료          |
| `help`        | Help               | —                  |
| `language`    | Language           | 언어 설정          |
| `memory`      | Memory             | 메모리 읽기/쓰기   |
| `mode`        | Interaction Mode   | 대화 모드          |
| `model`       | Change Model       | 모델 변경          |
| `permissions` | Permissions        | 권한 설정          |
| `plugin`      | Plugins            | 플러그인 관리      |
| `provider`    | Provider Setup     | AI 공급자 설정     |
| `reset`       | Reset Session      | 세션 초기화        |
| `rewind`      | Rewind History     | 히스토리 되돌리기  |
| `session`     | Sessions           | 세션 목록/전환     |
| `settings`    | Settings           | 설정               |
| `skills`      | Skills             | 스킬 목록          |
| `statusline`  | Status Line        | 상태바 설정        |
| `user-local`  | User Config        | 사용자 로컬 설정   |

> ⚠️ 위 이름들은 초안 — 실제 구현 전 사용자 확인 필요.

### 렌더링 우선순위

```
표시 이름 = displayName ?? name
입력 자동완성(Tab 삽입) = name  (기술 ID 그대로)
실행 라우팅 = name  (변경 없음)
```

## Migration Steps

1. `agent-framework/src/command-api/types.ts` — `ICommand.displayName?: string` 추가
2. `agent-framework/src/command-api/contracts.ts` — `ISystemCommand.displayName?: string` 추가
3. `agent-framework/src/command-api/host-context.ts` — `ICommandListEntry.displayName?: string` 추가
4. `agent-framework` 내 `ICommand` 생성 코드에서 `displayName` 전달 로직 추가 (SystemCommandExecutor → listCommands 등)
5. `agent-command/src/*/` — 20개 command 각각 `displayName` 선언
6. `agent-transport/src/tui/SlashAutocomplete.tsx` — `displayName ?? name` 렌더링
7. `/help` command 출력에 `displayName` 반영
8. SPEC.md 업데이트: agent-framework + agent-command + agent-transport

## Test Plan

- [ ] typecheck 전체 통과
- [ ] `ICommand.displayName` 없을 때 `name` fallback 동작 테스트
- [ ] SlashAutocomplete에서 `displayName` 표시, Tab 입력 시 `name`(ID) 삽입 테스트
- [ ] 20개 command 각각 `displayName` 설정 후 `/help` 목록 정상 표시 확인

## User Execution Test Scenarios

### Scenario 1: TUI 자동완성에 displayName 표시

**Steps**:

```
User: / (슬래시 입력 → 자동완성 팝업 오픈)
```

**Expected**: 팝업에 "Compact Context", "Background Tasks" 등 friendly name이 표시됨

**Evidence**: _(구현 완료 후 스크린샷)_

### Scenario 2: Tab 삽입 시 기술 ID 유지

**Steps**:

```
User: /comp → Tab
```

**Expected**: 입력창에 `/compact`(기술 ID)가 삽입됨 (displayName이 아닌 name)

**Evidence**: _(구현 완료 후 채움)_
