# Enhanced EventService 개요

> 이 문서는 ActionTrackingEventService와 실시간 워크플로우 구독 체계의 핵심 요약입니다. 세부 체크리스트나 구현 계획은 `CURRENT-TASKS.md`에서 관리합니다.

## 1. 목적
- 모든 실행 이벤트에 `path`, `ownerPrefix`, `executionLevel` 정보를 일관되게 주입
- WorkflowEventSubscriber/Builder/MermaidGenerator가 공통 구조를 이해하도록 표준 이벤트 → 노드 매핑 제공
- Sub-Agent/Tool/Team 이벤트를 한 EventService 계층에서 추적

## 2. 주요 컴포넌트

### ActionTrackingEventService
- EventService 래퍼로, `emit()` 시 `storeSourceMapping`, `trackExecutionLevel`, `ownerPrefix` 검증 수행
- `clone({ ownerPrefix, executionContext })`를 지원해 ExecutionService, Tool, Agent가 접두어를 고정한 채 EventService를 사용할 수 있게 함
- Sub-Agent 이벤트는 `SubAgentEventRelay`를 통해 parent ToolCall 정보와 executionLevel+1을 주입하여 상위 흐름으로 전달

### WorkflowEventSubscriber
- ActionTrackingEventService를 상속하여 이벤트를 실시간 구독하고 `WorkflowNode`를 생성하는 핸들러 계층
- 이벤트 타입 → 노드 타입 매핑(예: `execution.assistant_message_start → agent_thinking`)을 단일 테이블로 유지
- Path-Only 규칙에 따라 parentPath를 계산하고 NodeEdgeManager/WorkflowBuilder에 전달

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
  | 'agent'
  | 'agent_thinking'
  | 'tool_call'
  | 'tool_response'
  | 'tool_result'
  | 'final_response';
```
- 노드 타입과 연결 타입(processes, executes, spawn, return, result, analyze 등)은 Path-Only 규칙에 맞게 제한된 집합으로 유지

## 4. 실시간 처리 흐름
1. User → EventService(`ownerPrefix: 'execution'`) → WorkflowEventSubscriber
2. 이벤트 타입과 path 기반으로 WorkflowNode 생성
3. RealTimeWorkflowBuilder가 노드/엣지를 원자적으로 추가하고 실행 상태를 업데이트
4. RealTimeMermaidGenerator/React Flow 구독 계층이 최신 WorkflowStructure를 렌더링

## 5. 필수 규칙
- EventService는 emit 전에 path, ownerPrefix, strictPrefix, executionContext를 검증한다
- 모든 emit/on은 선언형 이벤트 상수를 사용한다 (`EXECUTION_EVENTS`, `TOOL_EVENTS`, `AGENT_EVENTS`)
- Sub-Agent/Tool에서 접두어를 바꾸고 싶으면 반드시 `eventService.clone({ ownerPrefix })`를 호출한다
- WorkflowSubscriber는 Path-Only 규칙을 따르며, 추측/보류/재시도 로직을 포함하지 않는다

## 6. 참고
- Fork/Join 규칙: `.design/event-system/workflow-fork-join-rules.md`
- Path-Only/Atomicity 스펙: `.design/event-system/workflow-spec.md`
- 실행 계획/체크리스트: `CURRENT-TASKS.md`
