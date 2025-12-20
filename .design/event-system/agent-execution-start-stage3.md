# Agent Execution Start 단계 3 시뮬레이션 기록

> 목적: `agent.execution_start` 이벤트가 기존 Agent 노드의 상태 전이만 수행하도록 Path-Only 규칙, Timestamp 규칙, WorkflowState 업데이트 요건을 명확히 문서화한다. 이 문서의 내용을 기준으로 CURRENT-TASKS Priority 1 단계 3 구현/검증을 진행한다.

## 1. 기본 시나리오 (예제 26, assignTask fork)

```
user_message(root) → thinking_round1 → tool_call(assignTask)
                           │
                           ├─(delegated)→ delegated agent user_message → delegated agent thinking → delegated agent response
                           │
                           ├─(delegated)→ delegated agent user_message → delegated agent thinking → delegated agent response
                           │
                           └→ tool_results_ready → tool_result → thinking_round2 → final_response
```

## 2. 이벤트 순서 및 요구 사항

| 순번 | 이벤트 상수 | Path 예시 | 생성/갱신 대상 | 필수 Edge | Timestamp 규칙 |
| --- | --- | --- | --- | --- | --- |
| 1 | `execution.user_message` | `[agentId, execId]` | `user_message` 노드 | 없음(루트) | `ts0` (시작) |
| 2 | `execution.assistant_message_start` | `[agentId, execId, thinkingId]` | `thinking_round1` 노드 | `user_message → thinking (processes)` | `ts0 + 1` |
| 3 | `tool.call_start` | `[agentId, execId, thinkingId, toolCallId]` | `tool_call` 노드 | `thinking_round1 → tool_call (executes)` | `ts0 + 2` |
| 4 | `agent.created` (delegated) | `[agentId, execId, thinkingId, toolCallId, delegatedAgentId]` | delegated agent 노드 | `tool_call → delegated agent (creates)` | `ts_child_0` |
| 5 | `agent.execution_start` (delegated) | 동일 path | **기존 Agent 노드 상태만 갱신** | 엣지 생성 없음 | `ts_child_0 + ε` (기존 노드보다 큼) |
| 6 | `execution.assistant_message_complete` (delegated) | `[delegatedAgentId, delegatedExecId, delegatedThinkingId, delegatedResponseId]` | delegated response | `delegated thinking → delegated response (return)` | 증가 |
| 7 | `tool.call_response_ready` | `[agentId, execId, thinkingId, toolCallId]` | `tool_response` | `delegated response → tool_response (result)` | `ts_parent_next` |
| 8 | `execution.tool_results_ready` | `[agentId, execId, thinkingId]` | `tool_result` | 모든 `tool_response → tool_result (result)` | `ts_parent_next + ε` |
| 9 | `execution.assistant_message_start` (round2) | `[agentId, execId, thinkingId_round2]` | `thinking_round2` | `tool_result → thinking_round2 (analyze)` | `ts_parent_next + 2ε` |
| 10 | `execution.assistant_message_complete` (final) | `[agentId, execId, thinkingId_round2, responseId_round2]` | 최종 response | `thinking_round2 → response (return)` | 증가 |

## 3. Path-Only 규칙 요약
- 부모/자식 결정은 `parentPath = path.slice(0, -1)` 일치 여부만 사용한다.
- `agent.execution_start` 이벤트에는 executionId/rootExecutionId가 없더라도 `sourceId` 기반 동일 Agent 노드를 찾아야 한다.
- 임시 생성 fallback은 금지한다. 연결 정보가 부족하면 즉시 실패로 처리하고, emitter/handler 설계를 수정한다.

## 4. WorkflowState 업데이트 시나리오
1. `agent.created`
   - `agentNodeIdMap.set(sourceId, agentNodeId)`
   - `WorkflowState.setAgentForExecution(executionId, agentNodeId)`
2. `agent.execution_start`
   - 기존 agentNodeId 재활용 → `WorkflowState.setAgentForExecution(executionId)` 재호출
   - rootExecutionId 제공 시 `setAgentForRoot`도 동기화
   - 상태 히스토리에 `running` 이벤트 append
3. Fallback 발생 시
   - 새 노드 생성 직후 위 2개 매핑을 즉시 업데이트
   - `// TODO(step 6.5)` 주석 및 `logger.warn('[LEGACY-FALLBACK] agent.execution_start created node')`

## 5. Timestamp 규칙
- 동일 path 내에서 새 노드는 항상 직전 노드보다 1 이상 큰 정수 timestamp를 부여한다. (`tool_result_ts > tool_response_ts_max`)
- round2 thinking은 `tool_result_ts + 1` 이상이어야 하며, 이후 response는 thinking보다 큰 timestamp를 갖는다.
- Fallback 생성 시에도 이 규칙을 지키기 위해 `WorkflowState.getMaxTimestamp()` 도움 메서드가 필요하면 활용한다.

## 6. Guard 검증 체크리스트
- Start node는 1개(`user_message`)만 생성되어야 한다.
- `agent.execution_start` 이벤트 처리 이후 Agent 노드 수 증가가 없어야 한다.
- `logger.warn('[LEGACY-FALLBACK] ...')` 출력을 통해 fallback 사용 빈도를 측정하고, 단계 6.5에서 0건이 되도록 목표로 삼는다.
- 예제 26 Guard 로그에서 `[STRICT-POLICY]`, `[EDGE-ORDER-VIOLATION]` 문자열이 나오면 즉시 검증 중단.

## 7. 코드 반영 포인트 메모
- `packages/workflow/src/handlers/agent-event-handler.ts`: 상태 재활용, WorkflowState 갱신, timestamp 업데이트
- `packages/workflow/src/services/workflow-state.ts`: `getAgentForExecution`, `setAgentForExecution` 보강 및 timestamp helper
- `packages/agents/src/services/event-service.ts`: owner-bound EventService 규칙(absolute ownerPath 검증, 바인딩 충돌 금지) 준수 여부 확인

---

이 문서를 기반으로 CURRENT-TASKS Priority 1(단계 3)에서 요구하는 시뮬레이션 기록, 구현, 검증 단계를 차례로 진행한다.
