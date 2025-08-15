### 실시간 Fork/Join 규칙서 (무지연·무임시·원자적 생성)

목표
- 실시간 단계별 이벤트 처리로 그래프를 정확히 생성한다.
- 노드 생성과 엣지 연결은 항상 같은 이벤트에서 원자적으로 동시에 수행한다.
- 임시 처리(보류/큐/재연결/후속보정), 타이머 대기, 하드코딩 이벤트명은 모두 금지한다.
- 다중/중첩 fork가 가능하며, 각 fork 단위로 여러 번 join이 일어나도 항상 즉시·원자적으로 처리한다.

용어
- Thinking: execution.assistant_message_start
- Response: execution.assistant_message_complete
- Tool Call: tool.call_start
- Tool Response: tool.call_response_ready (delegated agent의 Response 반영)
- Tool Result: execution.tool_results_ready 발생 시 집계 노드

이벤트 페이로드 최소 계약 (Mandatory Fields - Path-Only)
- 핸들러는 오직 path만으로 노드·엣지 연결을 결정한다.
- 모든 관련 이벤트는 다음 공통 필드를 포함한다.
  - path: string[] (경로; 불변 확장, 위임/포크 시 tail 추가)
- 다음 필드들은 이벤트에 있을 수 있으나, 본 설계에서 핸들러는 사용하지 않는다(무시 대상):
  - groupId(thinkingId), branchId(toolCallId), responseExecutionId 등(서비스/디버깅/통계 용도 가능)

Path 주입 보증 및 클론 요건 (Required)
- 이벤트 발행자는 항상 `path`를 자동 주입해야 한다. 주입 책임은 이벤트 서비스(Event Service)에 있다.
- 클론/위임 시에는 새로운 tail 세그먼트를 문자열로 필수 전달해야 한다(required). 예: `clone({ tail: newSegment })`
- 이벤트 서비스는 emit 이전에 다음을 검증한다.
  - path 존재 여부 (없으면 즉시 에러 throw, emit 금지, 흐름 중단)
  - tail 세그먼트 유효성 (클론 시 미제공 또는 빈 값이면 즉시 에러 throw, emit 금지, 흐름 중단)
- 위 규칙은 모든 이벤트에 동일하게 적용된다. 특정 이벤트에 대한 예외는 허용되지 않는다.

이벤트별 필수 필드 요약 (Path-Only 기준)
- execution.assistant_message_start (Thinking 시작)
  - path (tail에 thinking 세그먼트 추가)
- tool.call_start
  - path (tail에 toolCallId 세그먼트 추가)
- execution.assistant_message_complete (Delegated/Owner Agent Response)
  - path (tail에 agent execution 세그먼트 추가)
- tool.call_response_ready
  - path = [root, thinkingId, delegatedAgentExecutionId] (tail 필수)
  - tail 누락/불명확 시 emit 금지(즉시 throw)
- execution.tool_results_ready (단 1회/그룹)
  - path (thinking 스코프의 경로)

Path-First 정책과 메타데이터 최소화
- 원칙: 그래프 상의 위계·부모·스코프 결정은 오직 path(계층 배열)로 유도한다.
- 원칙: 용어는 단순히 path로 통일한다(“execution” 의미 없음).
- 이벤트 서비스는 재-클론(위임/포크)될 때마다 path를 불변 배열로 확장한다.
- 핸들러는 노드 생성/엣지 연결 시, 별도 임시 상태 없이 path로 다음을 유도한다.
  - parentPath = path.slice(0, -1)
  - 동일 부모 판정: A.parentPath와 B.parentPath 배열 요소/순서가 완전히 동일할 때
  - 분기/합류 표기: 별도 id 사용 금지. 오직 path의 계층 구조로만 판단한다.
  - 상위 흐름(upper flow)의 “다음 노드” 판단: parentPath 단위의 계층 이동 규칙으로만 유도 (tool_result는 상위 흐름의 다음 단계)
- 메타데이터 최소화 규칙:
  - 노드 구성에 꼭 필요한 값만 보관: id, type, timestamp, label 정도
  - prev/parent 등 연결 정보는 노드 data에 중복 보관하지 않고, 엣지로만 표현한다(생성 시 동시 연결).
  - branchId/groupId/responseExecutionId는 경로에서 유도 가능하므로, 핸들러는 사용하지 않는다(Path-Only 원칙).
  - 서비스 레이어(ExecutionService 등)는 내부 집계/모니터링 목적으로 부가 메타데이터를 유지할 수 있으나, 연결 판단은 path로만 수행된다.

핵심 불변식 (Invariants)
- 이벤트 1건 처리 시, 해당 이벤트로 인해 생성되는 노드와 엣지는 즉시(동일 처리 흐름 내) 함께 생성된다.
  - “노드만 먼저 만들고 엣지는 나중에”를 금지한다.
- 임시/보류/중간 연결 금지. 후속 이벤트로 엣지를 보완 연결하는 시도 금지.
- 이벤트명은 반드시 선언형 상수로 사용(소유자 접두어 준수). 하드코딩 문자열 금지.
- 단일 시작 노드, 단일 연결 컴포넌트 유지.
- tool_call은 단일 out(creates)만 갖는다.
- agent_thinking은 End Node가 될 수 없다(반드시 다음 단계로 이어짐).

ID 규칙 (Path-derived)
- ID는 path로부터 직접 유도하며 도메인 규칙/접두사 금지:
  - 모든 이벤트성 노드의 id = 해당 이벤트의 path 마지막 세그먼트(= path.tail)
  - 부모-자식 관계는 parentPath(= path.slice(0, -1)) 동일성으로만 판정
  - 'response_', 'tool_call_' 등의 문자열 접두사 사용 금지
- groupId 규칙:
  - 각 thinking(또는 fork 단위)마다 유일한 groupId를 부여한다.
  - 중첩 fork는 각자 고유 groupId를 갖는다(트리 구조).
  - join은 groupId 단위로 독립 수행되며, 상위 group으로 전파되지 않는다(필요 시 상위에서 별도 join 이벤트가 발생해야 상위 join이 실행됨).

실시간 Fork 알고리즘 (n-way, 중첩 허용)
- tool.call_start 수신 즉시:
  - tool_call 노드 생성 + thinking → tool_call(executes) 엣지 동시 생성

Delegated Agent Response 처리
- execution.assistant_message_complete 수신 즉시:
  - response 노드 생성 + thinking → response(return) 엣지 동시 생성

- 실시간 Join 알고리즘 (No-Barrier, Path-Only, 즉시·원자성)
- tool.call_response_ready 수신 즉시:
  - response 노드 유도: response 노드 id = path.tail(= delegatedAgentExecutionId)
  - tool_response 노드 생성 + response → tool_response(result) 엣지 동시 생성
- ExecutionService는 동일 thinking 라운드에 대해 모든 tool.call_response_ready emit 직후, 단 1회 `execution.tool_results_ready`를 즉시 발생한다(카운팅/대기/재확인 금지).
- execution.tool_results_ready 수신 즉시:
  - tool_result 노드 생성
  - 현재까지 생성된 노드 중 node.path.slice(0, -1) === thinkingPath 인 모든 tool_response를 수집하여 tool_response[*] → tool_result(result) 엣지를 동시 생성
  - 필요 시 tool_result → (다음 라운드)thinking(analyze) 엣지를 동시 생성 (thinking 직접 연결 금지 원칙 유지)

중첩 Fork/Join (Multi-level)
- 각 fork 단위는 고유 groupId를 갖고 독립적으로 join된다.
- 하위 group의 join 완성은 상위 group의 join과 별개다.
  - 상위 group의 join은 상위 group의 collected === expected 순간에만 수행된다.
- 결과적으로 동일 라운드 안에서도 여러 개의 join이 “여러 번” 일어날 수 있다.
  - 모든 join은 해당 이벤트 처리 흐름 내에서 즉시·원자적으로 완료되어야 한다.

금지 항목
- 임시 엣지/임시 노드/보류 큐/재시도/타임아웃 기반 처리
- 하드코딩 이벤트 문자열
- 노드만 먼저 생성하고 엣지 연결을 나중에 보완하는 패턴

검증 기준 (Validation Rules)
- 단일 시작 노드(1)
- 단일 연결 컴포넌트
- tool_call_response → tool_result → (analyze) → agent_0_thinking(round2) 순서 보장
- tool_call 단일 Out
- agent_thinking End Node 0
- 모든 노드·엣지 타임스탬프 존재
- 모든 엣지 소스/타깃 유효

적용 지침 (코드 반영 요점)
- WorkflowState: 조인 카운팅/배리어 상태 금지. 핸들러 로직은 상태 없이 path만 사용.
- AgentEventHandler: path 기반으로 thinking → response(return) 엣지 동시 생성. 매핑/보조 상태 불사용.
- ToolEventHandler: path.tail로 response 노드 유도 → response → tool_response(result) 엣지 동시 생성. 매핑/보조 상태 불사용.
- ExecutionService: 모든 이벤트에 path 자동 주입, 클론 시 tail(required) 검증. 동일 thinking 내 도구 응답 emit 직후 1회 `execution.tool_results_ready` 즉시 emit.

경로(Path)와 상위 흐름(Upper Flow)
- 모든 이벤트에는 경로(executionPath)를 포함하고, 포크/중첩 시 경로는 불변으로 확장된다.
 - 모든 이벤트에는 경로(path)를 포함하고, 포크/중첩 시 경로는 불변으로 확장된다.
- groupId/branchId는 경로에서 유도 가능하며, 핸들러는 별도 필드에 의존하지 않는다.
- 다수 포크의 조인 대상은 “원래 흐름의 기존 노드”가 아니라, 새롭게 생성되는 tool_result 노드다.
  - tool_result는 상위 흐름의 다음 노드로 간주되며, thinking으로의 직접 연결은 만들지 않는다.
  - 다음 단계가 필요할 경우, tool_result → (다음)thinking(analyze)로 상위 흐름을 진행한다.
   - 경로 기반 유도 규칙(실무 적용):
    - Parent 찾기: 동일 path 내 직전 단계 노드가 prev, 상위 흐름 전이 시 parentPath 기준 상위 스코프로 이동
    - Fork 표기: path tail이 toolCallId 세그먼트를 가지면 해당 분기(branchId)
    - Join 표기: 동일 thinking 경로 하위에서 expected/collected가 충족되면 상위 path로 복귀하여 tool_result 생성

작업 목록 (Refactor Checklist)
- [ ] 핸들러에서 groupId/branchId/responseExecutionId 사용 제거 (path-only로 전환)
- [ ] `packages/workflow/src/services/workflow-state.ts`에서 다음 상태·API 제거
    - [ ] toolCallByAgentExecution (set/get)
    - [ ] agentResponseByToolCall (set/get)
    - [ ] lastAssistantStart (set/get)
    - [ ] lastResponseByThinking (set/get)
    - [ ] userAnchorByThinking (set/get)
    - [ ] rootUserMessageByRoot (set/get)
    - [ ] 기타 보류/임시 큐(pendingToolResponsesByToolCall 등) 전부 제거
- [ ] `WorkflowState`에 최소 조인 배리어만 남기기
    - [ ] expectedBranchesByGroupPath: Map<string, Set<string>>
    - [ ] collectedBranchesByGroupPath: Map<string, Set<string>>
    - [ ] toolResponseIdsByGroupPath: Map<string, string[]>
- [ ] `AgentEventHandler`를 path-only로 수정 (thinking → response(return) 즉시 연결, 추가 인덱스 금지)
- [ ] `ToolEventHandler`를 path-only로 수정 (path tail로 response 유도, response → tool_response(result) 즉시 연결)
- [ ] `ExecutionEventHandler`에서 tool_results_ready 처리 시 tool_result 생성 및 tool_response* → tool_result(result) 즉시 연결, 필요 시 tool_result → next thinking(analyze)
- [ ] `packages/agents/src/services/execution-service.ts`에 path 자동 주입/검증 추가
    - [ ] 모든 emit 전에 path 존재 검증
    - [ ] clone/위임 시 tail(required) 미제공 시 에러 throw 및 흐름 중단
    - [ ] expected/collected를 groupPath 기준으로 관리하고 조건 충족 시점에 1회 tool_results_ready emit
- [ ] 하드코딩 이벤트명 여부 재점검(모두 상수로 교체)
- [ ] 예제 26 및 중첩 fork 케이스 검증 스크립트 통과

예시 시퀀스(2갈래 포크)
1) Agent 1 response 생성 → Tool Response(for Agent 1) 즉시 생성 및 Agent 1 response에 result 엣지로 연결
2) Agent 2 response 생성 → Tool Response(for Agent 2) 즉시 생성 및 Agent 2 response에 result 엣지로 연결
3) 두 Tool Response 완료 시점(=collected===expected): tool_results_ready 1회 발생 → Tool Result 노드 생성
4) Tool Result는 두 Tool Response로부터 result 엣지로 연결됨
5) Tool Result는 상위 흐름의 다음 노드로 간주되며, 필요한 경우 Tool Result → (다음 라운드)Thinking(analyze)로 진행

소유권(Ownership) 및 이벤트 상수
- execution.* 이벤트의 소유자는 ExecutionService이며, 해당 모듈에서 상수를 export 하고 핸들러는 import 하여 사용한다.
- tool.* 이벤트의 소유자는 Tool 구현이며, 동일 원칙을 따른다.
- 하드코딩된 문자열 이벤트명 사용 금지(모든 emit/on은 상수 기반으로만).

원자성(Atomicity) 강제
- 단일 이벤트 처리 루틴 안에서 노드 생성과 엣지 연결이 동시에 수행되어야 한다.
- 후속 이벤트를 기다려 보완 연결하는 패턴 금지(임시/대기/타임아웃/리트라이 불가).

일관성 점검 체크리스트 (Self-Consistency)
- 접두어/소유권 규칙과 충돌 없음 (execution.*, tool.*)
- join은 groupId 단위로 When-All 조건(cllct == exp)에 즉시 1회 트리거됨
- tool_result는 상위 흐름의 다음 노드로만 간주되며 thinking과 직접 연결하지 않음
- ID 규칙은 결정적이며 상관관계 인덱스로 직접 조회 가능(추측/후보정 불필요)
- 중첩 포크는 독립 groupId로 조인되며 path를 통해 상위 위계 추적 가능
 - 모든 이벤트는 path를 포함해야 하며, 이벤트 서비스가 미주입/무효 tail을 검증해 즉시 실패시킨다(emit 금지, 흐름 중단)

검증 결과 (Feasibility Review)
- Path-Only 전환: 구현 가능(높음). 전제는 모든 이벤트에 path 자동 주입 및 클론 시 tail 필수 제공.
- Response ↔ Tool Response 연결: path tail의 agent 실행 세그먼트를 변환해 결정적 ID로 유도 가능.
- Join 배리어: group path(prefix) 기반 expected/collected Set으로 즉시 1회 트리거 가능.
- Tool Result를 상위 흐름의 다음 노드로 간주: 규칙 충돌 없음(3-way out 방지 유지).
- 원자성: 각 이벤트 처리 루틴 내에서 노드+엣지 동시 생성으로 보장.
- 메타데이터 최소화: 핸들러는 path만 사용. 기타 메타는 비사용(서비스/통계용 보조 데이터).

비고

## 구현 정합성 개선 계획 (2025-08-14)

본 섹션은 규칙 위반 가능 지점을 제거하고 완전한 path-only/원자성/no-fallback을 보장하기 위한 구체적인 수정 방법을 명시한다. 아래 항목은 모두 적용되어야 하며, 적용 후 예제 26 검증 스크립트를 통과해야 한다.

1) AgentEventHandler: 응답 시 보정 금지 (no-fallback)
- 현재: `execution.assistant_message_complete` 처리에서 path상 thinking 노드가 없을 경우 즉시 생성·연결하는 보정 로직이 있을 수 있음.
- 수정: 보정 로직을 제거한다. thinking 노드는 오직 `execution.assistant_message_start`에서만 생성할 수 있다. 응답 시 path의 thinking 세그먼트가 가리키는 노드가 존재하지 않으면 즉시 에러로 중단한다(원자성·fail-fast).

2) ToolEventHandler: tool.call_response_ready의 path.tail 사용 강제
- 원칙: 본 문서의 규칙(38~41행)대로 `tool.call_response_ready` 이벤트의 `path.tail`은 반드시 위임된 에이전트의 응답 실행 ID(delegatedAgentExecutionId)여야 한다.
- 현재: parentExecutionId(=tool_callId)를 이용하여 응답을 탐색하는 우회가 남아 있을 수 있음.
- 수정: 핸들러는 `path.tail`을 응답 노드 ID로 직접 사용한다. `responseId = path[path.length-1]`로 결정하고, 즉시 `response → tool_response(result)` 엣지를 원자적으로 생성한다. parentExecutionId 기반 추정/매핑은 모두 제거한다.

3) WorkflowState 슬림화(상태 의존 제거)
- 금지 목록에 따라 다음 상태/API를 제거한다(135~149행 항목 준수):
  - toolCallByAgentExecution (set/get)
  - agentResponseByToolCall (set/get)
  - lastAssistantStart (set/get)
  - lastResponseByThinking (set/get)
  - userAnchorByThinking (set/get)
  - rootUserMessageByRoot (set/get)
- 조인 관련 최소 구조만 유지: expectedBranchesByGroupPath, collectedBranchesByGroupPath, toolResponseIdsByGroupPath.

4) 이벤트 상수화 (하드코딩 문자열 사용 금지)
- 소유자 모듈에서 선언한 상수만 사용한다. 예: `EXECUTION_EVENTS`, `TOOL_EVENTS`, `AGENT_EVENTS`.
- 핸들러 내 모든 문자열 비교(`'execution.assistant_message_start'`, `'execution.assistant_message_complete'`, `'tool.call_response_ready'` 등)를 상수 import 사용으로 교체한다.

5) prevId 제거
- team 도메인 이벤트 payload에 남아있는 `prevId` 필드를 모두 제거한다. 연결 판단은 오직 path와 생성 시점의 원자적 엣지로 표현한다.

6) ExecutionService: path 자동 주입·검증 강화
- 모든 emit 전에 path 존재를 검증하고, 클론/위임 시 tail(required) 누락 시 즉시 throw하여 emit을 금지한다(24~29행 규칙 엄격 준수).
- 동일 thinking 스코프에서 모든 `tool.call_response_ready`가 발생한 직후, 단 1회 `execution.tool_results_ready`를 즉시 emit한다(대기/재확인/카운팅 큐 금지). expected/collected는 groupPath 기반 Set으로만 관리한다(86~95행, 155~156행).

적용 후 기대 효과
- 순수 path-only로 부모/응답/조인 관계를 결정하며, 임시 보정/추론/대기는 완전히 제거된다.
- 각 이벤트 처리 내에서 노드와 엣지가 동시에(원자적으로) 생성되어, 검증 스크립트의 모든 규칙(단일 시작 노드, 단일 연결 컴포넌트, 응답→tool_response→tool_result→다음 thinking 순서, timestamp/순차성/타입 제약)을 일관되게 만족한다.
- 본 규칙은 리팩토링이 아니라 “실시간·원자적 포크/조인”을 구현하기 위한 실행 규격이다.
- 구현 세부는 모듈 내부에서 자유로우나, 외부 관찰 결과는 본 규칙을 만족해야 한다.


