# 실시간 Fork/Join 규칙 개요

> 풀 체크리스트는 `CURRENT-TASKS.md` Priority 2 (Fork/Join Path-Only)에서 관리합니다. 이 문서는 Path-Only/Fork·Join 규칙의 핵심 요약과 참고 지침만 제공합니다.

## 1. 목표
- 모든 Fork/Join 처리를 동일 이벤트 흐름 내에서 원자적으로 수행 (노드 생성과 엣지 연결 동시)
- 경로(`path` 배열)만으로 부모-자식 관계를 결정, 임시 상태/보류/보정 금지
- `execution.*`, `tool.*`, `agent.*` 등 이벤트 소유권을 명확히 유지

## 2. 필수 규칙
1. **Path-Only**
   - `parentPath = path.slice(0, -1)` 동일성으로만 상위 노드 판단
   - `prevId`, `parentId` 등 별도 연결 메타 금지 (엣지로만 표현)
2. **원자성(Atomicity)**
   - 하나의 이벤트를 처리하는 동안 필요한 노드·엣지를 모두 생성/연결
   - 후속 이벤트에서 보정하거나 대기/재시도하지 않음
3. **단일 경로**
   - `thinking` 또는 `tool_result` 등 필수 연결 정보가 누락되면 즉시 오류로 중단한다(대체 경로 없음).
4. **Event Ownership**
   - `execution.*`은 ExecutionService만 emit, Tool/Agent는 해당 접두어 이벤트를 emit하지 않음
   - 모든 emit/on은 상수 기반, 하드코딩 문자열 금지

## 3. Fork/Join 시퀀스
1. `execution.assistant_message_start` → thinking 노드 생성 + 이전 user_message와 즉시 연결
2. `tool.call_start` → tool_call 노드 생성 + thinking → tool_call(executes) 엣지 생성
3. 위임된 Agent `execution.assistant_message_complete` → response 노드 생성 + thinking → response(return)
4. `tool.call_response_ready` → response → tool_response(result) 엣지 원자 생성
5. 동일 thinking 범위에서 모든 tool_response가 발생한 직후 `execution.tool_results_ready` 단 1회 발생 → tool_result 노드 생성 + tool_response[*] → tool_result(result) 엣지 연결
6. 다음 라운드 thinking 필요 시 `tool_result → thinking_round2(analyze)` 엣지 생성, thinking 직접 연결 금지

## 4. Path 주입 및 클론 규칙
- 모든 이벤트의 관계 판단은 **absolute `context.ownerPath`**만을 근거로 한다.
  - `path: string[]`는 **브릿지 계층**(예: `WorkflowSubscriberEventService`)에서 `context.ownerPath[].id`를 그대로 펼친 파생 값이다.
  - 따라서 핵심은 `path`가 아니라 **`context.ownerPath`가 full path를 갖는 것**이다.
- EventService는 **owner-bound 인스턴스**를 사용한다(단일 owner에 바인딩된 인스턴스).
  - 바인딩된 인스턴스는 emit 시 **자신의 owner를 검증**하고, `context.ownerPath`를 병합해 full path를 보장한다(누락/불일치 즉시 throw).
- Tool 실행 컨텍스트 규칙(중요):
  - `ToolExecutionContext.eventService`: **tool-call owner-bound**(마지막 세그먼트가 `{ type: 'tool', id: toolCallId }`).
  - `ToolExecutionContext.baseEventService`: **unbound base**. Tool이 다른 owner(예: agent)를 생성해야 할 때, 이 base에서 새 owner-bound 인스턴스를 만든다.
  - tool-bound EventService를 다시 agent-bound로 “겹쳐 바인딩”하는 것은 금지(소유자 충돌).

## 5. WorkflowState/Subscriber 지침
- `WorkflowState`는 expected/collected 세트 정도의 최소 상태만 유지, 큐/보류/임시 연결 금지
- Subscriber Path Map은 읽기 전용 인덱스(명시 필드 기반)로만 사용하며, 추측 상태를 저장하지 않음

## 6. 검증 기준
- 예제 26 (team)과 예제 27 (continued chat) 실행 시 Path-Only 규칙 위반 0건
- `tool_call → agent response → tool_response → tool_result → next thinking` 순서가 단일 시작 노드·단일 연결 컴포넌트를 유지
- `rg 'execution\.' packages` 등으로 ExecutionService 외부 emit 여부 상시 점검

---

세부 체크리스트나 추가 항목이 필요하면 `CURRENT-TASKS.md` Priority 2(A-1~A-4) 섹션에 직접 추가해 주세요.
