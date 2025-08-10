// Workflow Type Constants
// Based on existing WORKFLOW_NODE_TYPES from agents package

/**
 * Workflow Node Type Constants
 * 
 * 🎯 목적: 도메인 중립적이고 일관된 Node 타입 시스템 제공
 * 🚫 금지: 외부에서 커스텀 Node 타입 생성 방지
 * 🔒 중앙집중: 모든 Node 타입을 이 파일에서 관리
 * 
 * 원칙:
 * 1. 도메인 중립성: 특정 업무/도메인에 종속되지 않는 범용 타입
 * 2. 확장성: LLM Agent의 연속적 특성 지원 (final이라는 개념 제거)
 * 3. 단순성: 복잡한 계층 구조 방지 (sub-*, super-* 등 금지)
 * 4. 예측가능성: 타입 이름만으로 역할과 목적이 명확함
 */

/**
 * 🎯 Entry/Exit Points - 워크플로우 시작과 종료
 */
export const WORKFLOW_NODE_TYPES = {
    // 시작점: 사용자가 워크플로우를 시작하는 지점
    USER_INPUT: 'user_input',

    // 사용자 메시지: Agent에게 전달되는 메시지 (tool_call_response → user_message → agent)
    USER_MESSAGE: 'user_message',

    // 종료점: 사용자에게 결과를 전달하는 지점 (반드시 마지막은 아님)
    OUTPUT: 'output',

    /**
     * 🤖 Agent Core - Agent 번호 시스템 (Agent 0, Agent 1, Agent 2...)
     * 모든 Agent는 동일한 'agent' 타입으로 통일
     * 번호와 역할은 data.agentNumber, data.label로 구분
     */
    AGENT: 'agent',

    // Tools 관리 컨테이너 (Agent가 사용할 수 있는 도구들의 집합)
    TOOLS_CONTAINER: 'tools_container',

    // 개별 Tool 정의 (특정 기능을 수행하는 도구)
    TOOL_DEFINITION: 'tool_definition',

    /**
     * 🔄 Execution Flow - Agent의 실행 흐름
     */
    // Agent의 사고/판단 과정 (LLM 추론 단계)
    AGENT_THINKING: 'agent_thinking',

    // 개별 Tool 실행 (도구 호출 및 실행)
    TOOL_CALL: 'tool_call',

    // Tool 실행 결과에 대한 응답 (tool_call → tool_call_response)
    TOOL_CALL_RESPONSE: 'tool_call_response',

    /**
     * 📤 Response Types - 응답 처리
     * "final"이라는 개념 제거: 모든 응답은 연속될 수 있음
     */
    // Agent의 응답 (thinking → response, 연속 대화 가능)
    RESPONSE: 'response',

    // 여러 Tool/Agent 결과의 합류점 (병렬 처리 결과 통합)
    TOOL_RESULT: 'tool_result', // Previously MERGE_RESULTS

    // 오류 노드 (실행 중 발생한 오류 처리)
    ERROR: 'error',

    /**
     * 🏢 Team & Collaboration - 팀 협업 관련 노드들
     */
    // 팀 분석 (team.analysis_start/complete)
    TEAM_ANALYSIS: 'team_analysis',

    // 작업 할당 (team.task_assigned)
    TASK: 'task',

    // Agent 생성 프로세스 (team.agent_creation_*)
    AGENT_CREATION: 'agent_creation',

    // 결과 집계 (team.aggregation_complete)
    AGGREGATION: 'aggregation',

    /**
     * 🔧 Tool Operations - Tool 관련 세부 노드들
     */
    // Tool 응답 (tool.call_response_ready)
    TOOL_RESPONSE: 'tool_response',

    /**
     * ⚙️ Execution & Messages - 실행 및 메시지 관련
     */
    // 실행 노드 (execution.start/complete)
    EXECUTION: 'execution',

    // Assistant 메시지 (execution.assistant_message_*)
    ASSISTANT_MESSAGE: 'assistant_message',
} as const;

/**
 * WorkflowNodeType - 타입 안전성을 위한 Union Type
 * 
 * 🔒 외부에서 이 타입에 없는 Node 타입 사용 방지
 * 🎯 모든 Node 생성 시 이 상수들만 사용하도록 강제
 */
export type WorkflowNodeType = typeof WORKFLOW_NODE_TYPES[keyof typeof WORKFLOW_NODE_TYPES];

/**
 * Node Type 검증 함수
 * 
 * @param nodeType - 검증할 Node 타입
 * @returns 유효한 Node 타입인지 여부
 */
export function isValidWorkflowNodeType(nodeType: string): nodeType is WorkflowNodeType {
    return Object.values(WORKFLOW_NODE_TYPES).includes(nodeType as WorkflowNodeType);
}

/**
 * Node Type 설명 맵 (디버깅 및 로깅용)
 */
export const WORKFLOW_NODE_TYPE_DESCRIPTIONS = {
    [WORKFLOW_NODE_TYPES.USER_INPUT]: '사용자 입력 (워크플로우 시작점)',
    [WORKFLOW_NODE_TYPES.USER_MESSAGE]: '사용자 메시지 (Agent에게 전달)',
    [WORKFLOW_NODE_TYPES.OUTPUT]: '사용자 출력 (결과 전달점)',
    [WORKFLOW_NODE_TYPES.AGENT]: 'Agent (번호 시스템으로 구분)',
    [WORKFLOW_NODE_TYPES.TOOLS_CONTAINER]: 'Tools 컨테이너',
    [WORKFLOW_NODE_TYPES.TOOL_DEFINITION]: '개별 Tool 정의',
    [WORKFLOW_NODE_TYPES.AGENT_THINKING]: 'Agent 사고/판단 과정',
    [WORKFLOW_NODE_TYPES.TOOL_CALL]: '개별 Tool 실행',
    [WORKFLOW_NODE_TYPES.TOOL_CALL_RESPONSE]: 'Tool 실행 결과 응답',
    [WORKFLOW_NODE_TYPES.RESPONSE]: 'Agent 응답 (연속 가능)',
    [WORKFLOW_NODE_TYPES.TOOL_RESULT]: 'Tool 결과 합류점',
    [WORKFLOW_NODE_TYPES.ERROR]: '오류 처리 노드',

    // Team & Collaboration
    [WORKFLOW_NODE_TYPES.TEAM_ANALYSIS]: '팀 분석 노드',
    [WORKFLOW_NODE_TYPES.TASK]: '작업 할당 노드',
    [WORKFLOW_NODE_TYPES.AGENT_CREATION]: 'Agent 생성 프로세스',
    [WORKFLOW_NODE_TYPES.AGGREGATION]: '결과 집계 노드',

    // Tool Operations
    [WORKFLOW_NODE_TYPES.TOOL_RESPONSE]: 'Tool 응답 노드',

    // Execution & Messages
    [WORKFLOW_NODE_TYPES.EXECUTION]: '실행 노드',
    [WORKFLOW_NODE_TYPES.ASSISTANT_MESSAGE]: 'Assistant 메시지 노드'
} as const;

// Note: WORKFLOW_DEFAULTS and WORKFLOW_CONSTRAINTS have been moved to ./defaults.ts
// to avoid duplication and improve organization
