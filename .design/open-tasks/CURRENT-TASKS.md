# 현재 진행 작업 (1-2주 목표)

> 즉시 실행해야 할 핵심 작업들입니다. 우선순위 순으로 정렬되어 있습니다.

## 📅 업데이트: 2025-10-16

---

## 🔥 Priority 1: Agent Event Normalization (진행중)

### 완료된 단계
- [x] 단계 1: Agent가 스스로 올바른 이벤트 emit 보장
- [x] 단계 2: Agent.created에서 Agent 노드 생성
- [x] 단계 4: Tool 핸들러의 Agent 노드 중복 생성 방지
- [x] 단계 5: 도구측 대리 이벤트 발행 제거
- [x] 단계 6: 예제 26 동작/데이터 동등성 확인
- [x] 단계 7: 최종 정리 (Tool 핸들러 분기 삭제)

### 남은 작업

#### 단계 3: execution_start 상태 전이 우선 (하위 호환)
- [ ] `packages/workflow/src/handlers/agent-event-handler.ts`
  - [ ] `agent.execution_start` 수신 시:
    - [ ] 기존 Agent 노드 있으면 status=running 등 상태만 갱신
    - [ ] 기존 Agent 노드 없을 때만 "임시 생성" (하위 호환용)
- [ ] 빌드/가드/검증 실행
- [ ] Agent 노드 수 점검(중복 증가 없음)
- [ ] Guard 실패 피드백 기반 이론 재검증
  - [ ] 실패 요약: 예제 26 Guard 검증에서 다중 start node, 컴포넌트 단절, thinking↔tool_result timestamp 충돌로 불합격
  - [ ] 가설 1 (다중 start node): assignTask로 파생된 conversation user_message 노드가 상위 thinking/tool_call과 연결되지 않아 root가 3개로 분리됨 → parentExecutionId 기반 엣지 생성 규칙 보강 필요
  - [ ] 가설 2 (컴포넌트 단절): WorkflowState/agentNodeIdMap이 하위 conversation의 agent를 상위 루트와 매칭하지 못해 독립 그래프가 유지됨 → execution_start 상태 전이 시 conversationIdToAgentIdMap/WorkflowState 동시 갱신 필요
  - [ ] 가설 3 (timestamp 충돌): tool_result와 thinking_round2 timestamp가 동일하게 부여되어 sequential order 위반 → tool_result 생성 시 parent thinking timestamp보다 항상 작거나 같아야 한다는 조건을 명시하고, thinking_round2 생성 시 `max(previousTimestamp)+1` 규칙을 적용하도록 시뮬레이션 계획 수립
  - [ ] 계획 검증 절차:
    - [ ] `data/real-workflow-data.json`을 기준으로 각 가설을 실제 노드/엣지에서 확인 (start node 수, component 수, timestamp 비교)
    - [ ] Guard 로그와 WorkflowState 업데이트 로그를 대조하여 어떤 이벤트에서 분기가 벌어졌는지 문서화
    - [ ] Path-only 규칙과 충돌하는 지점을 체크리스트화하고, 수정 필요 포인트를 순서대로 나열
  - [ ] 검증 결과 기록:
    - [ ] 각 가설별로 “충분히 재현됨/추가 데이터 필요” 여부 판단
    - [ ] 필요한 경우 추가 가설(예: agent_thinking ↔ tool_response 연결 누락)을 문서에 보강
    - [ ] 이후 코드 설계 시 참조할 수 있도록 시사점 요약
  - [ ] 세부 세분화:
    - [ ] 가설 1 재현 로그 캡처: guard output 중 start node 관련 구간을 `.design` 문서에 붙여넣고 원인 분석
    - [ ] parentExecutionId → previous edge 생성 규칙 초안 작성
    - [ ] 가설 2 확인을 위해 WorkflowState agent 매핑 스냅샷을 수집(가능 시 run 중 로그), conversationIdToAgentIdMap 상태 기록
    - [ ] 가설 3에서 문제가 되는 tool_result / thinking_round2 페어를 표로 정리 (timestamp, sourceId, path)
    - [ ] 각 가설에 대해 “수정 시 필요한 코드 위치”를 미리 지정 (예: agent-event-handler.ts, execution-event-handler.ts 등)
  - [ ] TODO: 위 가설을 기반으로 Path-only 연결/타임라인 이론을 재정의하고, 코드 수정 전에 문서 내 시퀀스 다이어그램/표로 검증
- [ ] 단계 3 상세 실행 계획:
  - [x] 이벤트 흐름 및 영향 범위 재구성: emit 지점·payload 필드·연쇄 이벤트 문서화
    - Robota `run/runStream`이 ActionTrackingEventService(ownerPrefix='agent')를 통해 `AGENT_EVENTS.EXECUTION_START`를 실행 시작 직전에 emit하며 payload에는 `sourceType`, `sourceId(=conversationId)`, `timestamp`만 포함됨. ExecutionProxy도 동일 이벤트를 감싼 상태라 중복 emit 가능성 존재.
    - `agent.created`에서 `agentNodeIdMap`(sourceId→agentNodeId)과 `WorkflowState` 매핑이 초기화되며, 현재 `agent.execution_start` 케이스는 이 맵을 통해 존재하는 노드만 `WorkflowState.setAgentForExecution(executionId)`에 연결하고 상태 필드 갱신은 수행하지 않음.
    - 노드가 없는 경우 아무 작업도 되지 않아(하위호환 임시 생성 필요) 단계 3의 목표는 이 이벤트를 상태 전이 전용으로 두되, 소스 식별자는 sourceId/path 기반으로만 얻을 수 있음을 확인. downstream 노드/엣지는 영향을 받지 않으므로 상태 갱신과 임시 생성이 충돌하지 않도록 분리해야 함.
  - [x] 기존 노드 재활용 조건 정의: 탐색 기준(id/path)과 업데이트 대상 필드 목록 확정
    - 1차 키: `agentNodeIdMap`에 저장된 sourceId↔agentNodeId 매핑. 이벤트 payload에 executionId/path가 없으므로 sourceId가 유일 기준.
    - 보조 키: `WorkflowState.getAgentForExecution(executionId)`와 `getAgentForRoot(rootExecutionId)`를 사용하되, executionId/rootId가 없는 이벤트는 스킵. Path-only 원칙상 필요 시 `getAllNodes()`를 읽어 `data.sourceId`가 동일한 AGENT 노드를 찾는 read-only 스캔만 허용.
    - 재활용 시 필수 갱신 대상:
      - `status`: `running`으로 고정(또는 기존 값이 `error/completed`일 때 상태 전이 로그 남김).
      - `data.extensions.robota.originalEvent`: 새 이벤트 payload 병합(기존 필드 유지, parameters 부분만 덮어쓰기).
      - `data.statusHistory` 또는 equivalent timeline 필드가 있다면 append (없으면 유지).
      - `WorkflowState.setAgentForExecution(executionId, agentNodeId)` 및 `setAgentForRoot(rootExecutionId, agentNodeId)` 재확인.
    - 다중 매칭 방지: sourceId 기준으로 단일 노드만 허용, 복수 발견 시 `WorkflowState`/map 우선, 추후 PathMapReader 도입 전까지 read-only scan에서 첫번째 일치만 사용.
  - [x] 임시 생성 하위호환 블록 분리: 실행 조건·필수 필드·TODO 주석으로 단계 6.5 연계
    - 목적: `agent.created`가 누락되거나 순서가 뒤집힌 레거시 경로에서 Path-only 파이프라인이 끊기지 않도록 “없을 때만 생성” 로직을 유지. 단계 6.5에서 완전 제거 예정임을 주석(`// TODO(step 6.5): remove legacy fallback`)으로 명시.
    - 조건: `agentNodeIdMap`, `WorkflowState` 및 read-only node 스캔을 모두 시도한 후에도 AGENT 노드를 찾지 못했을 때만 실행. 실행 전 `sourceId` 필수 확인, `executionId/rootExecutionId`가 없으면 최소한 `sourceId` 기반으로 노드 생성.
    - 생성 데이터: 기존 `createAgentNode` 헬퍼를 사용해 `id`, `status`, `timestamp`, `data.extensions.robota.originalEvent` 등을 동일 방식으로 초기화. 단, `eventType`은 `AGENT_EVENTS.EXECUTION_START`에 따른 상태 전이임을 설명하는 주석 추가.
    - 상태 동기화: 생성 직후 `agentNodeIdMap`, `WorkflowState.setAgentForExecution`, `setAgentForRoot`를 업데이트하여 downstream 연결과 일관성 유지.
    - 모니터링: 임시 블록이 실행될 때마다 logger.warn으로 레거시 경로 감지 메시지를 남겨, 단계 6.5 준비 시 레거시 사용 빈도를 파악 가능하도록 계획.
  - [x] 상태 전이 데이터 변경 시나리오 작성: 갱신 순서, downstream 영향, 예외 케이스 기록
    - 기본 순서:
      1. 노드 식별: 재활용 조건에서 확보한 agentNodeId를 기준으로 기존 노드 snapshot 확보(read-only).
      2. 상태 업데이트: 기존 상태가 `running`이더라도 같은 값으로 idempotent하게 덮어쓰기, `error/completed`였다면 로그에 state regression 경고 남김 후 `running`으로 전환.
      3. originalEvent 병합: 기존 `extensions.robota.originalEvent`에 새 payload를 깊은 병합(특히 `parameters`/`metadata` 객체는 병합, timestamp 등 core 필드는 최신 값 유지).
      4. WorkflowState 재연결: `setAgentForExecution(executionId)`, `setAgentForRoot(rootExecutionId)` 호출. executionId가 없을 경우 root 기반만 갱신.
      5. statusHistory(또는 equivalent) append: 기존 history가 있다면 `[{ eventType: 'agent.execution_start', timestamp, status: 'running' }]` 형태로 추가.
    - Downstream 영향:
      - Thinking/response 노드 생성 로직은 `WorkflowState`를 참조하므로, 상태 전이 직후에 WorkflowState 갱신을 완료해야 함.
      - Path-only Edge 생성 시 agent node id를 참조하는 부분이 없으므로 기존 엣지에는 영향 없음.
    - 예외 케이스:
      - 동일 executionId로 반복된 execution_start: idempotent하게 처리(WorkflowState 매핑 덮어쓰기), statusHistory에 중복 항목 남길지 여부는 후속 단계에서 결정(현재는 남기고 logger.debug로 중복 알림).
      - 노드 snapshot이 없을 때: 임시 생성 블록으로 이관. snapshot이 있으나 data 구조가 누락된 경우, 최소 필드만 업데이트하고 missing 필드는 건드리지 않음(안전한 partial update).
  - [x] 검증 시나리오/빌드 준비: 노드 수 모니터링 포인트와 Guarded 예제 26 실행 계획 정리
    - 빌드 순서: `pnpm --filter @robota-sdk/workflow build` → `pnpm --filter @robota-sdk/team build` → `pnpm --filter @robota-sdk/agents build`.
    - 예제 실행: `apps/examples` 폴더에서 Guarded 실행 스크립트(`FILE=26-playground-edge-verification.ts ...`) 사용, `[STRICT-POLICY]`/`[EDGE-ORDER-VIOLATION]` 발견 시 검증 중단.
    - 모니터링 포인트:
      - Guard 로그 tail에서 Agent 노드 생성·상태 전이 경고(logger.warn)가 등장하는지 체크(임시 생성 블록 사용 여부 파악).
      - 검증 스크립트 출력의 nodes/edges 카운트가 baseline과 동일한지 비교(중복 증가 여부 확인).
      - 필요 시 `apps/examples/data/real-workflow-data.json`을 diff하여 agent node entries가 증가하지 않았는지 확인.
    - 실패 대응: 빌드 실패 시 즉시 원인 분석 후 재실행, Guarded 예제 실패 시 로그 파일 위치(`cache/26-playground-edge-verification-*-guarded.log`)와 원인 메시지를 문서에 기록 후 fix 작업.
  - [x] `.design/open-tasks/CURRENT-TASKS.md` 체크리스트 반영 규칙 및 진행 로그 작성
    - 체크리스트 업데이트 방식:
      - 각 세부 항목 완료 시 `[x]` 처리 + 간단히 어떤 분석/작업이 끝났는지 한 줄 요약을 바로 아래 bullet로 기록.
      - 중간에 범위 변경/추가 요구가 생기면 해당 항목 아래에 indented bullet로 “범위 조정” 메모를 추가.
      - 향후 코드 구현/빌드 단계가 시작되면 동일 섹션에 “실제 구현” 하위 리스트를 새로 만들어 분리.
    - 진행 로그 운용:
      - Priority 1 섹션 하단 “작업 진행 기록” 영역에 중요한 전환점(예: 상태 전이 로직 확정, Guarded 검증 완료)을 날짜와 함께 bullet로 누적.
      - Guarded 예제 실행 결과(성공/실패)와 로그 파일 위치를 진행 기록에 링크 형태로 남겨 재현 가능성 확보.
      - 단계 6.5/6.6로 넘어갈 때, 단계 3의 완료 항목들에 `[x]` 표시 후 “다음 단계로 전환” 주석을 남겨 문서 내 단계간 추적이 가능하도록 유지.
- [ ] 단계 3 이론 시뮬레이션 기록
  - [ ] assignTask fork 케이스 이벤트 시퀀스(루트 user_message → thinking → tool_call → 하위 agent user_message/ thinking/ response → tool_result → 상위 thinking_round2 → response)를 표로 작성
  - [ ] 각 단계에서 요구되는 Path-only 연결 조건과 WorkflowState 업데이트 요건을 명확히 정의
  - [ ] 타임스탬프 증가 규칙(각 노드/엣지 생성 시점)이 sequential rule을 만족하는지 가상 시뮬레이션
  - [ ] 시뮬레이션 결과를 기반으로 코드 수정 시나리오를 도출하고, Guard 재실행 전에 문서에서 검증 완료 표시
  - [ ] 세부 체크리스트:
    - [ ] 이벤트 순서도를 ASCII 다이어그램 또는 표 형태로 작성
    - [ ] 각 이벤트에서 생성되는 노드 ID, edge 타입, timestamp 공식을 명시
    - [ ] WorkflowState 변화(Agent mapping, thinking map) 로그를 단계별로 예측
    - [ ] “start node 1개/단일 컴포넌트/순차 timestamp”의 충족 여부를 표 형태로 검증
    - [ ] 예상 결과를 `.design` 문서에 요약하여 코드 작성 전 리뷰 가능 상태로 유지
  - [ ] 추가 세분화 항목:
    - [ ] 시뮬레이션용 변수 정의(예: rootExecutionId R0, toolCallIds T1/T2 등)로 일관된 표기법 확립
    - [ ] Fork 단계별 Edge 규칙을 명시 (user_message→thinking: processes, thinking→tool_call: invokes 등)
    - [ ] Join 단계에서 tool_result→thinking_round2 edge 타입/조건을 도출하고 timestamp 공식(`toolResultTs + ε`)을 문서화
    - [ ] 시나리오별(예제 26, 27) 차이점을 비교하여 공통 규칙/특수 규칙 구분
    - [ ] 시뮬레이션 결과에 따른 “필수 수정 포인트” 리스트업
- [ ] 단계 3 구현/검증 순서 제안:
  - [ ] (1) `agent-event-handler.ts` 코드 업데이트: 재활용 로직, 상태 업데이트, WorkflowState 재연결, 임시 생성 블록 분리(TODO 주석/경고 로그 포함).
  - [ ] (2) 빌드 및 Guarded 예제 26 실행: workflow → team → agents 순으로 빌드, Guarded 스크립트 실행 후 Agent 노드 수/경고 로그/STRICT-POLICY 위반 여부 확인.
  - [ ] (3) 결과 문서화: Guard 로그 요약, 임시 생성 사용 여부, 예제 데이터 diff 등을 CURRENT-TASKS 진행 기록에 반영하고 단계 6.5 준비 상황을 업데이트.
- [ ] Mock AI Provider + Recorder 구축
  - [ ] Mock Provider: `AbstractAIProvider`를 상속하는 `MockAIProvider` 구현, 사전 정의된 응답 시퀀스를 즉시 반환하도록 구성
  - [ ] Recorder 래퍼: 실제 provider를 감싸서 `execute`/`executeStream` 결과를 시나리오 JSON으로 기록 (dev/test 플래그 기반)
  - [ ] Scenario 저장소: `apps/examples/scenarios/<scenarioId>.json` 형태로 입력/출력 기록 + metadata 관리
  - [ ] Provider 선택 로직: Agent/ExecutionService 옵션에 `useMockProvider`, `recordProviderResponses` 추가하여 wiring
  - [ ] 예제 26 시나리오 생성 및 Mock 실행 검증: 실제 provider로 기록한 뒤 Mock 모드에서 재실행, Guarded 검증 통과 확인
  - [ ] 세부 실행 단계:
    - [ ] 시나리오 JSON 스키마 확정 (prompt hash, response text/stream, metadata)
    - [ ] Recorder 옵션 플래그 설계 (`AgentConfig.mockScenarioId`, `recordScenarioId` 등)
    - [ ] 저장 경로/파일명 규칙 정의 및 README 문서화
    - [ ] Mock Provider가 시나리오 데이터를 못 찾았을 때 즉시 실패하도록 예외 정책 정의(No-fallback 유지)
    - [ ] CI/로컬 실행 시나리오: `pnpm test:scenario --scenario=26` 명령 초안 작성
  - [ ] 추가 세분화:
    - [ ] Mock Provider 응답 시퀀스 로더 구현 계획 (파일→메모리→provider)
    - [ ] Recorder가 파일에 append 시 concurrency/ordering을 어떻게 보장할지 결정 (예: timestamp-based filename)
    - [ ] Scenario 관리 CLI 초안 (`pnpm scenario:record`, `pnpm scenario:play`)
    - [ ] 예제별 기본 시나리오 목록 정의 및 문서화
    - [ ] Mock Provider 사용 시 Guarded 실행 절차(옵션 플래그, 환경변수 등) 문서화

#### 단계 6.5: 단일 전환 단계 (Decision Gate)
- [ ] Agent 핸들러: `agent.execution_start`는 상태 전이만 (노드 생성 절대 금지)
- [ ] 단계 3의 "없을 때만 임시 생성" 하위호환 로직 완전 제거
- [ ] 팀/툴 발행자: `tool.agent_execution_started` emit 완전 제거
- [ ] 상수 제거: `packages/team/src/events/constants.ts`
- [ ] 빌드/가드/검증 (원샷 검증)

#### 단계 6.6: Fork/Join round2 thinking 연결 교정
- [ ] `packages/workflow/src/handlers/agent-event-handler.ts`
  - [ ] `execution.assistant_message_start`에서 연결 소스 결정 규칙 교정
  - [ ] 동일 `rootExecutionId` 내 최신 thinking 노드 찾기 (Path-Only)
  - [ ] `tool_result` 중 `parentThinkingNodeId` 일치하면 `analyze` 엣지
  - [ ] 미발견 시 `user_message → thinking` (processes)
- [ ] 빌드/가드/검증
- [ ] round2 연결 검증: `tool_result → thinking_round2 (analyze)`

#### 단계 8: Subscriber Path Map Reader (선택, 우선순위 낮음)
- [ ] `PathMapReader` 객체 설계 (읽기 전용)
- [ ] 명시 필드만으로 인덱스 구축
- [ ] Agent 핸들러 등에 적용
- [ ] `getAllNodes()` 직접 스캔과 결과 동등성 검증

#### 단계 9: base-* → abstract-* 마이그레이션 (신규)
- [ ] 1차 스캔: `packages/agents/src/abstracts/base-*.ts` 전수 조사 후 사용 빈도 낮은 순으로 우선순위 확정<br/>(후보: `base-plugin.ts`, `base-module.ts`, `base-executor.ts`, `base-ai-provider.ts`, `base-tool-manager.ts`, `base-workflow-runner.ts`)
- [ ] 파일별 계획 수립: 
  - [ ] `abstract-*.ts` 신규 생성 + 파일 상단에 “ABSTRACT CLASS” 주석 추가
  - [ ] `DEFAULT_ABSTRACT_LOGGER` 기본값 적용, 추상 타입만 참조하도록 점검
  - [ ] EventService, ownerPrefix, DIP 위반 여부 코드 리뷰
- [ ] 참조 교체 단계:
  - [ ] 관련 import/타입을 `abstract-*`로 전환 (Path-Only 검증)
  - [ ] 예제/서비스에서 `ActionTrackingEventService` 직접 참조 금지 확인
- [ ] 품질 게이트:
  - [ ] `pnpm --filter @robota-sdk/agents build`
  - [ ] `cd apps/examples && npx tsx 10-agents-basic-usage.ts` (로그 가드 규칙 준수)
  - [ ] 필요한 경우 Guarded Example 26 재검증
  - [ ] `.design/open-tasks/CURRENT-TASKS.md` 체크박스 `[x]` 업데이트
- [ ] `base-*` 파일 제거: 모든 참조 교체/빌드 통과 후 개별 파일 삭제
- [ ] 로그/문서: 변경된 추상 클래스 목록과 진행 현황을 CURRENT-TASKS에 주기적으로 반영
- [x] 1차 완료 항목: `base-plugin.ts → abstract-plugin.ts` (Plugins manager & 모든 plugin 구현체 `AbstractPlugin` 상속 전환, guard 빌드/예제 통과)
- [x] 2차 완료 항목: `base-module.ts → abstract-module.ts`
  - [x] `base-module.ts` 구조/의존성 분석 및 import 사용처 목록화 (`Robota`, module registries 등)
  - [x] `packages/agents/src/abstracts/abstract-module.ts` 신규 생성 + 상단 "ABSTRACT CLASS" 주석, `DEFAULT_ABSTRACT_LOGGER` 기본 주입
  - [x] `ModuleExecutionContext`, `ModuleStats` 등 기존 타입/인터페이스를 그대로 이전하고, 클래스명 `AbstractModule`로 명확화
  - [x] 모든 구현/매니저에서 `BaseModule` import를 `AbstractModule`로 전환, 타입 정의(`AgentConfig.modules`) 업데이트
  - [x] `base-module.ts`는 임시 re-export 스텁 + "안쓰는 것이니 차후에 삭제 필요" 주석만 남기고 최종 삭제 전까지 유지
  - [x] 검증: `pnpm --filter @robota-sdk/agents build`, `apps/examples && npx tsx 10-agents-basic-usage.ts` 로그 가드 실행 (필요 시 26번 예제 가드 준비)
  - [x] 문서 업데이트 및 체크박스 반영 후 다음 `base-*` 대상 선정
- [x] 3차 완료 항목: `base-executor.ts → abstract-executor.ts`
  - [x] 사용 빈도 및 import 의존성 조사 (`ExecutionService`, executor registry 등)
  - [x] `abstract-executor.ts` 신규 생성 + "ABSTRACT CLASS" 주석, `DEFAULT_ABSTRACT_LOGGER` 기본값 적용
  - [x] Executor 추상 인터페이스/타입을 그대로 이전하고 DIP 위반 여부 재검토
  - [x] 모든 구현부에서 `BaseExecutor` import를 `AbstractExecutor`로 전환
  - [x] 기존 파일은 임시 re-export 스텁으로 유지, 최종 삭제 전까지 "안쓰는 것이니..." 주석 부착
  - [x] 검증: `pnpm --filter @robota-sdk/agents build`, `apps/examples && npx tsx 10-agents-basic-usage.ts`
  - [x] CURRENT-TASKS 업데이트 후 다음 대상 선정
- [x] 4차 완료 항목: `base-ai-provider.ts → abstract-ai-provider.ts`
  - [x] 사용 빈도 및 import 의존성 조사 (AIProviders 매니저, provider 구현체 등)
  - [x] `abstract-ai-provider.ts` 신규 생성 + "ABSTRACT CLASS" 주석, `DEFAULT_ABSTRACT_LOGGER` 기본값 적용
  - [x] Provider 공용 타입/메서드를 그대로 이전하고 DIP 준수 여부 검토
  - [x] 모든 구현부에서 `BaseAIProvider`/`BaseProvider` import를 `AbstractAIProvider`로 전환
  - [x] 기존 파일은 임시 re-export 스텁 + "안쓰는 것이니..." 주석만 유지
  - [x] 검증: `pnpm --filter @robota-sdk/agents build`, `apps/examples && npx tsx 10-agents-basic-usage.ts`, provider별 build(OpenAI/Google/Anthropic)
  - [x] CURRENT-TASKS 업데이트 후 다음 대상 선정
- [ ] 5차 진행 예정: `base-tool-manager.ts → abstract-tool-manager.ts`
  - [ ] (파일 미존재) 현재 `tool-manager.ts`가 직접 구현되어 있어 `base-tool-manager.ts` 없음 → 참고용으로 기록만 유지
  - [ ] 향후 필요 시 tool manager 추상화 범위 정의
- [x] 6차 완료 항목: `base-provider.ts → abstract-provider.ts`
  - [x] 사용 빈도 및 import 의존성 조사 (Provider registry/manager 등)
  - [x] `abstract-provider.ts` 신규 생성 + "ABSTRACT CLASS" 주석, `DEFAULT_ABSTRACT_LOGGER` 적용
  - [x] Provider 베이스 메서드/상태 이전 및 DIP 준수 여부 검토
  - [x] 모든 구현부에서 `BaseProvider` import를 `AbstractProvider`로 전환
  - [x] 기존 파일은 임시 re-export 스텁 + "안쓰는 것이니..." 주석 유지
  - [x] 검증: `pnpm --filter @robota-sdk/agents build`, `apps/examples && npx tsx 10-agents-basic-usage.ts`
  - [x] CURRENT-TASKS 업데이트 후 다음 대상 선정
- [x] 7차 완료 항목: `base-workflow-converter.ts → abstract-workflow-converter.ts`
  - [x] 사용 빈도 및 import 의존성 조사 (Workflow converter 구현체 등)
  - [x] `abstract-workflow-converter.ts` 신규 생성 + "ABSTRACT CLASS" 주석, `DEFAULT_ABSTRACT_LOGGER` 적용
  - [x] 공용 헬퍼/통계/검증 메서드 이전 및 DIP 준수 여부 검토
  - [x] 모든 구현부에서 `BaseWorkflowConverter` import를 `AbstractWorkflowConverter`로 전환
  - [x] 기존 파일은 임시 re-export 스텁 + "안쓰는 것이니..." 주석 유지
  - [x] 검증: `pnpm --filter @robota-sdk/agents build`, `apps/examples && npx tsx 10-agents-basic-usage.ts`
  - [x] CURRENT-TASKS 업데이트 후 다음 대상 선정
- [x] 8차 완료 항목: `base-workflow-validator.ts → abstract-workflow-validator.ts`
  - [x] 사용 빈도 및 import 의존성 조사 (Workflow validator 구현체 등)
  - [x] `abstract-workflow-validator.ts` 신규 생성 + "ABSTRACT CLASS" 주석, `DEFAULT_ABSTRACT_LOGGER` 적용
  - [x] 공용 헬퍼/통계/룰 관리 로직 이전 및 DIP 준수 여부 검토
  - [x] 모든 구현부에서 `BaseWorkflowValidator` import를 `AbstractWorkflowValidator`로 전환
  - [x] 기존 파일은 임시 re-export 스텁 + "안쓰는 것이니..." 주석 유지
  - [x] 검증: `pnpm --filter @robota-sdk/agents build`, `apps/examples && npx tsx 10-agents-basic-usage.ts`
  - [x] CURRENT-TASKS 업데이트 후 다음 대상 선정
- [x] 9차 완료 항목: `base-visualization-generator.ts → abstract-visualization-generator.ts`
  - [x] 사용 빈도 및 import 의존성 조사 (Mermaid generator 등)
  - [x] `abstract-visualization-generator.ts` 신규 생성 + "ABSTRACT CLASS" 주석, `DEFAULT_ABSTRACT_LOGGER` 적용
  - [x] 공용 템플릿 메서드/헬퍼 이전 및 DIP 준수 여부 검토
  - [x] 모든 구현부에서 `BaseVisualizationGenerator` import를 `AbstractVisualizationGenerator`로 전환
  - [x] 기존 파일은 임시 re-export 스텁 + "안쓰는 것이니..." 주석 유지
  - [x] 검증: `pnpm --filter @robota-sdk/agents build`, `apps/examples && npx tsx 10-agents-basic-usage.ts`
  - [x] CURRENT-TASKS 업데이트 후 다음 대상 선정
- [x] 10차 완료 항목: `base-layout-engine.ts → abstract-layout-engine.ts`
  - [x] 사용 빈도 및 import 의존성 조사 (layout engine 구현체 등)
  - [x] `abstract-layout-engine.ts` 신규 생성 + "ABSTRACT CLASS" 주석, `DEFAULT_ABSTRACT_LOGGER` 적용
  - [x] 공용 템플릿/통계 로직 이전 및 DIP 준수 여부 검토
  - [x] 모든 구현부에서 `BaseLayoutEngine` import를 `AbstractLayoutEngine`으로 전환
  - [x] 기존 파일은 임시 re-export 스텁 + "안쓰는 것이니..." 주석 유지
  - [x] 검증: `pnpm --filter @robota-sdk/agents build`, `apps/examples && npx tsx 10-agents-basic-usage.ts`
  - [x] CURRENT-TASKS 업데이트 후 다음 대상 선정
- [x] 11차 완료 항목: `base-tool.ts → abstract-tool.ts`
  - [x] 기존 `abstract-tool.ts` 구조 재검토, "ABSTRACT CLASS" 주석 및 `DEFAULT_ABSTRACT_LOGGER` 기본 주입 정책 위반 여부 점검
  - [x] `BaseTool` import 사용처 전수 조사 (`FunctionTool`, `MCPTool`, `Robota`, Playground executor 등) 후 `AbstractTool`로 명시 전환 여부 확인
  - [x] `base-tool.ts`가 재-export 스텁(`안쓰는 것이니...`) 형태로만 남아있음을 검증하고 불필요 로직 제거 여부 재확인
  - [x] 검증: `pnpm --filter @robota-sdk/agents build`, `apps/examples && npx tsx 10-agents-basic-usage.ts`
  - [x] CURRENT-TASKS 업데이트 및 다음 대상(Manager/Agent)으로 진행
- [x] 12차 완료 항목: `base-manager.ts → abstract-manager.ts`
  - [x] `AbstractManager`(초기 버전) 기능 점검 후 `BaseManager` 잔여 구현 제거 및 재-export 스텁화
  - [x] `Tools`, `Plugins`, `AIProviders`, `ModuleRegistry` 등 매니저 구현에서 `AbstractManager` 상속 여부 확인
  - [x] `base-manager.ts` 상단 "안쓰는 것이니..." 주석 유지 + 재-export만 남도록 정리
  - [x] 검증: `pnpm --filter @robota-sdk/agents build`, `apps/examples && npx tsx 10-agents-basic-usage.ts`
  - [x] CURRENT-TASKS 업데이트 후 Agent 단계로 이동
- [x] 13차 완료 항목: `base-agent.ts → abstract-agent.ts`
  - [x] `packages/agents/src/abstracts/abstract-agent.ts` 신규 생성, "ABSTRACT CLASS" 주석 및 기존 공용 로직 이전
  - [x] `Robota` 및 관련 테스트(`robota.test.ts`)를 `AbstractAgent` 기반으로 업데이트하고 DIP 위반 여부 점검
  - [x] `base-agent.ts`는 재-export 스텁 + "안쓰는 것이니..." 주석으로 축소, 향후 삭제 준비
  - [x] 검증: `pnpm --filter @robota-sdk/agents build`, `apps/examples && npx tsx 10-agents-basic-usage.ts`
  - [x] CURRENT-TASKS 체크박스 반영 및 남은 Agent Event Normalization 작업 재정비


### 검증 명령어
```bash
pnpm --filter @robota-sdk/workflow build && \
pnpm --filter @robota-sdk/team build && \
pnpm --filter @robota-sdk/agents build && \
cd apps/examples && \
FILE=26-playground-edge-verification.ts && \
HASH=$(md5 -q "$FILE") && \
OUT=cache/26-playground-edge-verification-$HASH-guarded.log && \
echo "▶️ Run example (guarded)..." && \
STATUS=0; npx tsx "$FILE" > "$OUT" 2>&1 || STATUS=$?; \
tail -n 160 "$OUT" | cat; \
if [ "$STATUS" -ne 0 ] || grep -E "\\[STRICT-POLICY\\]|\\[EDGE-ORDER-VIOLATION\\]" "$OUT" >/dev/null; then \
  echo "❌ Aborting verification (example failed or strict-policy violation)."; \
  exit ${STATUS:-1}; \
fi; \
echo "▶️ Verify..." && \
npx tsx utils/verify-workflow-connections.ts | cat
```

---

## 🔧 Priority 2: Fork/Join Path-Only 마무리

### A-1. ExecutionService path 자동 주입/검증 강화
- [ ] `packages/agents/src/services/execution-service.ts`
  - [ ] emit 전 path 검증 로직 추가
  - [ ] clone tail(required) 누락 시 즉시 throw
  - [ ] 검증 에러 메시지 표준화

### A-2. WorkflowState 경량화
- [ ] `packages/workflow/src/services/workflow-state.ts`
  - [ ] 보류/임시 큐/배리어 관련 상태·API 제거
  - [ ] Path-Only 원칙에 맞게 단순화

### A-3. 이벤트 소유권 정비
**목표**: 이벤트 접두어를 원천적으로 보호하여 잘못된 소유권 사용 방지

> **중요**: 접두어 자동 부착/검증은 `ActionTrackingEventService` 같이 `EventService`를 확장한 구현에서만 제공된다. `EventService` 인터페이스의 기본 기능으로 간주하지 말고, Robota/ExecutionService/Tool 구현에서 반드시 이 확장 서비스를 주입하거나 clone하여 사용해야 한다. 기본 EventService를 직접 사용할 경우에는 접두어 검증이 수행되지 않으므로, 모든 emit 지점은 ownerPrefix 주입이 된 ActionTrackingEventService 인스턴스를 사용하도록 계획에 포함한다.

#### 현재 문제점
```typescript
// ❌ 현재: 어디서든 execution.* 이벤트를 발생시킬 수 있음
someService.emit('execution.start', data);  // 잘못된 소유권
toolService.emit('execution.complete', data);  // 잘못된 소유권
```

#### 해결 방안: Prefix Injection via Clone Pattern
**주입(Injection) 패턴 기반**: EventService를 외부에서 주입받고, clone 시 `ownerPrefix` 추가

```typescript
// 1️⃣ Robota Agent 생성 - 외부에서 EventService 주입
const agent = new Robota({
  name: 'MyAgent',
  eventService: workflowEventSubscriber,  // 외부에서 생성된 EventService 주입
  // ...
});

// 2️⃣ ExecutionService - 주입받은 EventService를 clone하면서 ownerPrefix 추가
class ExecutionService {
  constructor(
    aiProviders: AIProviderManagerInterface,
    tools: ToolManagerInterface,
    conversationHistory: ConversationHistory,
    eventService?: EventService,  // ✅ 외부에서 주입받음
    executionContext?: ToolExecutionContext
  ) {
    this.baseEventService = eventService || new SilentEventService();
    
    // 🎯 핵심: clone 시 ownerPrefix 주입
    const maybeClone = (svc: EventService, ownerPrefix: 'execution' | 'tool'): EventService => {
      const svcAny = svc as any;
      if (svcAny && typeof svcAny.clone === 'function') {
        // clone 메서드가 있으면 ownerPrefix와 함께 clone
        return svcAny.clone({ ownerPrefix, executionContext });
      }
      // 없으면 ActionTrackingEventService로 감싸서 ownerPrefix 주입
      return new ActionTrackingEventService(svc, undefined, executionContext, { ownerPrefix });
    };
    
    // execution.* 전용 EventService
    this.execEventService = maybeClone(this.baseEventService, 'execution');
    // tool.* 전용 EventService  
    this.toolEventService = maybeClone(this.baseEventService, 'tool');
  }
  
  async execute() {
    // 접두어 없이 나머지 부분만 사용
    this.execEventService.emit('start', data);      // 내부적으로 'execution.start'로 변환
    this.execEventService.emit('complete', data);   // 내부적으로 'execution.complete'로 변환
  }
}

// 3️⃣ Tool 구현체 - 동일 패턴 적용
class MyTool extends BaseTool {
  constructor(eventService?: EventService) {
    const toolEventService = eventService 
      ? eventService.clone?.({ ownerPrefix: 'tool' }) || eventService
      : new SilentEventService();
    
    this.eventService = toolEventService;
  }
  
  async execute() {
    // 접두어 없이 나머지 부분만 사용
    this.eventService.emit('call_start', data);     // 내부적으로 'tool.call_start'로 변환
    this.eventService.emit('call_complete', data);  // 내부적으로 'tool.call_complete'로 변환
  }
}
```

#### ActionTrackingEventService 내부 구현 (이미 완료)
```typescript
// packages/agents/src/services/event-service.ts
export class ActionTrackingEventService implements EventService {
  private readonly ownerPrefix?: string;
  private readonly strictPrefix: boolean;

  constructor(
    baseEventService?: EventService, 
    logger?: SimpleLogger, 
    executionContext?: ToolExecutionContext, 
    options?: { ownerPrefix?: string; strictPrefix?: boolean }
  ) {
    this.baseEventService = baseEventService || new SilentEventService();
    this.ownerPrefix = options?.ownerPrefix;
    this.strictPrefix = options?.strictPrefix ?? true;
  }

  emit(eventType: string, data: any): void {
    let fullEventType = eventType;
    
    // 🎯 접두어 자동 추가
    if (this.ownerPrefix && !eventType.includes('.')) {
      fullEventType = `${this.ownerPrefix}.${eventType}`;
    }
    
    // 🎯 접두어 검증 (다른 접두어 사용 시 에러)
    if (this.ownerPrefix && this.strictPrefix && eventType.includes('.')) {
      const [prefix] = eventType.split('.');
      if (prefix !== this.ownerPrefix) {
        throw new Error(
          `[EVENT-PREFIX-VIOLATION] Cannot emit '${eventType}'. ` +
          `This EventService owns '${this.ownerPrefix}.*' events only.`
        );
      }
    }
    
    // 실제 이벤트 발생
    this.baseEventService.emit(fullEventType, data);
  }
  
  // clone 메서드 지원
  clone(options?: { ownerPrefix?: string; executionContext?: ToolExecutionContext }): EventService {
    return new ActionTrackingEventService(
      this.baseEventService,
      this.logger,
      options?.executionContext || this.executionContext,
      { 
        ownerPrefix: options?.ownerPrefix || this.ownerPrefix,
        strictPrefix: this.strictPrefix
      }
    );
  }
}
```

#### 주요 흐름
```
1. 최상위: WorkflowEventSubscriber (모든 이벤트 수신)
           ↓ (주입)
2. Robota: eventService로 받음
           ↓ (주입)
3. ExecutionService: 받은 eventService를 clone
   - execEventService = clone({ ownerPrefix: 'execution' })
   - toolEventService = clone({ ownerPrefix: 'tool' })
           ↓
4. 각 서비스에서 emit 시:
   - this.execEventService.emit('start', data) → 'execution.start'
   - this.toolEventService.emit('call_start', data) → 'tool.call_start'
```

#### 장점
1. **원천 차단**: clone 시점에 접두어가 고정되어 변경 불가
2. **주입 패턴 유지**: 기존 DI 구조를 해치지 않음
3. **간결한 코드**: emit 시 `start` 대신 `execution.start` 반복 불필요
4. **명확한 소유권**: 각 서비스가 자신의 접두어만 사용
5. **Workflow 추적 호환**: WorkflowEventSubscriber가 모든 이벤트 수신 가능

#### 구현 체크리스트
- [x] `ActionTrackingEventService`에 `ownerPrefix` 옵션 추가 (이미 완료)
- [x] `emit()` 메서드에서 접두어 자동 추가 로직 구현 (이미 완료)
- [x] 잘못된 접두어 사용 시 에러 throw (이미 완료)
- [x] `ExecutionService`에 `maybeClone` 패턴 적용 (이미 완료)
- [ ] `Agent` (Robota)에서 자체 이벤트 발생 시 `ownerPrefix: 'agent'` 적용
- [ ] `Tool` 기본 클래스에 `ownerPrefix: 'tool'` 패턴 적용
- [ ] 기존 emit 호출부 수정 (접두어 제거)
  ```typescript
  // Before
  this.execEventService.emit('execution.start', data);
  
  // After  
  this.execEventService.emit('start', data);  // 'execution.' 자동 추가
  ```
- [ ] 타 모듈의 `execution.*` emit 전역 검사 및 제거
- [ ] ESLint 룰 추가: "하드코딩된 접두어 사용 금지"
- [ ] 단위 테스트 작성 (접두어 검증, 에러 케이스)
- [ ] 통합 테스트: 예제 26 가드 실행 및 검증

#### 참고 코드 위치
- `packages/agents/src/services/execution-service.ts` (line 142-154): maybeClone 구현
- `packages/agents/src/services/event-service.ts` (line 283-299): ActionTrackingEventService 생성자
- `packages/agents/src/agents/robota.ts` (line 514-520): EventService 주입

### A-4. Continued Conversation Path-Only
- [ ] ExecutionService(user_message) path = [rootId, executionId] 보장
- [ ] `response(last) → user_message(continues) → thinking(processes)` 시퀀스
- [ ] 예제 27 재검증

---

## 🎨 Priority 3: Playground Tools DnD

### B-1. 브릿지/레지스트리 보강
- [ ] `apps/web/src/lib/playground/robota-executor.ts`
  - [ ] executor 에러를 UI 표준 에러로 변환

### B-2. Tools 목록 관리(UI)
- [ ] `ToolItem` 타입 선언 및 유효성 체크
- [ ] `toolItems` 상태 초기값 및 setter
- [ ] 사이드바 카드 리스트 렌더 (스크롤/접근성)
- [ ] `+ Add Tool` 모달 (name, description)
- [ ] ID 생성 규칙 (kebab + 6자리 토큰) 및 중복 방지
- [ ] 추가 후 정렬 및 포커스 이동
- [ ] 삭제/이름변경 (선택)

### B-3. DnD 상호작용 보강
- [ ] 빠른 연속 드롭 디바운스
- [ ] 중복 드롭 시 UI 유지

### B-4. UI 오버레이 상태 (addedToolsByAgent)
- [ ] 타입 정의: `AddedToolsByAgent = Record<AgentId, string[]>`
- [ ] 상위 페이지 상태 `addedToolsByAgent` 구현
- [ ] `onToolDrop(agentId, tool)` 집합 추가
- [ ] `WorkflowVisualization`에 props 전달
- [ ] `AgentNode` 렌더 시 합집합 뱃지 표시
- [ ] 병합 규칙: SDK 도구 ∪ 오버레이 도구
- [ ] 성공/실패 토스트 표준화

### B-5. 수용 기준
- [ ] 드래그 시 Agent 노드 시각적 반응
- [ ] 드롭 시 툴 뱃지 즉시 추가 (중복 없음)
- [ ] Workflow Path-Only 보존

---

## 🗑️ Priority 4: Pricing 기능 제거 (무료 플랫폼 전환)

### Phase 1: Pricing UI 제거
- [ ] `/pricing` 라우트 및 관련 컴포넌트 삭제
- [ ] Header/Navigation에서 Pricing 링크 제거
- [ ] 모든 "Upgrade" 프롬프트 및 버튼 제거
- [ ] Dashboard에서 Plan 정보 섹션 제거

### Phase 2: Billing 로직 제거
- [ ] `/api/v1/billing/*`, `/api/v1/subscriptions/*` 엔드포인트 삭제
- [ ] `types/billing.ts` 및 관련 타입 제거
- [ ] `lib/billing/plans.ts`에서 paid plan 제거 (free만 유지)
- [ ] Firebase billing 컬렉션 사용 중단

### Phase 3: 무료 크레딧 시스템 전환
- [ ] `UserCredit` 타입 단순화
- [ ] Plan 기반 → 크레딧 기반 제한 로직 변경
- [ ] Usage Dashboard "Plan limits" → "Free usage limits"
- [ ] 제한 도달 시 친화적 메시지 (업그레이드 언급 제거)

### Phase 4: 설정 정리
- [ ] Stripe 관련 환경 변수 제거
- [ ] API 문서에서 billing 엔드포인트 제거
- [ ] 사용하지 않는 billing 타입 및 테스트 정리

---

## ✅ 성공 기준

### Agent Event Normalization
- [ ] Agent 노드 생성은 오직 `agent.created`
- [ ] `agent.execution_start`는 상태 전이만
- [ ] `tool.agent_execution_started` 완전 제거
- [ ] 예제 26 가드/검증 통과
- [ ] 하드코딩 문자열 없음 (상수만 사용)
- [ ] Fork/Join 다중 depth Path-Only 연결

### Fork/Join Path-Only
- [ ] `groupId`/`branchId`/`responseExecutionId` 제거
- [ ] WorkflowState 경량화 완료
- [ ] 이벤트 소유권 ESLint 룰 적용
- [ ] Continued Conversation 예제 27 통과

### Tools DnD
- [ ] 드래그앤드롭 동작 안정적
- [ ] 툴 뱃지 정확히 표시
- [ ] 중복/간섭 없음
- [ ] Path-Only 보존

### Pricing 제거
- [ ] UI에서 모든 pricing/billing 언급 제거
- [ ] API 엔드포인트 정리
- [ ] 무료 크레딧 시스템 동작
- [ ] Stripe 의존성 제거

---

## 📝 작업 진행 기록

**시작일**: 2025-10-16
**예상 완료**: 2025-10-30 (2주)

**주요 이슈**:
- Agent Event Normalization 85% 완료
- Fork/Join Path-Only 기초 완성, 정리 필요
- Tools DnD UI 작업 대기
- Pricing 제거는 독립적으로 진행 가능

**다음 단계**:
1. Agent Event Normalization 단계 3, 6.5, 6.6 완료
2. Fork/Join Path-Only 검증 스크립트 자동화
3. Tools DnD UI 구현 시작
4. Pricing 제거 (병렬 작업 가능)

