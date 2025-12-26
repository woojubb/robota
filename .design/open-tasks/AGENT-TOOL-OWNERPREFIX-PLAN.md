# Agent/Tool Event Context Spec (최신: ownerPath-only)

> 이 문서는 Agent/Tool 계층에서 이벤트 컨텍스트를 다루는 **현재 스펙만** 정의합니다.  
> 체크리스트/우선순위 관리는 `CURRENT-TASKS.md`에서만 합니다.

## 목표
- 이벤트 관계(출처/계층/연결)는 **오직 `context.ownerPath`**로만 표현한다.
- 이벤트명은 **상수만** 사용한다 (`EXECUTION_EVENTS`, `TOOL_EVENTS`, `AGENT_EVENTS`).
- Tool이 agent를 생성하는 경우에도 **ownerPath-only 규칙으로만** 연결된다.

## 핵심 규칙
### 1) EventService는 owner-bound 인스턴스만 사용
- Agent/Tool/Execution은 각각 “자신의 owner”에 바운드된 EventService 인스턴스를 사용한다.
- emit 호출부는 **도메인 데이터(payload)만** 전달하고, 계층 정보는 context로만 전달한다.

### 2) `context.ownerPath`는 absolute full path
- `ownerPath`는 항상 absolute이며, 마지막 세그먼트는 현재 emitter의 owner를 나타낸다.
- 핸들러/구독자는 ID 파싱 없이 `ownerPath`만으로 연결을 결정한다.

예시:
```ts
// tool call scope
ownerPath = [
  { type: 'agent', id: 'agent_0' },
  { type: 'execution', id: 'exec_0' },
  { type: 'thinking', id: 'thinking_0' },
  { type: 'tool', id: 'tool_call_0' },
]
```

### 3) Tool → Agent 생성 규칙
- Tool 실행 컨텍스트에는 다음 2가지가 존재한다:
  - `eventService`: tool-call owner-bound (tool 세그먼트 포함)
  - `baseEventService`: unbound base
- Tool이 agent를 생성해야 한다면, **`baseEventService`에서 agent owner-bound 인스턴스를 새로 만든다**.
- 새 agent의 ownerPath는 “기존 tool-call ownerPath”에 `{ type: 'agent', id }`만 append하는 규칙을 따른다.

### 4) 금지사항
- 접두어 주입/변환/검증 로직 금지
- 문자열 이벤트명 하드코딩 금지
- ID 파싱/정규식/캐시/지연 연결 금지
- 대체 경로/우회 로직 금지 (단일 경로)

## 관련 스펙
- `.design/event-system/ENHANCED-EVENTSERVICE-SPECIFICATION.md`
- `.design/event-system/workflow-spec.md`

