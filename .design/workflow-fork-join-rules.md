### 실시간 Fork/Join 규칙서 (무지연·무임시·원자적 생성)

목표
- 실시간 단계별 이벤트 처리로 그래프를 정확히 생성한다.
- 노드 생성과 엣지 연결은 항상 같은 이벤트에서 원자적으로 동시에 수행한다.
- 임시 처리(보류/큐/재연결/후속보정), 타이머 대기, 하드코딩 이벤트명은 모두 금지한다.
- 다중/중첩 fork가 가능하며, 각 fork 단위로 여러 번 join이 일어나도 항상 즉시·원자적으로 처리한다.
- team.* 이벤트는 사용하지 않는다. TEAM_EVENTS는 존재하지 않으며, team에서 이벤트를 emit하지 않는다(제3자 컴포넌트).

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
- ID는 path로부터 직접 유도한다.
  - 모든 이벤트성 노드의 id = 해당 이벤트의 path 마지막 세그먼트(= path.tail)
  - 부모-자식 관계는 parentPath(= path.slice(0, -1)) 동일성으로만 판정
  - 접두사 존재 여부와 무관하게 로직은 path만으로 판단한다.

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
- ExecutionService는 동일 thinking 라운드에서 여러 tool.call_response_ready를 발생시킨 직후, 단 1회 `execution.tool_results_ready`를 즉시 발생한다(카운팅/대기/재확인 금지). 준비 여부는 path 그룹 스캔으로 유도하며 배리어 상태는 사용하지 않는다.
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
- [ ] 핸들러에서 groupId/branchId/responseExecutionId 사용 제거(유지 시에도 핸들러는 무시) 및 path-only 전환
- [ ] `packages/workflow/src/services/workflow-state.ts`에서 보류/임시 큐/배리어 관련 상태·API 제거
- [ ] `AgentEventHandler` path-only 유지(생성 즉시 thinking → response(return) 원자 연결)
- [ ] `ToolEventHandler` path-only 유지(path.tail 기반 response 식별 → response → tool_response(result) 원자 연결)
- [ ] `ExecutionEventHandler`에서 tool_results_ready 처리 시 tool_result 생성 및 tool_response* → tool_result(result) 동시 연결, 필요 시 tool_result → next thinking(analyze)
- [ ] `packages/agents/src/services/execution-service.ts`에 path 자동 주입/검증 강화(emit 전 path 검증, 클론 tail(required) 누락 시 즉시 throw)
- [x] 하드코딩 이벤트명 제거(모든 emit/on은 상수 기반). team.* 이벤트 제거 정책 준수
- [x] 예제 26 및 중첩 fork 케이스 검증 스크립트 통과

### 에이전트 ↔ ExecutionService 이벤트 소유권 정비
- [ ] execution.* 이벤트의 단일 소유권을 `ExecutionService`로 고정한다. 다른 모듈/플러그인은 execution.*를 emit하지 않는다.
- [ ] `packages/agents/src/plugins/event-emitter-plugin.ts`에서 execution.*/tool.* 이벤트 emit 기능을 제거하거나 기본 비활성화한다(Listener-only 또는 module./plugin. 범위로 한정).
- [x] `packages/agents/src/agents/robota.ts`에서 `EXECUTION_EVENTS` import/의존 제거 및 플러그인 설정에서 execution.* 이벤트 나열을 삭제한다.
- [x] `packages/agents/src/agents/robota.ts`의 `'agent.created'` 하드코딩 문자열을 `AGENT_EVENTS.CREATED` 상수로 교체한다(Agent 소유 이벤트는 Agent가 emit 가능).
- [ ] 코드베이스 전역에서 `emit('execution.` 패턴이 `execution-service.ts` 외부에 존재하지 않음을 검사하고 발견 시 이전 구조로 이관한다.
- [ ] 이벤트 소유권 위반을 방지하기 위해 ESLint/검증 스크립트에 "execution.* emit 금지(ExecutionService 외)" 룰을 추가한다(빌드 실패 유도).

## EventService Prefix Injection 모델(제안)

목표
- EventService를 생성/클론할 때 소유자 접두어(ownerPrefix)를 주입하고, 해당 서비스에서 발생시키는 모든 이벤트명이 이 접두어로 시작하는지 검증한다.
- 라이브러리(프로젝트 사용자)는 접두어 관리/검증을 의식하지 않아도 된다. 상수 기반 API를 그대로 사용한다.

설계
- 소유자 접두어: `'execution' | 'tool' | 'agent' | 'team'` (team.*는 현재 정책상 미사용)
- 생성/클론 시그니처(개념):
  - `new EventService({ ownerPrefix: 'execution', strict: true })`
  - `eventService.clone({ ownerPrefix: 'tool' })`
- 검증 방법: EventService.emit 내부에서 `eventName.startsWith(ownerPrefix + '.')` 검사. 불일치 시 즉시 에러 throw (개발용 진단 메시지 포함).
- 이벤트명 조합 방침: 런타임 문자열 조합 금지. 기존처럼 소유 모듈에서 선언형 상수를 export/import 하여 사용. EventService는 상수로 전달된 이벤트명을 검증만 수행.
- 핸들러 주입 단순성 유지: 핸들러는 기존과 동일하게 등록(import한 상수로 on/emit). 접두어 검증은 EventService 내부에서만 수행되어, 핸들러/호출부의 복잡도 증가 없음.

적용 흐름 예시
- Tool → Sub Agent 생성 시:
  - Tool이 자식 객체(Agent)를 만들 때 `eventService.clone({ ownerPrefix: 'agent' })`로 복제하여 자식에 주입.
  - 자식(Agent)은 자신의 `AGENT_EVENTS.*`만 emit 가능(검증으로 강제).
- Execution 레이어:
  - 최상위 Agent가 생성 시점에 `ownerPrefix: 'execution'`으로 주입된 EventService를 보유(또는 상위에서 주입).
  - ExecutionService는 `EXECUTION_EVENTS.*`만 emit 가능.

SDK/개발 단계 한정 검증
- 기본: `strict: true`로 검증 활성. 불일치 시 상세 원인/수정 가이드를 포함한 에러 메시지로 즉시 중단.
- 배포 모드: 동일 로직 유지 가능(권장). 단, 사용자는 상수만 사용하므로 추가 부담 없음.

단계적 도입 계획
- [ ] EventService 생성자/clone API에 `ownerPrefix` 옵션 추가 및 내부 검증 구현
- [ ] 상위 컨테이너에서 하위 객체 생성 시 `clone({ ownerPrefix })` 체인 적용(agents/tool/team 레이어)
- [ ] 기존 emit 호출부에서 상수만 전달하는지 재검토(문자열 조합 제거 확인)
- [ ] 검증 에러 메시지 표준화: "[EVENT-PREFIX-VALIDATION] Expected prefix 'execution.' but received 'tool.*' (owner=execution)"

비고
- 이 모델은 상수 기반 설계를 보완하는 안전장치로, 접두어 소유권을 런타임에서 확정해 이벤트 소유자/경계가 흐려지는 문제를 방지한다.
- 핸들러/모듈 주입 구조는 그대로 유지된다(간단한 주입/등록 패턴 보존).

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
- 배리어/카운팅 없이 path 그룹 스캔으로 단 1회 join 트리거됨
- tool_result는 상위 흐름의 다음 노드로만 간주되며 thinking과 직접 연결하지 않음
- ID 규칙은 결정적이며, 로직은 접두사에 의존하지 않음(추측/후보정 불필요)
- 중첩 포크는 parentPath 기준으로 조인되며 path를 통해 상위 위계 추적 가능
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



### Continued Conversation (Response → Next User Message → Thinking) Path-Only 계획 (2025-08-15)

목표
- 동일 루트 경로(rootPath) 내에서 대화가 이어질 때, 항상 다음 순서로 연결되도록 보장한다:
  1) response → 2) user_message → 3) agent_thinking → 4) response … (반복)
- 첫 user_message만 agent → user_message(Receives)로 연결되고, 이후부터는 “바로 이전 Response(또는 상위 흐름의 종료점)”에서 user_message로 연결된다.
- 모든 결정은 오직 path만으로 수행하며, 보조 상태/대기/후속보정/하드코딩 금지.

핵심 불변식
- 모든 user_message 노드의 id는 해당 이벤트의 `path.tail`로 결정한다.
- 첫 대화: `agent(root) → user_message` (‘receives’)
- 이어지는 대화: `response(last in same rootPath upper-flow) → user_message` (edge type: ‘continues’)
- thinking은 항상 직전 user_message로부터 ‘processes’ 타입으로 연결되어야 한다(동일 이벤트 처리 흐름 내 원자성 유지).

단계별 계획 (코드 반영 순서)
1) ExecutionService: path 주입 규칙 강화 (user_message)
   - 현재: execution.user_message에 `path: [rootId]`만 주입되는 케이스 존재
   - 변경: 각 user_message마다 고유 tail(= executionId) 추가하여 `path = [rootId, executionId]`로 보장
   - 검증: emit 직전 path 존재/형식 검증, 누락 시 즉시 throw (No-Fallback)

2) ExecutionEventHandler: user_message ID/에지 생성 규칙 갱신
   - ID 규칙: `node.id = path[path.length - 1]` (sourceId 금지)
   - 연결 규칙(원자성): 동일 rootPath 내 상위 흐름의 최신 종료점에서 user_message로 즉시 연결
     - 최신 종료점 결정: parentPath(= path.slice(0, -1))가 rootPath와 동일한 노드들 중, 가장 최근의 ‘response’(우선) 혹은 ‘tool_result’(대화 상위 흐름의 종료점) 선택
     - 연결 타입: ‘continues’ (신규), 첫 user_message만 예외적으로 agent → user_message ‘receives’ 유지
   - 허용 인덱스: Subscriber Path Map(읽기 전용)으로 parentPath 일치 노드 집합 조회 (명확 키 매칭만, 보조 상태 금지)

3) ExecutionEventHandler: assistant_message_start(Thinking) 연결 규칙 정비
   - 동일 rootPath 내에서 가장 최근 user_message(parentPath == rootPath)를 찾아 `user_message → thinking`을 ‘processes’로 즉시 연결
   - 만약 동일 parentPath의 user_message가 없다면 즉시 오류(설계 위반)로 중단 (No-Fallback)

4) AgentEventHandler: response 생성 시 기존 원자성 유지
   - thinking → response는 ‘return’으로 즉시 연결 (현행 Path-Only 규칙 유지)
   - response 생성 시 추가 보정/대기/후속 연결 금지

5) Edge 타입 컨벤션 정리 (문서화)
   - agent → user_message: ‘receives’ (최초 1회)
   - response → user_message: ‘continues’ (이어진 대화)
   - user_message → agent_thinking: ‘processes’
   - agent_thinking → response: ‘return’
   - response → tool_response: ‘result’ (ToolEventHandler 규칙 유지)
   - tool_response[*] → tool_result: ‘result’ (Join 규칙 유지)
   - tool_result → (다음 라운드)agent_thinking: ‘analyze’ (필요 시)

6) 예외/결함 처리 (Strict)
   - path 누락, tail 중복/형식 오류, parentPath 상에서 연결 대상 미발견 시 즉시 throw (로그 + 중단)
   - 임시/후속 보정, 대기, 재시도 금지

7) 검증/테스트
   - 예제 27 (single-agent-continued-chat):
     - 두 번째 run() 수행 시 user_message가 새 path.tail로 생성되고,
     - response(last) → user_message(continues) → thinking(processes) 순으로 이어짐을 확인
   - 예제 26 (team): 기존 검증 스크립트 통과 + 중첩 fork/join 시 상위 흐름 복귀 이후에도 동일 규칙 유지 확인

8) 점진적 적용/호환성
   - 실행 이벤트 path가 이미 올바르게 주입된 케이스부터 적용
   - path 미주입 환경은 허용하지 않으며, 발견 시 설계 위반으로 실패 처리 (가이드 메시지 제공)

체크리스트
- [ ] ExecutionService(user_message) path = [rootId, executionId] 보장
- [ ] ExecutionEventHandler.user_message → id = path.tail, response(last) → user_message(continues) 연결
- [ ] ExecutionEventHandler.assistant_message_start → user_message(last same root) → thinking(processes)
- [ ] Subscriber Path Map 사용 범위 최소화(읽기 전용·명확 키)
- [ ] Edge 타입 컨벤션 반영 및 문서화
- [ ] 예제 27/26 재검증 (Strict 정책 위반 0)

설계 근거
- Path-Only: parentPath 동일성만으로 상위/하위 흐름 유도
- 원자성: 각 이벤트 처리 내에서 노드/엣지를 동시에 생성
- No-Fallback: 누락/혼선 시 즉시 실패로 문제 가시화
