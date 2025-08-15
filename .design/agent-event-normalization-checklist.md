# Agent Event Normalization – Incremental Plan (Checklist)

본 문서는 기존 로직에 영향을 최소화하며 점진적으로 적용한 뒤, 마지막에 최종 목표(올바른 이벤트 소유/명명/노드 생성 기준 확립)를 달성하기 위한 상세 체크리스트입니다. 각 단계는 작은 범위로 나뉘며, 각 단계 후 반드시 빌드 및 예제 26 가드 실행 → 검증 스크립트 실행으로 확인합니다.

핵심 원칙 (강제)
- [ ] agent.*: Agent 자신만 emit. 의도 = 이벤트 = 노드
  - agent.created → Agent 노드 생성
  - agent.execution_start → 상태 전이(예: running), 노드 생성 금지
- [ ] tool.*: Tool만 emit. Agent의 상태(생성/실행)를 대신 선언 금지
- [ ] execution.*: Tool execution 흐름만 관장. Agent 생명주기와 분리
- [ ] 이벤트는 반드시 선언형 상수로만 사용 (하드코딩 금지)

검증 규칙 (항상)
- [ ] 변경 후 즉시 빌드 (패키지 단위 → 전체 영향 패키지)
- [ ] apps/examples에서 26번 예제 “가드” 실행 (실패/정책 위반 시 검증 중단)
- [ ] 가드 통과 시에만 `utils/verify-workflow-connections.ts` 실행

빌드/검증 표준 명령 (복붙용)
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

## 단계 0. 준비 및 감사(Audit)
- [ ] 이벤트 소유/상수 정의 점검 (참고: event-driven-architecture 규칙)
  - [ ] `packages/agents/src/agents/constants.ts` (AGENT_EVENTS)
  - [ ] `packages/agents/src/services/execution-service.ts` (EXECUTION_EVENTS)
  - [ ] `packages/team/src/events/constants.ts` 또는 툴 이벤트 상수 정의 위치 (TOOL_EVENTS)
- [ ] 잘못된 사용 사례 식별
  - [ ] `tool.agent_execution_started` 발행/처리 위치 전수 확인
  - [ ] agent 노드 생성이 agent.created가 아닌 다른 이벤트에서 발생하는 경로 확인

결과를 바탕으로 아래 단계 적용

---

## 단계 1. 최소 추가 – Agent가 스스로 올바른 이벤트 emit 보장 (추가만)
목표: 기존 데이터 흐름을 깨지 않고, Agent가 생성/실행 이벤트를 스스로 발생시키도록 먼저 보장

- [x] `packages/agents/src/agents/robota.ts`
  - [x] 생성 직후(초기화 완료 시점) `AGENT_EVENTS.CREATED` emit 보장 (상수만 사용)
  - [x] 실행 시작 시 `AGENT_EVENTS.EXECUTION_START` emit 보장 (상수만 사용)

- [x] 빌드/가드/검증 실행 (위 표준 명령)

검증 방법
- [x] 예제 26 가드가 실패하지 않는지 확인 (STRICT-POLICY/EDGE-ORDER-VIOLATION 미노출)
- [x] 실행 로그(가드 출력 파일)에 `agent.created`, `agent.execution_start`가 발생했는지 검색
```bash
cd /Users/jungyoun/Documents/dev/robota/apps/examples && \
tail -n 400 cache/26-playground-edge-verification-*-guarded.log | grep -E "agent\.created|agent\.execution_start" | cat
```
- [ ] 실패 시 조치: emit 위치/상수 사용 여부 재검토(하드코딩 금지), 이벤트 에러 처리 여부 확인

---

## 단계 2. 최소 추가 – Agent.created에서 Agent 노드 생성 (추가만, 제거 없음)
목표: 실행을 시작하지 않아도 Agent 생성 시점에 Agent 노드가 반드시 생기도록 “추가”만 먼저 수행

- [x] `packages/workflow/src/handlers/agent-event-handler.ts`
  - [x] `agent.created` 처리 추가: 이 시점에서 “Agent 노드 생성”
  - [x] 생성 규칙: 
    - id, type=agent, timestamp(숫자) 부여
    - 필요 시 `parentExecutionId` 연결(있다면), 엣지는 방어적 생성 금지 원칙에 따라 최소화
  - [x] 기존 분기/기능 제거 없음 (충돌 없는 추가만)

- [x] 빌드/가드/검증 실행

검증 방법
- [x] 예제 26 가드 통과 확인
- [x] 데이터 파일에서 Agent 노드 존재 확인
```bash
cd /Users/jungyoun/Documents/dev/robota/apps/examples && \
jq '.workflow.nodes[] | select(.type=="agent") | {id,type,data:{eventType:.data.eventType,sourceId:.data.sourceId}}' data/real-workflow-data.json | head -n 20 | cat
```
- [x] 동일 sourceId로 중복 Agent 노드가 없는지 확인

---

## 단계 3. Agent가 스스로 올바른 이벤트를 emit하도록 보장
목표: Agent 자신이 생성/실행 이벤트를 정확히 발생

- [x] `packages/agents/src/agents/robota.ts`
  - [x] 생성 직후(초기화 완료 시점) `AGENT_EVENTS.CREATED` emit 보장
  - [x] 실행 시작 시 `AGENT_EVENTS.EXECUTION_START` emit 보장
  - [x] 하드코딩 문자열 금지, 상수만 사용

- [x] 빌드/가드/검증 실행

검증 방법
- [x] 예제 26 가드 통과 확인
- [x] 로그에서 `agent.execution_start` 처리에 에러/경고가 없는지 확인
```bash
cd /Users/jungyoun/Documents/dev/robota/apps/examples && \
tail -n 400 cache/26-playground-edge-verification-*-guarded.log | grep -E "AGENT-HANDLER|agent\.execution_start" | cat
```
- [x] 그래프 구조(Agent 노드 수)가 단계 2 대비 변하지 않는지 확인

---

## 단계 3. 비파괴적 정렬 – Agent.execution_start는 ‘상태 전이 우선’, 생성은 ‘없을 때만’ (하위 호환)
목표: 기존 데이터 구조를 깨지 않기 위해, 실행 시작 시점엔 노드가 있으면 상태만 갱신, 없으면 “임시로” 생성 (추후 제거 예정)

- [ ] `packages/workflow/src/handlers/agent-event-handler.ts`
  - [ ] `agent.execution_start` 수신 시:
    - [ ] 기존 Agent 노드가 있으면 status=running 등 상태만 갱신
    - [ ] 기존 Agent 노드가 없을 때만 “임시 생성” (하위 호환용)

- [ ] 빌드/가드/검증 실행

검증 방법
- [ ] 예제 26 가드 통과 확인
- [ ] Agent 노드 수 점검(중복 증가 없음)
```bash
cd /Users/jungyoun/Documents/dev/robota/apps/examples && \
jq '[.workflow.nodes[] | select(.type=="agent")] | {agentCount: length}' data/real-workflow-data.json | cat
```
- [ ] 임시 생성이 발생해도 검증 스크립트 실패가 아닌 통과하는지 확인

---

## 단계 4. 비파괴적 억제 – Tool 핸들러의 Agent 노드 중복 생성 방지 (하위 호환)
목표: 도구 이벤트(`tool.agent_execution_started`)가 여전히 들어와도, 이미 Agent 노드가 있으면 아무것도 하지 않음(로그만). 기존 데이터 구조는 유지

- [x] `packages/workflow/src/handlers/tool-event-handler.ts`
  - [x] `tool.agent_execution_started` 처리에서:
    - [x] Agent 노드 존재 시: 상태 갱신 또는 무시(로그)
    - [x] Agent 노드 미존재 시: (임시) 생성 유지 → 이후 단계에서 제거 예정

- [x] 빌드/가드/검증 실행

검증 방법
- [x] 예제 26 가드 통과 확인
- [x] 로그에서 `tool.agent_execution_started` 처리 시 중복 생성이 없는지 확인
```bash
cd /Users/jungyoun/Documents/dev/robota/apps/examples && \
tail -n 400 cache/26-playground-edge-verification-*-guarded.log | grep -E "TOOL-HANDLER|tool\.agent_execution_started|createAgentExecutionStartedNode" | cat
```
- [ ] 데이터 파일에서 Agent 노드 수가 이전 단계 대비 증가하지 않았는지 확인

---

## 단계 5. 발행자 측 제거 – 도구측 대리 이벤트 발행 제거 (점진)
목표: 툴/팀 계층에서 agent 실행을 대신 알리는 이벤트를 더 이상 발행하지 않도록 수정 (발행자 제거)

- [x] `packages/team/src/task-assignment/tool-factory.ts`
  - [x] `tool.agent_execution_started` emit 호출 제거 (N/A: emit 호출 존재하지 않음 확인)
- [x] `packages/team/src/services/sub-agent-event-relay.ts` (사용 시)
  - [x] 동일한 emit 호출 제거 (N/A: emit 호출 존재하지 않음 확인)
- [x] `packages/team/src/events/constants.ts` (상수 위치 존재 시)
  - [x] 상수는 바로 삭제 대신 “미사용(Deprecated)” 주석 표시 (후속 최종 단계에서 제거) (N/A: 관련 상수 모듈 미사용 상태)

- [x] 빌드/가드/검증 실행

검증 방법
- [x] 예제 26 가드 통과 확인
- [x] 실행 로그에 `tool.agent_execution_started`가 더 이상 나타나지 않는지 확인(0건)
```bash
cd /Users/jungyoun/Documents/dev/robota/apps/examples && \
! tail -n 400 cache/26-playground-edge-verification-*-guarded.log | grep -i "tool\.agent_execution_started"
```

---

## 단계 6. 예제 26 동작/데이터 동등성 확인
목표: 변경 후에도 예제 26이 동일하거나 더 올바른 노드/엣지를 생성하는지 확인

- [x] apps/examples 26번 예제 가드 실행
- [x] `utils/verify-workflow-connections.ts` 실행
- [ ] 결과 비교: 

검증 방법
- [x] 검증 스크립트 출력에 실패 메시지(STRICT-POLICY/EDGE-ORDER-VIOLATION) 없음
- [ ] 핵심 노드 타입 수 점검으로 구조 안정성 확인
```bash
cd /Users/jungyoun/Documents/dev/robota/apps/examples && \
jq '{
  agent:  [.workflow.nodes[] | select(.type=="agent")] | length,
  thinking:[.workflow.nodes[] | select(.type=="agent_thinking")] | length,
  response:[.workflow.nodes[] | select(.type=="response")] | length,
  toolResp:[.workflow.nodes[] | select(.type=="tool_response")] | length
}' data/real-workflow-data.json | cat
```
  - [ ] Agent 노드가 기본적으로 `agent.created`에서 생성되는지
  - [ ] 실행 시작은 상태 전이만 일어나는지(노드 중복 생성 없음). 단, 과도기에는 ‘없을 때만 임시 생성’이 남아있을 수 있음
  - [ ] tool 이벤트로 agent 노드가 중복 생성되지 않는지(있을 경우 무시)

---

## 단계 6.6. Fork/Join Path-Only 연결 교정 – round2 thinking은 직전 scope의 tool_result에서 analyze로 연결
목표: 다중 depth fork/join 상황에서도 Path-Only로 round2(이후 라운드) thinking의 입력을 올바르게 결정

- [ ] `packages/workflow/src/handlers/agent-event-handler.ts`
  - [ ] `case execution.assistant_message_start`에서 연결 소스 결정을 다음 규칙으로 교정 (Path-Only, 보조 메모리/지연/폴백 금지):
    - [ ] 현재 이벤트의 명시 필드(`rootExecutionId`, `timestamp`, `path`)와 이미 생성된 노드의 명시 필드만 사용
    - [ ] 동일 `rootExecutionId` 내에서 `timestamp < currentThinking.timestamp`인 `agent_thinking` 노드 중 가장 최근(최대 timestamp) 노드를 prevThinking으로 선택 (ID 파싱/정규식 금지)
    - [ ] `tool_result` 노드 중 `data.parentThinkingNodeId === prevThinking.id`인 노드를 조회하여 존재하면 이를 source로 `analyze` 엣지 생성: `tool_result → currentThinking`
    - [ ] 위 조건에서 미발견(초회 등) 시에만 기존 규칙대로 `user_message → currentThinking`를 `processes`로 연결
  - [ ] 노드 조회는 `subscriber.getAllNodes()` 스캔 또는 (아래 8단계에 정의하는) Path Map Reader의 읽기 전용 메서드를 사용할 수 있음(의미 동일 보장)

- [ ] 빌드/가드/검증 실행

검증 방법
- [ ] 예제 26 가드 통과 확인
- [ ] 데이터에서 round2 연결 확인: `tool_result → thinking_round2 (analyze)` 존재
```bash
cd /Users/jungyoun/Documents/dev/robota/apps/examples && \
jq '.workflow.edges[] | select(.type=="analyze") | {source, target}' data/real-workflow-data.json | cat
```
- [ ] 응답 연결 유지: `thinking_round2 → response (return)` 존재
```bash
cd /Users/jungyoun/Documents/dev/robota/apps/examples && \
jq '.workflow.edges[] | select(.type=="return") | {source, target}' data/real-workflow-data.json | cat
```

---

## 단계 6.5. 단일 전환 단계(Decision Gate) — 새 이벤트로 완전 대체 (원클릭 검증/되돌리기 단위)
목표: 임시/하위호환 로직 일체 제거 후, 새 이벤트 흐름으로 완전 대체를 ‘단일 커밋’으로 묶어 적용·검증. 실패 시 해당 커밋만 즉시 되돌리기.

- [ ] 워크플로우(Agent 핸들러): `packages/workflow/src/handlers/agent-event-handler.ts`
  - [ ] `agent.created`에서만 Agent 노드 생성 (유지)
  - [ ] `agent.execution_start`는 상태 전이만 수행 (노드 생성 절대 금지)
  - [ ] 단계 3에서 남겨둔 “없을 때만 임시 생성” 하위호환 로직 완전 제거

- [x] 워크플로우(Tool 핸들러): `packages/workflow/src/handlers/tool-event-handler.ts`
  - [x] `tool.agent_execution_started` 관련 모든 처리/노드 생성/상태 갱신 분기 완전 삭제

- [ ] 팀/툴 발행자: 
  - [ ] `packages/team/src/task-assignment/tool-factory.ts` — `tool.agent_execution_started` emit 완전 제거
  - [ ] `packages/team/src/services/sub-agent-event-relay.ts` — 동일한 emit 존재 시 제거
  - [ ] `packages/team/src/events/constants.ts`(또는 툴 이벤트 상수 정의 파일) — `AGENT_EXECUTION_STARTED` 상수 제거

- [x] 빌드/가드/검증 (원샷 검증)
  - [x] 표준 빌드·가드 명령으로 예제 26 실행
  - [x] 검증 스크립트 통과 확인 (노드/엣지 일치, 중복 생성 없음)

검증 방법
- [ ] 실행 로그와 데이터에서 `tool.agent_execution_started`가 완전히 사라졌는지 확인(0건)
```bash
cd /Users/jungyoun/Documents/dev/robota/apps/examples && \
! tail -n 400 cache/26-playground-edge-verification-*-guarded.log | grep -i "tool\.agent_execution_started" && \
! jq -r '.workflow.nodes[]?.data?.eventType' data/real-workflow-data.json | grep -i "tool.agent_execution_started"
```
- [ ] Agent 노드 생성이 오직 `agent.created` 흐름에서만 일어나는지 확인(샘플 점검)
```bash
cd /Users/jungyoun/Documents/dev/robota/apps/examples && \
jq '.workflow.nodes[] | select(.type=="agent") | {id, createdFrom: .data.eventType}' data/real-workflow-data.json | head -n 10 | cat
```

- [ ] 되돌리기 가이드(실패 시 즉시 복구)
  - [ ] 이 단계 변경을 하나의 커밋으로 묶어두었으므로, 실패 시 해당 커밋만 되돌립니다(예: Git revert 최근 커밋)
  - [ ] 필요 시 아래 항목만 원복
    - [ ] Agent 핸들러의 ‘없을 때만 임시 생성’ 로직 복구
    - [ ] Tool 핸들러의 `tool.agent_execution_started` 분기 복구
    - [ ] 팀/툴의 emit 복구 및 TOOL 상수 복구

---

## 단계 7. 최종 정리(영향 무관, 목표 달성용 마무리)
목표: 호환성 단계 요소, Deprecated 상수/분기 완전 제거 및 문서/주석 정리

- [x] `packages/workflow/src/handlers/tool-event-handler.ts`
  - [x] `tool.agent_execution_started` 관련 분기/유틸 완전 삭제 (노드 생성/상태 갱신 포함)
- [ ] `packages/team/src/events/constants.ts` (또는 TOOL 상수 모듈)
  - [ ] 미사용 상수 완전 삭제
- [ ] 관련 주석/문서 업데이트: 이벤트 소유/명명/의도-노드 일치 원칙 명시

- [x] 빌드/가드/검증 최종 실행 (모든 변경 완료 상태)

---

## 단계 8. (우선순위 낮음) Subscriber Path Map Reader 도입 – 읽기 전용 인덱스 객체화
목표: Path-Only 규칙을 지키면서 노드 조회 성능/가독성을 높이기 위한 읽기 전용 인덱스 레이어 추가 (의미 변화 없음)

- [ ] 객체 설계: `PathMapReader` (읽기 전용)
  - [ ] 생성 근거: 이벤트 payload의 `path` 및 노드의 `data.extensions.robota.originalEvent.path` 같은 “명시 필드”만으로 인덱스 구축
  - [ ] 제공 메서드(예시):
    - [ ] `getNodesByRoot(rootId: string): WorkflowNode[]`
    - [ ] `getLatestNodeBefore(rootId: string, type: string, beforeTs: number): WorkflowNode | undefined`
    - [ ] `getToolResultForThinking(thinkingId: string): WorkflowNode | undefined`
  - [ ] 금지: 상태 저장("lastX"), 대기/지연/재시도, ID 파싱/정규식 기반 추론, 의미 변조
  - [ ] 실패 시: 조회 실패는 그대로 반환(폴백 금지)

- [ ] 적용 위치: `agent-event-handler.ts` 등 조회가 잦은 핸들러의 내부 조회를 Reader 호출로 치환 (동일 의미 보장)

- [ ] 빌드/가드/검증 실행 (의미 동일성 유지 확인)

검증 방법
- [ ] 예제 26 가드 통과
- [ ] Reader 제거 후 `getAllNodes()` 직접 스캔과 결과가 완전히 동일함을 샘플 검증

---

## 성공 기준
- [ ] Agent 노드 생성은 오직 `agent.created`에서만 수행
- [ ] `agent.execution_start`는 상태 전이만 수행 (노드 생성 금지)
- [ ] Tool/Team은 Agent 상태를 대신 선언하지 않음 (특히 `tool.agent_execution_started` 제거)
- [ ] 예제 26 가드/검증 통과 및 노드/엣지 구조 의도 일치
- [ ] 모든 이벤트는 선언형 상수만 사용; 하드코딩 문자열 없음
- [ ] Fork/Join 다중 depth에서도 Path-Only로 연결이 결정됨(조회 전용 Path Map 사용 허용)


