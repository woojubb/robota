# Agent Execution Start Spec (최신)

> 이 문서는 `agent.execution_start` 이벤트 처리에 대한 **현재 스펙만** 정의합니다(진행 단계/히스토리 기록 없음).

## 목표
- `agent.execution_start`는 **기존 agent 노드의 상태 전이만** 수행한다.
- 노드 생성/임시 생성/보정 경로는 존재하지 않는다(단일 경로).

## 입력(필수)
- `context.ownerPath`: absolute full path
  - 최소 조건: ownerPath 안에 `{ type: 'agent', id: <agentId> }` 세그먼트가 포함되어야 한다.

## 처리 규칙
1) 대상 agent 노드 식별
- `context.ownerPath`에서 agent 세그먼트를 기준으로 대상 노드를 결정한다.
- ID 파싱/정규식/캐시 기반 추론은 금지한다.

2) 상태 전이
- `agent.execution_start`는 대상 agent 노드의 `status`를 갱신하고 `statusHistory`에 기록한다(도메인 데이터만).
- 엣지는 생성하지 않는다.

3) Timestamp
- 동일 스코프 내에서 timestamp는 단조 증가를 유지한다.

## 실패 조건
- `context.ownerPath`가 없거나, agent 세그먼트가 식별 불가능하면 즉시 실패한다(대체 경로 없음).
