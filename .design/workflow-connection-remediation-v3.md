# 워크플로우 연결 개선 설계 v3.0

## 목적

- Load Agent Numbering System 버튼과 동일한 완벽한 워크플로우 구조 달성

## 현재 핵심 이슈 (요약)

- Tool Response → Merge Results 연결 단절
- Merge Results 노드 다중 생성 및 `connectedToolResponses: []`
- Agent Numbering System 미활성(모든 `agentNumber`가 null)
- Response 교차 연결(자기 Agent가 아닌 다른 Agent로 연결되는 문제)
- User Input 고립(시작점 연결 부재)

## 근본 원인 (요약)

- `toolResponsesByExecution`의 key 사용 불일치로 인한 추적 실패 (저장 vs 조회 key 상이)
- 이벤트 순서 불일치(merge_results가 tool_response보다 먼저 생성)
- executionId/sourceId/rootExecutionId 체계 혼선으로 추적 실패
- AgentCopyManager 미활용으로 agent 번호 메타데이터 누락

## 해결 전략 (Phase-by-Phase)

### Phase 1: Tool Response → Merge Results 연결 복구 (최우선)

- ID 추적 체계 통일: rootExecutionId 우선 사용으로 저장/조회 key 일관화
- 이벤트 순서 정렬: Tool execution 완료 후, 모든 Tool Response 수집 완료 시점에 Merge Results 생성
- `createMergeResultsNode` 보강: `connectedToolResponses`가 비어있지 않도록 보장하고 Tool Response → Merge Results 연결 생성

### Phase 2: Agent Numbering System 활성화

- Agent 생성 시 `agentCopyManager.assignAgentNumber()` 호출
- 생성 노드 메타데이터에 `agentNumber` 설정(Agent 0, 1, 2 순차 번호)
- 각 Agent 표준 구조 보장: Agent → Thinking → (Tool Call | Response)

### Phase 3: Agent Integration Instance 구현

- `agent_0_copy_1`를 Integration Instance로 사용하여 Tool Response 통합 지점 확보
- 각 Response는 자신의 Agent로만 연결(교차 연결 방지)
- 선형 흐름 보장: Response → Agent 0 Copy → Final Response

### Phase 4: 중복 및 고립 노드 제거

- Merge Results 단일화(중복 생성 방지)
- User Input → Agent 0 연결 복구로 시작점 명확화

## 성공 지표

- Tool Response 2개 모두 Merge Results와 연결
- 3개 Agent 모두 `agentNumber` 설정
- 교차 연결 0개(모든 Response가 올바른 Agent로 연결)
- Merge Results 1개로 단일화
- User Input이 Agent 0과 연결

## 목표 구조

```
User Input → Agent 0 → Thinking → Tool Call × 2
                                      ↓
                                Tool Response × 2
                                      ↓
                                Merge Results
                                      ↓
                                Agent 0 Copy
                                      ↓
                                Final Response
```

## 적용 순서

1) Tool Response 연결 복구 → 2) Agent Numbering 활성화 → 3) Integration Instance 구현 → 4) 중복/고립 정리


