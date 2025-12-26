# Enhanced EventService 개요 (최신: absolute ownerPath-only)

> 이 문서는 **ownerPath-only(EventContext.ownerPath)** 기반 이벤트 시스템의 핵심 요약입니다.  
> 세부 체크리스트/진행 상황은 `CURRENT-TASKS.md`에서 관리합니다.

## 1. 목적
- 모든 실행 이벤트에 **absolute `context.ownerPath`**를 일관되게 제공한다(단일 정답 경로).
- Workflow 구독/빌더가 **추론 없이**(`ID 파싱/캐시/지연/폴백 금지`) 이벤트 1건만으로 노드/엣지 생성 결정을 할 수 있게 한다(Path-only).
- Tool이 agent를 생성하는 위임 시나리오에서도, 이벤트 관계를 **ownerPath로만** 결정 가능하게 한다.

## 2. 주요 컴포넌트
### EventService (owner-bound)
- EventService는 **단일 owner에 바운드된 인스턴스(owner-bound instance)**로 사용한다.
- emit 시점에:
  - `context.ownerPath`가 **absolute full path**인지 검증한다(필수/불일치 즉시 throw).
  - 필요한 경우 `context.ownerPath`를 병합/확장한다(불변 확장).
- 호출부(ExecutionService/Tool/Agent)는 **도메인 데이터(payload)만 전달**하고, 출처/계층 정보는 `context.ownerPath`로만 전달한다.

### WorkflowEventSubscriber
- 이벤트를 실시간 처리해 `WorkflowNode`를 생성하는 핸들러 계층
- 이벤트 타입 → 노드 타입 매핑(예: `execution.assistant_message_start → agent_thinking`)을 단일 테이블로 유지
- Path-Only 규칙에 따라 **`context.ownerPath`로부터 파생된 `path`**만으로 연결을 결정한다.

### RealTimeWorkflowBuilder / RealTimeMermaidGenerator
- Builder: `nodes`, `connections`, `branches`, `metadata`를 유지하며, 이벤트 처리 시점에 노드/엣지를 원자적으로 추가
- MermaidGenerator: WorkflowStructure를 기반으로 노드 정의, 연결 정의, 스타일 정의를 생성해 실시간 그래프를 렌더링

## 3. 데이터 구조 요약
```ts
interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  level: number;
  data: WorkflowNodeData;
  timestamp: number;
}

type WorkflowNodeType =
  | 'user_input'
  | 'user_message'
  | 'output'
  | 'agent'
  | 'tools_container'
  | 'tool_definition'
  | 'agent_thinking'
  | 'tool_call'
  | 'tool_call_response'
  | 'response'
  | 'tool_result'
  | 'tool_response'
  | 'error'
  | 'execution'
  | 'assistant_message'
  | 'team_analysis'
  | 'task'
  | 'agent_creation'
  | 'aggregation';
```
- 노드 타입과 연결 타입(processes, executes, spawn, return, result, analyze 등)은 Path-Only 규칙에 맞게 제한된 집합으로 유지

## 4. 실시간 처리 흐름
1. ExecutionService/Tool/Agent → owner-bound EventService.emit(eventType, payload, context)
2. 브릿지(예: `WorkflowSubscriberEventService`)가 `context.ownerPath[].id`를 펼쳐 `path: string[]`를 구성해 Subscriber에 전달
3. 이벤트 타입과 path-only 규칙으로 WorkflowNode/Edge를 원자적으로 생성
3. RealTimeWorkflowBuilder가 노드/엣지를 원자적으로 추가하고 실행 상태를 업데이트
4. RealTimeMermaidGenerator/React Flow 구독 계층이 최신 WorkflowStructure를 렌더링

## 5. 필수 규칙
- EventService는 emit 전에 **absolute `context.ownerPath`**를 검증한다(필수/불일치 즉시 throw).
- 모든 emit/on은 선언형 이벤트 상수를 사용한다 (`EXECUTION_EVENTS`, `TOOL_EVENTS`, `AGENT_EVENTS`)
- 접두어(prefix) 삽입/변환/검증 로직은 존재하지 않는다(이벤트명은 상수 그대로 사용).
- WorkflowSubscriber는 Path-Only 규칙을 따르며, 추측/보류/재시도 로직을 포함하지 않는다

## 6. 참고
- Fork/Join 규칙: `.design/event-system/workflow-fork-join-rules.md`
- Path-Only/Atomicity 스펙: `.design/event-system/workflow-spec.md`
- 실행 계획/체크리스트: `CURRENT-TASKS.md`
