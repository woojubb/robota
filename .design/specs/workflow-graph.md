# 워크플로우 그래프 스펙 (최신)

## 목표
- 노드/엣지 생성은 **이벤트 1건 처리 안에서 원자적으로** 수행한다.
- 연결 판단은 **명시 필드(특히 `context.ownerPath`)만** 사용한다.
- 지연/보류/재시도/임시 연결/추론은 금지한다.

## Node/Edge Creation Contract
- 링크 결정 우선순위:
  1. `context.ownerPath`
  2. 이벤트 owner 계약이 명시한 linkage 필드
- 아래 필드는 구조 결정에 사용하지 않는다:
  - `parentAgentId`, `childAgentId`, `delegatingAgentId`, `delegatedAgentId`
- 위 필드는 UI/분석 메타데이터로만 사용한다.

## 1) 노드 타입(개요)
- workflow graph의 node type 카탈로그는 `@robota-sdk/workflow`의 상수를 기준으로 한다.
- “특수 agent” 타입은 존재하지 않으며, 모든 agent는 동일 node type을 사용한다.

## 2) Fork/Join 표준 시퀀스(요약)
1. `execution.assistant_message_start` → `agent_thinking` 노드 생성 + 직전 `user_message`와 연결
2. `tool.call_start` → `tool_call` 노드 생성 + `thinking → tool_call(executes)` 연결
3. 위임된 실행의 `execution.assistant_message_complete` → `response` 생성 + `thinking → response(return)` 연결
4. `tool.call_response_ready` → `tool_response` 생성 + **`delegated response → tool_response(result)`** 연결
5. `execution.tool_results_ready` → `tool_result` 생성 + `tool_response[*] → tool_result(result)` 연결
6. 다음 라운드: `tool_result → thinking(analyze)` 연결

## 3) `agent.execution_start` 처리 규칙
- `agent.execution_start`는 **기존 agent 노드 상태 전이만** 수행한다.
- 노드 생성/엣지 생성은 하지 않는다.
- 대상 노드는 `context.ownerPath`의 agent 세그먼트 기준으로 결정한다.
- `context.ownerPath`가 없거나 agent 세그먼트가 식별 불가하면 즉시 실패한다(대체 경로 없음).

## 4) 실패 분류와 중단 정책
- `[STRICT-POLICY][EMITTER-CONTRACT]`
  - ownerPath/계약 필드 누락, handler contract 실패(`success: false`) 등
- `[STRICT-POLICY][APPLY-LAYER]`
  - node/edge create/update 적용 실패
- 두 분류 모두 즉시 중단하며, fallback/보완 경로를 두지 않는다.


