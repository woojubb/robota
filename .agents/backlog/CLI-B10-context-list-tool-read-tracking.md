---
title: 'CLI-B10: /context list가 LLM API 요청에 포함되는 모든 context를 노출하지 않음'
status: done
created: 2026-05-31
completed: 2026-05-31
priority: high
urgency: soon
area: packages/agent-framework, packages/agent-command
depends_on: []
---

## 정의: context란 무엇인가

**LLM API 요청에 포함되는 모든 것 = context.**

`getMessagesForAPI(history)` 호출 결과가 실제로 API에 전달되는 전체 context이다:

| LLM API에 들어가는 메시지 타입 | role        | 예시 내용                          |
| ------------------------------ | ----------- | ---------------------------------- |
| 시스템 프롬프트 파일           | `system`    | AGENTS.md, CLAUDE.md               |
| 사용자 메시지                  | `user`      | "파일을 읽어봐"                    |
| AI 응답 + 도구 호출            | `assistant` | 텍스트 + tool_call 블록            |
| 도구 실행 결과                 | `tool`      | 파일 내용, bash 출력, grep 결과 등 |

## 증상

현재 `/context list`는 이 중 일부만 표시한다:

```
Context references:
AGENTS.md [system, active] ~2,551 tokens
CLAUDE.md [system, active] ~34 tokens
```

**누락된 항목:**

- 대화 히스토리 전체 (user/assistant 메시지 — context token count에 포함됨)
- 도구 실행 결과 (tool messages — 파일 읽기 결과, bash 출력 등)
- prompt-reference 파일 (@ 참조 파일 — 일부 표시되나 완전하지 않음)

사용자는 `/context list`를 보고 "내 context window가 무엇으로 채워져 있는가"를 파악해야
하지만, 현재는 시스템 파일만 보인다.

## 원하는 출력 (목표 상태)

```
Context: 15,420 / 200,000 tokens (8%)
Auto compact: 84% (default)

System prompt — ~2,585 tokens (injected every turn)
  AGENTS.md [system, active] ~2,551 tokens
  CLAUDE.md [system, active] ~34 tokens

Conversation history — ~12,835 tokens across 5 turns
  User messages (5) — ~500 tokens
  Assistant messages (5) — ~1,300 tokens
  Tool results (8) — ~11,035 tokens
    read: packages/agent-core/src/index.ts — ~5,000 tokens
    read: packages/foo/bar.ts — ~800 tokens
    bash: grep "IHistoryEntry" ... — ~200 tokens
    bash: find . -name "*.ts" ... — ~150 tokens
    ... (나머지 4개)

Prompt references (@ syntax) — ~1,000 tokens
  packages/agent-sdk/docs/SPEC.md [prompt-reference, observed] ~1,000 tokens

Manually added — (none)
```

## 아키텍처 요구사항

### 1. `ICommandSessionRuntime`에 히스토리 접근 추가

현재 `ICommandSessionRuntime`에는 `getFullHistory()` 메서드가 없다.
`/context list` 구현부(`executeContextCommand`)가 대화 히스토리를 조회할 수 없다.

```typescript
// 추가 필요
export interface ICommandSessionRuntime {
  // ... existing ...
  getFullHistory(): IHistoryEntry[];
}
```

### 2. 히스토리 분석 로직 (`agent-command`)

`context-command.ts`에서 히스토리를 분석하여 context breakdown을 계산:

```typescript
function analyzeHistory(history: IHistoryEntry[]): IContextBreakdown {
  // 1. chat entries만 필터 (getMessagesForAPI와 동일한 기준)
  // 2. role별 분류: system / user / assistant / tool
  // 3. tool messages에서 toolCallId로 대응하는 assistant의 toolName 추출
  // 4. 각 메시지의 토큰 추정: content.length / CHARS_PER_TOKEN
}
```

### 3. tool message에서 도구 이름 연결

`IToolMessage`(role=tool)에는 `toolCallId`만 있고 `toolName`이 없다.
대응하는 `IAssistantMessage.toolCalls`에서 `toolCallId`로 매칭하여 `toolName` 획득.

### 4. 토큰 추정 일관성

모든 항목은 기존과 동일한 `Math.ceil(content.length / CHARS_PER_TOKEN)` 근사로 계산.
`content`가 null인 assistant 메시지는 `toolCalls` JSON 직렬화 길이로 계산.

## 구현 범위

### Phase 1: 히스토리 breakdown 표시 (이번 범위)

- `ICommandSessionRuntime.getFullHistory()` 메서드 추가
- `context-command.ts`의 `/context list` 출력에 대화 히스토리 섹션 추가
- tool results에서 toolName 연결하여 "read: 파일경로" / "bash: 명령어" 표시
- 동일 파일 tool-read 중복 시 dedup (같은 경로 → 최신 것만 표시)

### Phase 2: (별도 백로그) 히스토리 compact 인터랙션

context window가 가득 찰 때 어떤 항목을 evict/compact할지 사용자가 인터랙티브하게 선택.

## Done gate

- [x] `ICommandSessionRuntime`에 `getFullHistory(): IHistoryEntry[]` 추가
- [x] `/context list`가 system / conversation history / tool results / references 섹션을 모두 표시
- [x] tool results 섹션에 toolName + 첫 번째 인수(파일경로 또는 명령어) 표시
- [x] 각 섹션의 추정 토큰 합계가 표시됨
- [x] `pnpm --filter @robota-sdk/agent-framework test` 통과 (866/866)
- [x] `pnpm --filter @robota-sdk/agent-command test` 통과 (168/168)
- [x] `pnpm typecheck` 통과

## Implementation notes

- `analyzeHistory(history)`: IHistoryEntry[] 스캔 → toolCallMap(id→name+arg), user/assistant/tool 통계
- `formatFullContextBreakdown()`: 4-section 출력 (system / history / manual / refs)
- tool arg 60자 truncation, empty section은 "(none)" 표시
- pre-commit hook 충족: `parseToolCallArgs()` 내 `} catch { // allow-fallback: ...` 패턴
- User Execution Test Scenarios: unit test로 커버 (runtime 실행 필요 시 별도 진행)

## User Execution Test Scenarios

### Scenario 1: 도구 호출 후 context list 확인

1. `pnpm robota` 실행
2. "packages/agent-core/src/index.ts 파일을 읽어봐" 입력 (AI가 read 도구 사용)
3. `/context list` 입력
4. **기대**:
   - Tool results 섹션에 `read: packages/agent-core/src/index.ts ~N tokens` 표시
   - Conversation history 총 토큰이 system 토큰보다 큼

### Scenario 2: 여러 도구 호출 후 breakdown 정확성

1. 여러 파일 읽기와 bash 실행을 유발하는 질문 입력
2. `/context list` 입력
3. **기대**:
   - 각 tool result가 개별 줄로 표시 (toolName + 첫 인수)
   - 동일 파일 반복 읽기 시 한 번만 표시
   - 섹션별 소계 + 전체 합계가 `Context: X / Y tokens` 수치와 근사적으로 일치

### Scenario 3: 빈 세션에서 context list

1. 새 세션에서 아무것도 입력하지 않고 `/context list` 입력
2. **기대**:
   - System prompt 섹션만 표시
   - Conversation history: 0 turns 표시

## 설계 결정 (구현 전 확인 필요)

1. **`getFullHistory()` 위치**: `ICommandSessionRuntime`에 추가 vs 별도 접근 경로
2. **tool message의 firstArg 표시 길이**: 도구 명령어가 길 경우 truncate 여부
3. **섹션 없을 때 표시**: "Conversation history: (none)" vs 섹션 자체 생략
