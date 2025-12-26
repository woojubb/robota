# assignTask Fork 시나리오 (Path-Only / Absolute ownerPath) — 최신

> 목적: Guarded 예제 26에서 검증된 “tool → delegated agent → join” 흐름을 **단일 정답 규칙**으로 문서화한다.  
> 모든 관계 판단은 **`context.ownerPath`(absolute full path)** 기반이며, 추론/대기/폴백/ID 파싱은 금지한다.

## 1) 핵심 원칙
- **Absolute ownerPath-only**: 이벤트 한 건만 보고도(명시 필드만으로) 관계를 결정할 수 있어야 한다.
  - `path: string[]`는 브릿지 계층이 `context.ownerPath[].id`를 펼친 파생 값이다.
- **Atomic node+edge**: 한 이벤트 처리에서 필요한 노드/엣지를 동시에 생성한다(지연/보정 금지).
- **단일 경로**: 필요한 path/owner 정보가 없으면 즉시 실패한다(대체 경로 없음).

## 2) 표준 세그먼트(예시)
아래는 **예시**이며, `type` 문자열은 open-ended다(고정 enum 아님).
- `agent`: `agent_0`, `agent_1`, ...
- `execution`: `exec_...`
- `thinking`: `thinking_agent_0_round1`
- `tool`: `call_...`
- `response`: `response_thinking_agent_0_round1`
- `tool_result`: `tool_result_thinking_agent_0_round1` (예시)

## 3) 이벤트 시퀀스(권장 최소)

### A. Root agent (Round 1)
| Step | Event | ownerPath (tail) | 생성 노드 | 생성 엣지 |
|---|---|---|---|---|
| 1 | `execution.user_message` | `execution` | `user_message` | `agent → user_message (receives)` |
| 2 | `execution.assistant_message_start` | `thinking` | `agent_thinking` | `user_message → thinking (processes)` |
| 3 | `tool.call_start` | `tool` | `tool_call` | `thinking → tool_call (executes)` |

### B. delegated agent (tool이 agent를 생성)
| Step | Event | ownerPath (tail) | 생성 노드 | 생성 엣지 |
|---|---|---|---|---|
| 4 | `agent.created` | `agent` | `agent` | `tool_call → agent (creates)` |
| 5 | `execution.user_message` | `execution` | `user_message` | `agent → user_message (receives)` |
| 6 | `execution.assistant_message_start` | `thinking` | `agent_thinking` | `user_message → thinking (processes)` |
| 7 | `execution.assistant_message_complete` | `response` | `response` | `thinking → response (return)` |

### C. tool join (root thinking scope)
| Step | Event | ownerPath (tail) | 생성 노드 | 생성 엣지 |
|---|---|---|---|---|
| 8 | `tool.call_response_ready` | `tool` | `tool_response` | **`delegated response → tool_response (result)`** |
| 9 | `execution.tool_results_ready` | `thinking` | `tool_result` | `tool_response[*] → tool_result (result)` |
| 10 | `execution.assistant_message_start` (Round 2) | `thinking` | `agent_thinking` | `tool_result → thinking (analyze)` |
| 11 | `execution.assistant_message_complete` | `response` | `response` | `thinking → response (return)` |

## 4) 중요한 연결 규칙(verify 요구사항과 연동)
- `tool_call` 노드는 **단일 outgoing**이어야 한다(verify의 `tool_call 단일 outgoing` 규칙).
  - 따라서 delegated agent가 생성되는 경우, `tool.call_response_ready`에서 생성되는 `tool_response`는 `tool_call`에 직접 붙지 않고,
    **delegated agent의 response에 붙는다**.
- continued conversation은 같은 `conversationId(agentId)`에서 `execution.user_message`가 반복되며,
  `response(last) → user_message(continues) → thinking(processes)`가 유지되어야 한다.

## 5) ToolExecutionContext 규칙(툴이 agent를 생성하는 케이스)
- `ToolExecutionContext.eventService`: tool-call owner-bound (tail은 `{type:'tool', id: toolCallId}`).
- `ToolExecutionContext.baseEventService`: unbound base (새 owner-bound 인스턴스를 만들기 위한 기반).
- 금지: tool-call owner-bound 인스턴스를 다시 agent owner-bound로 겹쳐 바인딩.


