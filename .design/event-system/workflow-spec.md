# 워크플로우 스펙(최신) — Path-Only, 원자적 Fork/Join, DnD, 이벤트 정규화

본 문서는 워크플로우의 **현재 스펙**을 통합 정리한 문서입니다. 할 일 목록(체크리스트)은 `CURRENT-TASKS.md`의 [ ] 항목으로만 관리합니다.

## 1) Path-Only와 원자성(Atomicity)
- 모든 이벤트 처리에서 노드 생성과 엣지 연결은 같은 이벤트 처리 흐름 내에서 동시에 수행한다(원자성). 지연/보류/재시도/후속 보정 금지.
- 연결 판단은 오직 명시 필드만 사용한다. 기본 키는 `path: string[]`이며, 부모-자식 관계는 `parentPath = path.slice(0, -1)` 동일성으로만 결정한다.
- `prevId`/`parentId` 같은 별도 연결 메타는 저장하지 않는다. 관계는 엣지로만 표현한다.
- 이벤트명은 선언형 상수만 사용하고, 소유자 접두어 규칙을 준수한다(`execution.*`, `tool.*`, `agent.*`). 하드코딩 문자열 금지.

## 2) Path 주입과 검증
- 모든 이벤트에는 **absolute `context.ownerPath`**가 제공되어야 하며, 이것이 단일 정답 경로이다.
- `path: string[]`는 브릿지 계층에서 `context.ownerPath[].id`를 펼친 파생 값이며, 검증/핸들러는 ownerPath-only 설계를 전제로 한다.
- 클론/위임 시 tail 세그먼트는 필수(required)이며, 누락/공백이면 emit 직전 즉시 에러로 중단한다.
- 경로는 불변 확장 방식으로 누적된다.

## 3) Fork/Join 규격(즉시·무임시)
- Thinking: `execution.assistant_message_start`
- Tool Call: `tool.call_start`
- Response: `execution.assistant_message_complete`
- Tool Response: `tool.call_response_ready`(delegated agent의 Response 반영) → 해당 Response와 즉시 원자 연결
- Tool Result: 동일 thinking 스코프에서 모든 tool response 방출 직후 `execution.tool_results_ready` 단 1회 발생 → `tool_result` 생성과 동시에 모든 `tool_response[*] → tool_result(result)` 연결.
- 상위 흐름 진행 시 `tool_result → (다음 라운드)thinking(analyze)`로 연결하며, thinking으로 직접 점프하지 않는다.

## 4) 이벤트 소유권(Ownership)과 상수
- `execution.*`: ExecutionService만 emit/소유. 핸들러는 해당 상수를 import 하여 사용.
- `tool.*`: Tool 구현체만 emit/소유.
- `agent.*`: Agent 인스턴스만 emit/소유. 예: `agent.created`, `agent.execution_start`, `agent.config_updated`.
- 모든 emit/on은 상수 기반으로만 수행한다. 문자열 리터럴 사용 금지.

## 5) Playground DnD(도구 카드 → Agent 노드)
- 설계 목표: 사이드바 `Tools` 목록에서 카드를 캔버스의 특정 `agent` 노드로 드롭하면 해당 에이전트의 툴 설정(표시/반영 경로)이 일관되게 동작.
- 도메인 분리: UI는 이벤트를 직접 발생시키지 않으며, 에이전트 API만 호출한다(`updateTools`, `getConfiguration`).
- 카탈로그: 정적 `getPlaygroundToolCatalog()`로 목록을 렌더한다(동적 import 금지, 정적 매핑).
- DnD 데이터: `application/robota-tool` 타입으로 `{ id, name, description }` JSON 직렬화.
- 병합 표시: UI 오버레이 상태(`addedToolsByAgent`)와 SDK 제공 `data.tools`를 합집합으로 표시하되, 소스 오브 트루스는 SDK가 유지한다.
- Agent 식별: 노드의 명시 필드(`data.sourceId` 우선, 없으면 `node.id`)만 사용. ID 파싱/추론 금지.

## 6) 에이전트 이벤트 정규화(요지)
- Agent 자신이 자신의 생명주기를 선언한다: `agent.created`(생성), `agent.execution_start`(상태 전이), `agent.config_updated`(설정 갱신).
- Tool/Team은 Agent 상태를 대신 선언하지 않는다(대리 이벤트 발행 금지).
- Workflow 핸들러는 이벤트의 의도에 맞는 노드 생성/업데이트만 수행한다.

## 7) Progressive Reveal와 레이아웃(웹)
- Progressive Reveal: React Flow 렌더링 전 버퍼에서 순차적으로 노드/엣지를 500ms 간격으로 노출. 도메인 로직과 완전히 분리.
- Auto Layout: 측정된 노드 실제 높이/너비를 반영하여 Dagre 적용. 노드의 실제 높이가 달라도 엣지 간격은 고정(예: 100px)으로 유지되도록 정규화한다.
- 레이아웃 적용은 모든 노드가 측정된 시점에 1회 적용(부분 측정 상태에서의 적용 금지).

## 8) 성공 기준(요지)
- Path-Only/원자성/무임시/무폴백 정책 위반 0.
- 예제 26(팀), 연속 대화 케이스에서 올바른 시퀀스와 연결 보장.
- Playground DnD는 혼재 플로우에서도 일관 동작하며, SDK 그래프 구조에 영향을 주지 않는다(스냅샷 구독/표시만).


