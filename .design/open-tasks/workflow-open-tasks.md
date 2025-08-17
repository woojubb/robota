# 워크플로우 오픈 태스크(통합 체크리스트)

본 문서는 미완료 항목만 한데 모은 단일 체크리스트입니다. 완료된 스펙은 `.design/workflow-spec.md`에 정리되어 있습니다.

## A. Fork/Join Path-Only 리팩터링 잔여 (from workflow-fork-join-rules)
- [ ] 핸들러에서 `groupId`/`branchId`/`responseExecutionId` 사용 제거 및 path-only 전환
- [ ] `packages/workflow/src/services/workflow-state.ts`에서 보류/임시 큐/배리어 관련 상태·API 제거
- [ ] `AgentEventHandler` path-only 유지(생성 즉시 thinking → response(return) 원자 연결) 재검증
- [ ] `ToolEventHandler` path-only 유지(path.tail 기반 response 식별 → response → tool_response(result) 원자 연결) 재검증
- [ ] `ExecutionEventHandler`에서 tool_results_ready 처리 시 `tool_result` 생성 및 `tool_response[*] → tool_result(result)` 동시 연결, 필요 시 `tool_result → next thinking(analyze)` 확인
- [ ] `packages/agents/src/services/execution-service.ts`에 path 자동 주입/검증 강화(emit 전 path 검증, 클론 tail(required) 누락 시 즉시 throw)

### A-1. 에이전트 ↔ ExecutionService 이벤트 소유권 정비
- [ ] `execution.*` 이벤트의 단일 소유권을 `ExecutionService`로 고정 (타 모듈 emit 금지)
- [ ] `packages/agents/src/plugins/event-emitter-plugin.ts`에서 `execution.*`/`tool.*` emit 기능 제거 또는 기본 비활성화
- [ ] 코드베이스 전역에서 `emit('execution.` 패턴이 `execution-service.ts` 외부에 존재하지 않음을 검사하고 이전
- [ ] ESLint/검증 스크립트에 "ExecutionService 외 `execution.*` emit 금지" 룰 추가

### A-2. EventService Prefix Injection 모델(도입 제안)
- [ ] EventService 생성자/clone API에 `ownerPrefix` 옵션 추가 및 내부 검증 구현
- [ ] 상위 컨테이너 → 하위 객체 생성 시 `clone({ ownerPrefix })` 체인 적용(agents/tool/team 레이어)
- [ ] 기존 emit 호출부에서 상수만 전달하는지 재검토(문자열 조합 제거 확인)
- [ ] 검증 에러 메시지 표준화: "[EVENT-PREFIX-VALIDATION] Expected prefix 'execution.' but received 'tool.*' (owner=execution)"

### A-3. Continued Conversation Path-Only 계획
- [ ] ExecutionService(user_message) path = [rootId, executionId] 보장
- [ ] ExecutionEventHandler.user_message → id = path.tail, response(last) → user_message(continues) 연결
- [ ] ExecutionEventHandler.assistant_message_start → user_message(last same root) → thinking(processes)
- [ ] Subscriber Path Map 사용 범위 최소화(읽기 전용·명확 키)
- [ ] Edge 타입 컨벤션 반영 및 문서화
- [ ] 예제 27/26 재검증 (Strict 정책 위반 0)

---

## B. Playground Tools DnD — 남은 UI/브릿지 작업 (from playground-tools-dnd-plan)
### B-1. 브릿지/레지스트리 보강
- [ ] `apps/web/src/lib/playground/robota-executor.ts`에서 에러를 UI 표준 에러로 변환(사용자 메시지화)

### B-2. Tools 목록 관리(UI)
- [ ] `ToolItem` 타입 선언 및 유효성 체크(helper)
- [ ] `toolItems` 상태 초기값 및 setter 준비
- [ ] 사이드바 카드 리스트 렌더(스크롤/접근성 고려)
- [ ] `+ Add Tool` 모달(간이 폼: name, description)
- [ ] ID 생성 규칙(소문자 kebab + 6자리 토큰) 및 중복 방지 로직
- [ ] 추가 후 정렬(알파벳/최근 순 택1) 및 포커스 이동
- [ ] 삭제/이름변경(선택)
- [ ] 폼 유효성(이름 1~64자, `[a-zA-Z0-9_-]`) 및 검색/정렬(선택)

### B-3. DnD 상호작용 보강
- [ ] 빠른 연속 드롭 디바운스(옵션), 중복 드롭 시 UI 유지

### B-4. UI 오버레이 상태(addedToolsByAgent)
- [ ] 타입 정의 `AddedToolsByAgent = Record<AgentId, string[]>`
- [ ] 상위 페이지 상태 `addedToolsByAgent` 구현 및 초기화
- [ ] `onToolDrop(agentId, tool)`에서 집합 추가(중복 제거)
- [ ] `WorkflowVisualization`에 `onToolDrop`/`addedToolsByAgent` prop 전달
- [ ] `AgentNode` 렌더 시 `data.tools ∪ addedToolsByAgent[agentId]` 합집합 뱃지 표시
- [ ] 툴 제거 UI(선택): 뱃지 X 버튼으로 해제 기능
- [ ] 병합 규칙 구현: SDK 도구 ∪ 오버레이 도구(이름 기준, 대소문자 무시, SDK 우선)
- [ ] 성공/실패 토스트 표준화

### B-5. 혼재 플로우 호환성 검증(기초)
- [ ] 예제 27(싱글): 여러 Agent 동시 표시 환경에서 각자 독립 동작
- [ ] 예제 26(팀): 포크/조인 상태의 타겟팅 정확성 및 간섭 없음
- [ ] 툴 파생 서브 플로우 유무에 따른 일관 동작
- [ ] 빠른 연속 드롭(디바운스/중복 방지) 동작 확인

### B-6. 수용 기준(기능)
- [ ] 드래그 시 Agent 노드 시각적 반응
- [ ] 드롭 시 해당 Agent에 툴 뱃지 즉시 추가(중복 없음)
- [ ] Tools 목록 신규 항목도 동일 동작
- [ ] Workflow 렌더/구독/경로 규칙 영향 없음(Path-Only 보존)
- [ ] 코드 스타일/훅 규칙/이벤트 소유권 위반 없음

---

## C. Agent Event Normalization — 잔여 단계 (from agent-event-normalization-checklist)
### C-0. 준비 및 감사(Audit)
- [ ] 이벤트 소유/상수 정의 점검(AGENT_EVENTS/EXECUTION_EVENTS/TOOL_EVENTS)
- [ ] 잘못된 사용 사례 식별(`tool.agent_execution_started` 등 대리 이벤트 발행/처리)

### C-1. 비파괴적 정렬 — execution_start는 상태 전이 우선(임시 생성은 ‘없을 때만’)
- [ ] `agent.execution_start` 수신 시 기존 Agent 노드가 있으면 상태만 갱신
- [ ] 기존 Agent 노드가 없을 때만 임시 생성(하위 호환). 추후 완전 제거 예정

### C-2. 결과 동등성/지표 검증(예제 26)
- [ ] 핵심 노드 타입 수 점검으로 구조 안정성 확인(에이전트/생각/응답/tool_response)
- [ ] Agent 노드가 기본적으로 `agent.created`에서 생성되는지 확인
- [ ] 실행 시작은 상태 전이만 일어나는지 확인(노드 중복 생성 없음). 과도기엔 ‘없을 때만 임시 생성’ 가능
- [ ] tool 이벤트로 Agent 노드가 중복 생성되지 않는지 확인(있으면 무시)

### C-3. Fork/Join Path-Only 연결 교정 — round2 thinking 입력 규칙
- [ ] `execution.assistant_message_start`에서 연결 소스 결정 규칙 교정(명시 필드만 사용)
- [ ] 동일 `rootExecutionId` 내 `timestamp` 기반 직전 thinking 결정(최신)
- [ ] `tool_result` 중 `data.parentThinkingNodeId === prevThinking.id`인 노드가 있으면 `tool_result → currentThinking`(analyze)
- [ ] 미발견(초회 등) 시 `user_message → currentThinking`(processes)
- [ ] 조회는 `getAllNodes()` 스캔 또는 읽기 전용 Path Map Reader로 한정(의미 동일)

### C-4. 단일 전환 단계(Decision Gate) — 새 이벤트로 완전 대체
- [ ] Agent 핸들러: `agent.execution_start`는 상태 전이만, ‘없을 때만 임시 생성’ 완전 제거
- [ ] 팀/툴 발행자: `tool.agent_execution_started` 관련 발행/상수 완전 제거(팀 도메인)

### C-5. 최종 정리
- [ ] 팀/툴 상수 모듈의 미사용 상수 완전 삭제
- [ ] 관련 주석/문서 업데이트(이벤트 소유/명명/의도-노드 일치 명시)

### C-6. Subscriber Path Map Reader(선택)
- [ ] Path-Only 기반 읽기 전용 인덱스 Reader 도입/적용(의미 변화 없음)
- [ ] Reader 제거 후 `getAllNodes()` 직접 스캔과 결과 동등성 샘플 검증

### C-7. 최종 성공 기준
- [ ] Agent 노드 생성은 오직 `agent.created`
- [ ] `agent.execution_start`는 상태 전이만(노드 생성 금지)
- [ ] Tool/Team은 Agent 상태 대리 선언 금지(`tool.agent_execution_started` 제거)
- [ ] 예제 26 가드/검증 통과 및 노드/엣지 구조 의도 일치
- [ ] 모든 이벤트는 상수만 사용; 하드코딩 문자열 없음
- [ ] Fork/Join 다중 depth에서도 Path-Only 연결 결정(읽기 전용 Path Map 허용)


