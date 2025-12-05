# Event Payload Normalization Assessment

## 목적
- Execution/Agent/Tool 이벤트 전반의 payload 구성을 재조사하고, context(`ownerPath`)로 이전 가능한 필드를 분류한다.
- 공통 메타데이터 키 집합을 정의해, emit payload가 “핵심 정보 + 자유 확장 영역”만 남도록 정리한다.

## 조사 범위
| Owner | Event 목록 | 현재 고유 필드 | Context로 이동 가능한 필드 | 비고 |
| --- | --- | --- | --- | --- |
| execution | `start`, `user_message`, `assistant_message_start`, `assistant_message_complete`, `tool_results_ready`, `tool_results_to_llm`, `complete`, `error` | `parameters.input`, `parameters.agentConfiguration`, `metadata.*`, `result.*`, `toolsInfo`, `aiProviderInfo`, `responseMetrics.*` | `rootExecutionId`, `parentExecutionId`, `executionLevel`, `executionPath`, `path`, `sourceType/sourceId` | 모든 emit 지점에서 동일 패턴. path/level은 ownerPath segment로 100% 표현 가능. |
| tool | `call_start`, `call_complete`, `call_response_ready`, `call_error`(예약) | `toolName`, `parameters`, `result`, `metadata.success`, `delegatedExecId` | `executionId`, `rootExecutionId`, `executionLevel`, `executionPath`, `parentExecutionId` | `executionId`는 사실상 tool_call node id → ownerPath에 `{ type: 'tool', id: toolCallId }` segment로 대체 가능. |
| agent | `created`, `config_updated`, `execution_start`, `execution_complete`, `execution_error`, `aggregation_complete` | `parameters.tools`, `configVersion`, `statusHistory`, `agentCapabilities`, `originalEvent` | `executionLevel`, `rootExecutionId`, `parentExecutionId`, `sourceId`, `timestamp` | `agentOwnerContext` 제거 후 helper로 대체 예정. |
| team (향후) | `team.*` 미사용 | - | - | TeamContainer는 현재 이벤트 미발행. |

### 세부 비고
- `execution.*` payload에 포함된 `path`, `executionPath` 필드는 ownerPath의 스냅샷과 중복되므로 context helper(`buildOwnerContext`)만으로 파생 가능.
- Tool 이벤트의 `executionId`는 “tool_call id” 역할이므로 ownerPath segment `{ type: 'tool', id }`로 노출하고 payload에서는 제거 가능.
- Agent 이벤트의 `rootExecutionId`/`parentExecutionId`는 ExecutionService에서 주입한 정보 그대로이므로 ownerPath segment `{ type: 'agent', id }` 또는 `{ type: 'execution', id }` 조합으로 해결 가능.
- `sourceType`/`sourceId`는 handler에서 `context.ownerPath`의 마지막 segment로 추론 가능하지만, 하위 호환을 위해 1차 정규화에서는 유지하고 2차 단계에서 제거를 검토한다.

## 공통 메타데이터 제안
| 키 | 설명 | 허용 타입 | 이동 대상 |
| --- | --- | --- | --- |
| `parameters` | UI/검증용 가변 데이터 | object | 유지 (schema 명시) |
| `metadata` | 로거/추적용 확장 필드 | object | 유지 (키 리스트 제공) |
| `result` | 완료/에러 시 결과 | object | 유지 |
| `statusHistory` | Agent 상태 전이 | array | 유지 |
| `originalEvent` | raw event snapshot | object | 유지, 단 `extensions.robota.originalEvent` 내에만 존재 |

## Context 파생 규칙 요약
- `ownerPath`는 `[rootExecutionId, executionId, toolCallId?, agentId?]` 순으로 누적되며, handler는 `getNearestOwner(ownerPath, type)` helper로 필요 ID를 조회.
- `sourceId`, `rootExecutionId`, `parentExecutionId`, `executionLevel`, `executionPath`, `path` → `ownerPath`에서 파생 가능하므로 payload 제거 대상.
- EventService 인스턴스는 단일 owner에 바인딩되며 emit 시 `sourceType/sourceId/timestamp`를 자동 주입한다. 호출부는 도메인 데이터만 전달하고 timestamp를 명시하지 않는다.

## 다음 단계
1. 공통 helper (`buildOwnerContext`, `getOwnerIdFromContext`) 정의 및 ExecutionService/Tool/Agent emit 호출부에 적용.
2. `ServiceEventData`에서 context 파생 필드 제거 → TypeScript 타입 업데이트.
3. Guard 예제 26/27을 실행하여 노드/엣지 수 변화 여부 확인.
4. 본 문서를 `.design/open-tasks/CURRENT-TASKS.md` Step 6 항목과 링크.

## 정규화 스키마 초안
```json
{
  "type": "object",
  "properties": {
    "eventType": { "type": "string" },
    "source": {
      "type": "object",
      "properties": {
        "type": { "enum": ["agent", "execution", "tool", "team"] },
        "id": { "type": "string" }
      },
      "required": ["type", "id"]
    },
    "timestamp": { "type": "string", "format": "date-time" },
    "parameters": { "type": "object" },
    "metadata": { "type": "object" },
    "result": { "type": "object" },
    "statusHistory": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "status": { "type": "string" },
          "eventType": { "type": "string" },
          "timestamp": { "type": "number" }
        },
        "required": ["status", "timestamp"]
      }
    }
  },
  "required": ["eventType", "source"]
}
```

### 필드 분류표
| 필드 | 이동 위치 | 비고 |
| --- | --- | --- |
| `sourceType`, `sourceId` | EventService(owner-bound)이 emit 시 자동 주입 | 호출부 미전달 원칙 |
| `rootExecutionId`, `parentExecutionId`, `executionPath`, `path`, `executionLevel` | context.ownerPath | payload에서 제거 |
| `toolName`, `parameters`, `result`, `metadata`, `statusHistory`, `agentCapabilities` | payload 유지 | 렌더링/검증용 핵심 데이터 |
| `timestamp` | EventService가 emit 시 자동 생성(`new Date()` 기본) | 호출부 미전달 |
| `originalEvent` | `extensions.robota.originalEvent` | 변경 없음 |

### 예시 매핑
| 이벤트 | 기존 필드 | 이동 후 |
| --- | --- | --- |
| `execution.assistant_message_start` | `rootExecutionId`, `parentExecutionId`, `executionPath`, `path` | context.ownerPath segment `[ {type:'execution', id:root}, {type:'execution', id:execution}, {type:'thinking', id:thinkingNode} ]` |
| `tool.call_response_ready` | `executionId`, `rootExecutionId`, `executionLevel`, `parentExecutionId` | context.ownerPath `[ {type:'execution', id:root}, {type:'execution', id:execution}, {type:'tool', id:toolCall} ]` |
| `agent.execution_start` | `rootExecutionId`, `sourceId` | context.ownerPath `[ {type:'agent', id:conversationId} ]`, payload에는 status/parameters만 유지 |

## 실행 계획 (DOM 이벤트 패턴 참조)
1. **베이스 이벤트 타입 도입**  
   - `BaseEventData`에 `eventType`, `timestamp`, `source: { type, id }`, `parameters`, `metadata`만 포함.  
   - `ServiceEventData`는 `BaseEventData`를 확장하되, 실행/도구/에이전트 전용 필드는 파생 타입에서만 정의.
2. **파생 이벤트 타입 정의**  
   - `ExecutionEventData`, `ToolEventData`, `AgentEventData` 등을 선언해 각 도메인에 필요한 필드만 추가.  
   - 예: Tool 이벤트 → `toolName`, `result.success`; Agent 이벤트 → `statusHistory`, `configVersion`.
3. **Helper 리팩터링**  
   - `emitExecutionEvent<T extends ExecutionEventData>(...)`, `emitToolEvent<T extends ToolEventData>(...)` 형태로 제너릭을 도입하여 타입 검증.  
   - helper는 payload 내용에 관여하지 않고 context(ownerPath) 생성에만 집중.  
   - ExecutionService/ToolExecutionService/Robota는 owner-bound EventService에 도메인 데이터만 전달하고, 공통 emitWithContext 계층에서 자동 source/timestamp를 주입한다.
4. **컨텍스트 주도 흐름**  
   - DOM `event.target`처럼, 모든 계층 정보는 `context.ownerPath`에서만 파생.  
   - 핸들러에서 `getOwnerId(ownerPath, 'execution')` 같은 헬퍼를 호출해 ID를 복구.
5. **코드 적용 순서**  
   1. `ServiceEventData`를 `BaseEventData` + 파생 타입으로 분리.  
   2. ExecutionService emit 호출부에서 context로 이전 가능한 필드 제거.  
   3. Tool/Agent emit 호출부 동일 패턴으로 리팩터링.  
   4. 핸들러(Workflow) 측에서 context 기반 헬퍼 사용으로 전환.  
   5. Guard 예제 26/27 실행 (정규화 후 검증).
6. **문서/Checklist 반영**  
   - `.design/open-tasks/CURRENT-TASKS.md` Step 5/6 항목에 위 순서를 그대로 반영해 진행 상태를 추적.


