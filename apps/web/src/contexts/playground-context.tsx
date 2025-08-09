'use client';

/**
 * PlaygroundContext - Global State Management for Robota Playground
 * 
 * This context provides centralized state management for the Playground interface,
 * integrating with PlaygroundExecutor and real-time WebSocket communication.
 * 
 * Follows React best practices:
 * - Type-safe context with proper TypeScript definitions
 * - Separation of state and actions
 * - Error boundaries and loading states
 * - Real-time synchronization with backend
 */

import React, { createContext, useContext, useReducer, useEffect, useCallback, ReactNode, useRef } from 'react';
import { PlaygroundExecutor, type PlaygroundExecutionResult, type PlaygroundAgentConfig, type PlaygroundTeamConfig, type PlaygroundMode, type ConversationEvent, type VisualizationData } from '@/lib/playground/robota-executor';
import { DefaultConsoleLogger } from '@robota-sdk/agents';
// Import Universal types from their proper location (Feature Ownership principle)
import type { UniversalWorkflowStructure } from '@robota-sdk/agents';

// ===== State Types =====

export interface PlaygroundState {
    // Executor state
    executor: PlaygroundExecutor | null;
    isInitialized: boolean;
    isExecuting: boolean;

    // Configuration state
    mode: PlaygroundMode;
    currentAgentConfig: PlaygroundAgentConfig | null;
    currentTeamConfig: PlaygroundTeamConfig | null;

    // Conversation state
    conversationHistory: ConversationEvent[];
    lastExecutionResult: PlaygroundExecutionResult | null;

    // Connection state
    isWebSocketConnected: boolean;
    serverUrl: string;
    authToken: string | null;
    userId: string | null;
    sessionId: string | null;

    // UI state
    isLoading: boolean;
    error: string | null;
    visualizationData: VisualizationData | null;

    // Workflow state
    currentWorkflow: UniversalWorkflowStructure | null;  // Manual Store (deprecated)
    sdkWorkflow: UniversalWorkflowStructure | null;      // SDK Store (primary)
    // Execution Statistics - Now managed by PlaygroundStatisticsPlugin
    executionStats: {
        totalExecutions: 0,
        successfulExecutions: 0,
        failedExecutions: 0,
        averageExecutionTime: 0,
        lastExecutionTime: null,
        // Additional statistics from PlaygroundStatisticsPlugin
        blockCreations: 0,
        uiInteractions: 0,
        streamingExecutions: 0,
        agentModeExecutions: 0,
        teamModeExecutions: 0,
        successRate: 100
    };
}

export type PlaygroundAction =
    | { type: 'SET_EXECUTOR'; payload: PlaygroundExecutor | null }
    | { type: 'SET_INITIALIZED'; payload: boolean }
    | { type: 'SET_AGENT_CONFIG'; payload: PlaygroundAgentConfig | null }
    | { type: 'SET_TEAM_CONFIG'; payload: PlaygroundTeamConfig | null }
    | { type: 'SET_EXECUTING'; payload: boolean }
    | { type: 'SET_WEBSOCKET_CONNECTED'; payload: boolean }
    | { type: 'SET_AUTH'; payload: { userId?: string; sessionId?: string; authToken?: string } }
    | { type: 'SET_LOADING'; payload: boolean }
    | { type: 'SET_ERROR'; payload: string | null }
    | { type: 'UPDATE_VISUALIZATION_DATA'; payload: Partial<VisualizationData> }
    | { type: 'SET_MODE'; payload: PlaygroundMode }
    | { type: 'ADD_CONVERSATION_EVENT'; payload: ConversationEvent }
    | { type: 'SET_CONVERSATION_HISTORY'; payload: ConversationEvent[] }
    | { type: 'CLEAR_CONVERSATION_HISTORY' }
    | { type: 'SET_EXECUTION_RESULT'; payload: PlaygroundExecutionResult }
    | { type: 'SET_CURRENT_WORKFLOW'; payload: UniversalWorkflowStructure | null }
    | { type: 'UPDATE_WORKFLOW_FROM_SDK'; payload: UniversalWorkflowStructure }  // STEP 7.2.2: 새로 추가
    | { type: 'UPDATE_NODE_STATUS'; payload: { nodeId: string; status: 'pending' | 'ready' | 'running' | 'completed' | 'error' } };

// ===== Initial State =====

const initialState: PlaygroundState = {
    executor: null,
    isInitialized: false,
    isExecuting: false,
    mode: 'agent',
    currentAgentConfig: null,
    currentTeamConfig: null,
    conversationHistory: [],
    lastExecutionResult: null,
    isWebSocketConnected: false,
    serverUrl: '',
    authToken: null,
    userId: null,
    sessionId: null,
    isLoading: false,
    error: null,
    visualizationData: null,
    currentWorkflow: null,  // Manual Store (deprecated)
    sdkWorkflow: null,      // SDK Store (primary)
    // Execution Statistics - Now managed by PlaygroundStatisticsPlugin
    executionStats: {
        totalExecutions: 0,
        successfulExecutions: 0,
        failedExecutions: 0,
        averageExecutionTime: 0,
        lastExecutionTime: null,
        // Additional statistics from PlaygroundStatisticsPlugin
        blockCreations: 0,
        uiInteractions: 0,
        streamingExecutions: 0,
        agentModeExecutions: 0,
        teamModeExecutions: 0,
        successRate: 100
    }
};

// ===== Reducer =====

function playgroundReducer(state: PlaygroundState, action: PlaygroundAction): PlaygroundState {
    switch (action.type) {
        case 'SET_EXECUTOR':
            return {
                ...state,
                executor: action.payload
            };

        case 'SET_INITIALIZED':
            return {
                ...state,
                isInitialized: action.payload,
                isLoading: false
            };

        case 'SET_EXECUTING':
            return {
                ...state,
                isExecuting: action.payload
            };

        case 'SET_MODE':
            return {
                ...state,
                mode: action.payload
            };

        case 'SET_AGENT_CONFIG':
            return {
                ...state,
                currentAgentConfig: action.payload,
                mode: 'agent'
            };

        case 'SET_TEAM_CONFIG':
            return {
                ...state,
                currentTeamConfig: action.payload,
                mode: 'team'
            };

        case 'ADD_CONVERSATION_EVENT':
            return {
                ...state,
                conversationHistory: [...state.conversationHistory, action.payload]
            };

        case 'SET_CONVERSATION_HISTORY':
            return {
                ...state,
                conversationHistory: action.payload
            };

        case 'CLEAR_CONVERSATION_HISTORY':
            return {
                ...state,
                conversationHistory: [],
                lastExecutionResult: null
            };

        case 'SET_EXECUTION_RESULT':
            // Update execution statistics based on result
            const newStats = {
                ...state.executionStats,
                totalExecutions: state.executionStats.totalExecutions + 1,
                successfulExecutions: state.executionStats.successfulExecutions + (action.payload.success ? 1 : 0),
                failedExecutions: state.executionStats.failedExecutions + (action.payload.success ? 0 : 1),
                averageExecutionTime: state.executionStats.totalExecutions > 0
                    ? (state.executionStats.averageExecutionTime * state.executionStats.totalExecutions + (action.payload.duration || 0)) / (state.executionStats.totalExecutions + 1)
                    : (action.payload.duration || 0),
                lastExecutionTime: new Date()
            };

            return {
                ...state,
                lastExecutionResult: action.payload,
                executionStats: newStats as any
            };



        case 'SET_WEBSOCKET_CONNECTED':
            return {
                ...state,
                isWebSocketConnected: action.payload
            };

        case 'SET_AUTH':
            return {
                ...state,
                userId: action.payload.userId || null,
                sessionId: action.payload.sessionId || null,
                authToken: action.payload.authToken || null
            };

        case 'SET_LOADING':
            return {
                ...state,
                isLoading: action.payload
            };

        case 'SET_ERROR':
            return {
                ...state,
                error: action.payload,
                isLoading: false
            };

        case 'UPDATE_VISUALIZATION_DATA':
            return {
                ...state,
                visualizationData: {
                    ...state.visualizationData,
                    ...action.payload
                } as any
            };



        case 'SET_CURRENT_WORKFLOW':
            return {
                ...state,
                currentWorkflow: action.payload
            };

        case 'UPDATE_WORKFLOW_FROM_SDK':
            console.log('🔄 [STEP 10.1] SDK Workflow updated (no merge):', action.payload ? 'Success' : 'Null');
            console.log('🔄 [STEP 10.1] SDK Workflow nodes count:', action.payload?.nodes?.length || 0);
            // UI 상태 업데이트
            if (typeof document !== 'undefined') {
                const nodesCountElement = document.getElementById('workflow-nodes-count');
                const lastUpdateElement = document.getElementById('last-workflow-update');
                if (nodesCountElement) nodesCountElement.textContent = String(action.payload?.nodes?.length || 0);
                if (lastUpdateElement) lastUpdateElement.textContent = new Date().toLocaleTimeString();

                // Tool Call 및 Agent 카운트
                const toolCallsElement = document.getElementById('tool-calls-count');
                const agentsElement = document.getElementById('agents-created-count');
                if (action.payload?.nodes) {
                    const toolCallNodes = action.payload.nodes.filter(node => node.type === 'tool_call' || node.type === 'toolCall');
                    const agentNodes = action.payload.nodes.filter(node => node.type === 'agent');
                    if (toolCallsElement) toolCallsElement.textContent = String(toolCallNodes.length);
                    if (agentsElement) agentsElement.textContent = String(agentNodes.length);
                }
            }
            return {
                ...state,
                sdkWorkflow: action.payload  // STEP 10.1: SDK Store만 업데이트, merge 제거
            };

        case 'UPDATE_NODE_STATUS':
            if (!state.currentWorkflow) {
                return state;
            }

            return {
                ...state,
                currentWorkflow: {
                    ...state.currentWorkflow,
                    nodes: state.currentWorkflow.nodes.map(node =>
                        node.id === action.payload.nodeId
                            ? {
                                ...node,
                                data: {
                                    ...node.data,
                                    status: action.payload.status
                                }
                            }
                            : node
                    )
                }
            };

        default:
            return state;
    }
}

// ===== Context Definition =====

interface PlaygroundContextValue {
    // State
    state: PlaygroundState;

    // Actions
    createAgent: (config: PlaygroundAgentConfig) => Promise<void>;
    createTeam: (config: PlaygroundTeamConfig) => Promise<void>;
    executePrompt: (prompt: string) => Promise<PlaygroundExecutionResult>;
    executeStreamPrompt: (prompt: string, onChunk: (chunk: string) => void) => Promise<PlaygroundExecutionResult>;
    clearHistory: () => void;
    setAuth: (userId: string, sessionId: string, authToken: string) => void;
    disposeExecutor: () => Promise<void>;
    setWorkflow: (workflow: UniversalWorkflowStructure | null) => void;
    updateNodeStatus: (nodeId: string, status: 'pending' | 'ready' | 'running' | 'completed' | 'error') => void;
    setExecuting: (isExecuting: boolean) => void;

    // Getters
    getVisualizationData: () => any;
    getConnectionStatus: () => { connected: boolean; url: string };
}

const PlaygroundContext = createContext<PlaygroundContextValue | undefined>(undefined);

// ===== Provider Component =====

interface PlaygroundProviderProps {
    children: ReactNode;
    defaultServerUrl?: string;
}

export function PlaygroundProvider({ children, defaultServerUrl = '' }: PlaygroundProviderProps) {
    console.log('🚨 [PLAYGROUND-PROVIDER] Component rendering! defaultServerUrl:', defaultServerUrl);

    const [state, dispatch] = useReducer(playgroundReducer, {
        ...initialState,
        serverUrl: defaultServerUrl
    });

    console.log('🚨 [PLAYGROUND-PROVIDER] Current state.executor:', !!state.executor);

    // Use ref to track executor for cleanup without causing re-renders
    const executorRef = useRef<PlaygroundExecutor | null>(null);

    // Use ref to track the latest workflow state during executeStreamPrompt
    const currentWorkflowRef = useRef<UniversalWorkflowStructure | null>(null);

    // Sync currentWorkflow state with ref
    useEffect(() => {
        currentWorkflowRef.current = state.currentWorkflow;
    }, [state.currentWorkflow]);

    // Auto-initialize executor on mount
    useEffect(() => {
        console.log('🚨 [EXECUTOR-INIT] useEffect triggered! state.executor:', !!state.executor, 'defaultServerUrl:', defaultServerUrl);
        if (!state.executor && defaultServerUrl) {
            try {
                console.log('🚨 [EXECUTOR-INIT] Creating new PlaygroundExecutor...');
                // Create executor directly (no separate initialization needed)
                const executor = new PlaygroundExecutor(
                    defaultServerUrl,
                    'playground-token',
                    DefaultConsoleLogger // Add logger for development
                );

                // Update state and ref
                dispatch({ type: 'SET_INITIALIZED', payload: true });
                dispatch({ type: 'SET_EXECUTOR', payload: executor });
                executorRef.current = executor;
                console.log('🚨 [EXECUTOR-INIT] PlaygroundExecutor created and state updated!');

            } catch (error) {
                console.error('Failed to create executor:', error);
                dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : 'Failed to create executor' });
            }
        }
    }, [defaultServerUrl]); // Only run when defaultServerUrl changes

    // Event System Setup for Tool Call and Agent Creation (REMOVED manual mutations)
    useEffect(() => {
        // UI does not manually mutate workflow anymore. SDK is the single source of truth.
    }, [state.executor, state.mode, state.isInitialized]);

    // ===== Event Listener Setup Function =====
    const setupEventListeners = useCallback(() => {
        if (!state.executor) {
            return;
        }

        // 안전한 메서드 호출 - eventService 접근을 위한 대체 방법 
        // PlaygroundExecutor에 getEventService가 없으므로 이벤트 리스너를 비활성화


        // Tool Call Event Listener - 범용적인 Tool Call 감지
        const handleToolCallStart = (event: any) => {
            console.log('🔧 [EVENT DETECTED] Tool Call started:', event);
            console.log('🔧 [EVENT DETECTED] Current workflow exists:', !!currentWorkflowRef.current);

            if (!currentWorkflowRef.current) {
                console.log('⚠️ [EVENT DETECTED] No current workflow to update');
                return;
            }

            const currentWorkflow = currentWorkflowRef.current;
            const timestamp = new Date();

            // Create Tool Call Node
            const toolCallNodeId = `tool-call-${event.toolName}-${Date.now()}`;
            const toolCallNode = {
                id: toolCallNodeId,
                type: 'tool',
                position: { x: 400, y: 150, level: 1, order: currentWorkflow.nodes.length },
                data: {
                    label: event.toolName,
                    parameters: event.parameters,
                    status: 'running' as const
                },
                visualState: { status: 'running' as const },
                metadata: {
                    createdAt: timestamp,
                    updatedAt: timestamp
                }
            };

            // Add Tool Call Node
            const updatedWorkflow = {
                ...currentWorkflow,
                nodes: [...currentWorkflow.nodes, toolCallNode],
                metadata: {
                    ...currentWorkflow.metadata,
                    updatedAt: timestamp
                }
            };

            currentWorkflowRef.current = updatedWorkflow as any;
            dispatch({ type: 'SET_CURRENT_WORKFLOW', payload: updatedWorkflow as any });
        };

        // Agent Creation Event Listener
        const handleAgentCreated = (event: any) => {
            console.log('🤖 [EVENT DETECTED] Agent created:', event);
            console.log('🤖 [EVENT DETECTED] Current workflow exists:', !!currentWorkflowRef.current);

            if (!currentWorkflowRef.current) {
                console.log('⚠️ [EVENT DETECTED] No current workflow to update');
                return;
            }

            const currentWorkflow = currentWorkflowRef.current;
            const timestamp = new Date();

            // Create Agent Node
            const agentNodeId = `agent-${Date.now()}`;
            const agentNode = {
                id: agentNodeId,
                type: 'agent',
                position: { x: 600, y: 150, level: 2, order: currentWorkflow.nodes.length },
                data: {
                    label: event.agentName || 'New Agent',
                    template: event.template,
                    status: 'running' as const
                },
                visualState: { status: 'running' as const },
                metadata: {
                    createdAt: timestamp,
                    updatedAt: timestamp
                }
            };

            // Add Agent Node
            const updatedWorkflow = {
                ...currentWorkflow,
                nodes: [...currentWorkflow.nodes, agentNode],
                metadata: {
                    ...currentWorkflow.metadata,
                    updatedAt: timestamp
                }
            };

            currentWorkflowRef.current = updatedWorkflow as any;
            dispatch({ type: 'SET_CURRENT_WORKFLOW', payload: updatedWorkflow as any });
        };

        // 이벤트 리스너는 비활성화됨 - PlaygroundExecutor에 eventService 접근 불가
    }, [state.executor]);

    // STEP 7.2.3: SDK Workflow 구독 useEffect
    useEffect(() => {
        console.log('🚨 [STEP 7.2.3] Setting up SDK workflow subscription');

        // UI 상태 업데이트: 연결 시도 중
        const statusElement = document.getElementById('sdk-subscription-status');
        if (statusElement) statusElement.textContent = 'Connecting...';

        if (!state.executor?.subscribeToWorkflowUpdates) {
            console.log('🔍 [STEP 7.2.3] No workflow subscription available');
            if (statusElement) statusElement.textContent = 'Not Available';
            return;
        }

        console.log('✅ [STEP 7.2.3] Setting up workflow subscription');

        // 실제 SDK 구독 설정
        state.executor.subscribeToWorkflowUpdates((workflow) => {
            console.log('🔄 [STEP 7.2.3] Workflow update received:', !!workflow);
            dispatch({ type: 'UPDATE_WORKFLOW_FROM_SDK', payload: workflow });
        });

        // UI 상태 업데이트: 연결 완료
        if (statusElement) statusElement.textContent = 'Connected';
        console.log('🎉 [STEP 7.2.3] SDK subscription setup completed');

    }, [state.executor, state.isInitialized]);

    // STEP 7.2.4: 초기 Workflow 로드 useEffect
    useEffect(() => {
        if (!state.executor?.getCurrentWorkflow) return;

        console.log('🔄 [STEP 7.2.4] Loading initial workflow');

        const loadInitialWorkflow = async () => {
            try {
                const workflow = await state.executor?.getCurrentWorkflow();
                console.log('🔄 [STEP 7.2.4] Initial workflow loaded:', !!workflow);
                if (workflow && workflow.nodes.length > 0) {
                    dispatch({ type: 'UPDATE_WORKFLOW_FROM_SDK', payload: workflow });
                }
            } catch (error) {
                console.warn('⚠️ [STEP 7.2.4] Failed to load initial workflow:', error);
            }
        };

        loadInitialWorkflow();
    }, [state.executor, state.isInitialized]);

    // ===== Executor Management =====

    const createAgent = useCallback(async (config: PlaygroundAgentConfig) => {
        if (!state.executor || !state.isInitialized) {
            const error = new Error('Executor not initialized');
            console.error('❌ Executor not ready:', error);
            throw error;
        }

        try {
            dispatch({ type: 'SET_LOADING', payload: true });
            await state.executor.createAgent(config);
            dispatch({ type: 'SET_AGENT_CONFIG', payload: config });
            dispatch({ type: 'SET_LOADING', payload: false });
        } catch (error) {
            dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : 'Failed to create agent' });
            dispatch({ type: 'SET_LOADING', payload: false });
            throw error; // Re-throw error so useRobotaExecution can handle it
        }
    }, [state.executor, state.isInitialized]);

    const createTeam = useCallback(async (config: PlaygroundTeamConfig) => {
        if (!state.executor || !state.isInitialized) {
            throw new Error('Executor not initialized');
        }

        try {
            dispatch({ type: 'SET_LOADING', payload: true });
            await state.executor.createTeam(config);
            dispatch({ type: 'SET_TEAM_CONFIG', payload: config });

            // Setup Event Listeners after Team creation
            setupEventListeners();

            dispatch({ type: 'SET_LOADING', payload: false });
        } catch (error) {
            dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : 'Failed to create team' });
            dispatch({ type: 'SET_LOADING', payload: false });
            throw error; // Re-throw error so useRobotaExecution can handle it
        }
    }, [state.executor, state.isInitialized]);

    const executePrompt = useCallback(async (prompt: string): Promise<PlaygroundExecutionResult> => {
        if (!state.executor || !state.isInitialized) {
            throw new Error('Executor not initialized');
        }

        try {
            dispatch({ type: 'SET_EXECUTING', payload: true });
            dispatch({ type: 'SET_ERROR', payload: null });

            // Record UI interaction - chat send
            if (typeof state.executor.recordPlaygroundAction === 'function') {
                await state.executor.recordPlaygroundAction('chat_send', {
                    prompt: prompt.substring(0, 100), // First 100 chars for tracking
                    mode: state.mode
                });
            }

            // Execute via PlaygroundExecutor (which handles statistics automatically)
            const result = await state.executor.run(prompt);

            dispatch({ type: 'SET_EXECUTION_RESULT', payload: result });

            // Get all events from PlaygroundHistoryPlugin (EventService events)
            let allEvents: any[] = [];
            if (typeof state.executor.getPlaygroundEvents === 'function') {
                allEvents = state.executor.getPlaygroundEvents();
            } else {
                // Fallback: Convert basic UniversalMessage[] to ConversationEvent[] for compatibility
                const history = state.executor.getHistory();
                allEvents = history.map((msg, index) => ({
                    id: `msg_${index}_${msg.timestamp?.getTime() || Date.now()}`,
                    type: msg.role === 'user' ? 'user_message' as const : 'assistant_response' as const,
                    content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || ''),
                    timestamp: msg.timestamp || new Date(),
                    parentEventId: undefined,
                    childEventIds: [],
                    executionLevel: 0,
                    executionPath: 'basic',
                    metadata: typeof msg.metadata === 'object' && msg.metadata !== null ?
                        JSON.parse(JSON.stringify(msg.metadata)) : {}
                }));
            }

            // Use simple dispatch to avoid type errors temporarily
            (dispatch as any)({ type: 'SET_CONVERSATION_HISTORY', payload: allEvents });

            // Update visualization data with latest stats from plugin
            let pluginStats = { totalEvents: allEvents.length, totalToolCalls: 0, averageResponseTime: result.duration || 0 };
            if (typeof state.executor.getPlaygroundStatistics === 'function') {
                const stats = state.executor.getPlaygroundStatistics();
                pluginStats = {
                    totalEvents: stats.totalChatExecutions,
                    totalToolCalls: 0, // Will be enhanced later
                    averageResponseTime: stats.averageResponseTime
                };
            }

            const vizData = {
                mode: state.visualizationData?.mode || state.mode,
                events: allEvents,
                agents: state.visualizationData?.agents || [],
                stats: pluginStats
            };

            dispatch({ type: 'UPDATE_VISUALIZATION_DATA', payload: vizData });

            return result;

        } catch (error) {
            const errorResult: PlaygroundExecutionResult = {
                success: false,
                response: 'Execution failed',
                duration: 0,
                error: error instanceof Error ? error : new Error(String(error))
            };

            dispatch({ type: 'SET_EXECUTION_RESULT', payload: errorResult });
            dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : 'Execution failed' });

            return errorResult;
        } finally {
            dispatch({ type: 'SET_EXECUTING', payload: false });
        }
    }, [state.executor, state.isInitialized, state.visualizationData, state.mode]);

    const executeStreamPrompt = useCallback(async (
        prompt: string,
        onChunk: (chunk: string) => void
    ): Promise<PlaygroundExecutionResult> => {
        if (!state.executor || !state.isInitialized) {
            throw new Error('Executor not initialized');
        }

        try {
            dispatch({ type: 'SET_EXECUTING', payload: true });
            dispatch({ type: 'SET_ERROR', payload: null });

            console.log('🎯 [26-EXAMPLE-STRUCTURE] Executing prompt via real workflow system');
            const timestamp = Date.now();
            const userInputNodeId = `user-input-${timestamp}`;

            const externalStore = state.executor?.getExternalWorkflowStore();
            if (externalStore) {
                // ❌ 인위적 User Input 노드 생성 제거됨 - 이벤트 시스템이 자동으로 노드 생성
                console.log('🎯 [EVENT-SYSTEM-ONLY] User input processing - no artificial node creation');
                // ❌ 인위적 노드/엣지 생성 관련 코드 제거됨

                // ❌ 인위적 Edge 생성 로직 제거됨

                // ❌ 인위적 Edge 추가 제거됨
                // 사용되지 않는 코드 블록 제거됨
            } else {
                console.warn('⚠️ [STEP 9.1.3] External Store not available');
            }

            // Update node status to 'running' for current workflow
            if (state.currentWorkflow && state.currentWorkflow.nodes.length > 0) {
                // Find the main agent node (first agent-type node)
                const agentNode = state.currentWorkflow.nodes.find(node => node.type === 'agent');
                if (agentNode) {
                    dispatch({ type: 'UPDATE_NODE_STATUS', payload: { nodeId: agentNode.id, status: 'running' } });
                }
            }

            // Record UI interaction - streaming chat send
            if (typeof state.executor.recordPlaygroundAction === 'function') {
                await state.executor.recordPlaygroundAction('chat_send', {
                    prompt: prompt.substring(0, 100),
                    mode: state.mode,
                    streaming: true
                });
            }

            // 🎯 26번 예제 구조: 단순한 executor.execute 호출
            console.log('🚀 [26-EXAMPLE-STRUCTURE] Starting execution with prompt:', prompt.substring(0, 100));

            const result = await state.executor.execute(prompt, onChunk);

            console.log('✅ [26-EXAMPLE-STRUCTURE] Execution completed');

            dispatch({ type: 'SET_EXECUTION_RESULT', payload: result });

            // Update node status to 'completed' for current workflow
            if (state.currentWorkflow && state.currentWorkflow.nodes.length > 0) {
                // Find the main agent node (first agent-type node)
                const agentNode = state.currentWorkflow.nodes.find(node => node.type === 'agent');
                if (agentNode) {
                    dispatch({ type: 'UPDATE_NODE_STATUS', payload: { nodeId: agentNode.id, status: 'completed' } });
                }
            }

            // Add Agent Response node when response is completed
            if (currentWorkflowRef.current) {
                const timestamp = Date.now();
                const responseNodeId = `agent-response-${timestamp}`;

                // Find the main node to connect from (Team first, then Agent)
                const teamNode = currentWorkflowRef.current.nodes.find(node => node.type === 'team');
                const mainNode = teamNode || currentWorkflowRef.current.nodes.find(node => node.type === 'agent');
                if (mainNode) {
                    // Calculate position for Agent Response node
                    const existingNodes = currentWorkflowRef.current.nodes;
                    const maxY = Math.max(...existingNodes.map(node => node.position.y || 0));
                    const agentResponseY = maxY + 150;

                    // Create Agent Response node
                    const agentResponseNode: any = {
                        id: responseNodeId,
                        type: 'agentResponse',
                        position: { x: 300, y: agentResponseY },
                        data: {
                            label: 'Agent Response',
                            response: result.response?.substring(0, 50) + (result.response?.length > 50 ? '...' : '') || 'No response'
                        },
                        metadata: { createdAt: new Date(), updatedAt: new Date() }
                    };

                    // Create edge: Team (or Agent) → Agent Response
                    const mainToResponseEdge: any = {
                        id: `edge-response-${timestamp}`,
                        source: mainNode.id,
                        target: responseNodeId,
                        sourceHandle: teamNode ? 'team-output' : 'agent-output',
                        targetHandle: 'response-input',
                        data: {},
                        metadata: { createdAt: new Date(), updatedAt: new Date() }
                    };

                    // Update workflow with Agent Response node (keeping all existing nodes including User Input)
                    const updatedWorkflow = {
                        ...currentWorkflowRef.current,
                        nodes: [...currentWorkflowRef.current.nodes, agentResponseNode],
                        edges: [...currentWorkflowRef.current.edges, mainToResponseEdge]
                    };

                    dispatch({ type: 'SET_CURRENT_WORKFLOW', payload: updatedWorkflow });
                    // Update ref with the latest state
                    currentWorkflowRef.current = updatedWorkflow as any;
                }
            }

            // Sync conversation history from executor (central source of truth)
            // Get all events from PlaygroundHistoryPlugin (EventService events)
            let allEvents: any[] = [];
            if (typeof state.executor.getPlaygroundEvents === 'function') {
                allEvents = state.executor.getPlaygroundEvents();
            } else {
                // Fallback: Convert basic UniversalMessage[] to ConversationEvent[] for compatibility
                const history = state.executor.getHistory();
                allEvents = history.map((msg, index) => ({
                    id: `msg_${index}_${msg.timestamp?.getTime() || Date.now()}`,
                    type: msg.role === 'user' ? 'user_message' as const : 'assistant_response' as const,
                    content: msg.content || '',
                    timestamp: msg.timestamp || new Date(),
                    parentEventId: undefined,
                    childEventIds: [],
                    executionLevel: 0,
                    executionPath: 'basic',
                    metadata: msg.metadata || {}
                }));
            }

            // Use simple dispatch to avoid type errors temporarily
            (dispatch as any)({ type: 'SET_CONVERSATION_HISTORY', payload: allEvents });

            // Update visualization data with latest stats from plugin
            let pluginStats = { totalEvents: allEvents.length, totalToolCalls: 0, averageResponseTime: 0 };
            if (typeof state.executor.getPlaygroundStatistics === 'function') {
                const stats = state.executor.getPlaygroundStatistics();
                pluginStats = {
                    totalEvents: stats.totalChatExecutions,
                    totalToolCalls: 0, // Will be enhanced later
                    averageResponseTime: stats.averageResponseTime
                };
            }

            const vizData = {
                mode: state.visualizationData?.mode || state.mode,
                events: allEvents,
                agents: state.visualizationData?.agents || [],
                stats: pluginStats
            };

            dispatch({ type: 'UPDATE_VISUALIZATION_DATA', payload: vizData });

            return result;

        } catch (error) {
            console.error('❌ executeStreamPrompt error in context:', error);
            console.error('❌ Context error details:', {
                message: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined,
                prompt,
                hasExecutor: !!state.executor,
                isInitialized: state.isInitialized
            });

            const errorResult: PlaygroundExecutionResult = {
                success: false,
                response: 'Execution failed',
                duration: 0,
                error: error instanceof Error ? error : new Error(String(error))
            };

            dispatch({ type: 'SET_EXECUTION_RESULT', payload: errorResult });
            dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : 'Execution failed' });

            // Update node status to 'error' for current workflow
            if (state.currentWorkflow && state.currentWorkflow.nodes.length > 0) {
                const agentNode = state.currentWorkflow.nodes.find(node => node.type === 'agent');
                if (agentNode) {
                    dispatch({ type: 'UPDATE_NODE_STATUS', payload: { nodeId: agentNode.id, status: 'error' } });
                }
            }

            return errorResult;
        } finally {
            dispatch({ type: 'SET_EXECUTING', payload: false });
        }
    }, [state.executor, state.isInitialized, state.visualizationData, state.mode, state.currentWorkflow]);

    const clearHistory = useCallback(() => {
        if (state.executor && state.isInitialized) {
            state.executor.clearHistory();
        }
        dispatch({ type: 'CLEAR_CONVERSATION_HISTORY' });
    }, [state.executor, state.isInitialized]);

    const setAuth = useCallback((userId: string, sessionId: string, authToken: string) => {
        dispatch({ type: 'SET_AUTH', payload: { userId, sessionId, authToken } });

        if (executorRef.current) {
            // Update executor auth (if method exists)
            (executorRef.current as any).updateAuth?.(userId, sessionId, authToken);
        }
    }, []);

    const disposeExecutor = useCallback(async () => {
        if (executorRef.current) {
            try {
                await executorRef.current.dispose();
                executorRef.current = null;
            } catch (error) {
                console.error('Error disposing executor:', error);
            }
        }
        // Dispose는 state.executor가 null이 되는 것으로 처리됨
    }, []);

    const setWorkflow = useCallback((workflow: UniversalWorkflowStructure | null) => {
        if (workflow) {
            dispatch({ type: 'UPDATE_WORKFLOW_FROM_SDK', payload: workflow });
        }
    }, []);

    const updateNodeStatus = useCallback((nodeId: string, status: 'pending' | 'ready' | 'running' | 'completed' | 'error') => {
        dispatch({ type: 'UPDATE_NODE_STATUS', payload: { nodeId, status } });
    }, []);

    const setExecuting = useCallback((isExecuting: boolean) => {
        dispatch({ type: 'SET_EXECUTING', payload: isExecuting });
    }, []);



    // ===== Getters =====

    const getVisualizationData = useCallback((): any => {
        return state.visualizationData;
    }, [state.visualizationData]);

    const getConnectionStatus = useCallback(() => {
        return {
            connected: state.isWebSocketConnected,
            url: state.serverUrl
        };
    }, [state.isWebSocketConnected, state.serverUrl]);

    // ===== Effects =====

    // Monitor WebSocket connection status
    useEffect(() => {
        if (state.executor) {
            const checkConnection = () => {
                const isConnected = (state.executor as any).isWebSocketConnected?.() || false;
                if (isConnected !== state.isWebSocketConnected) {
                    dispatch({ type: 'SET_WEBSOCKET_CONNECTED', payload: isConnected });
                }
            };

            const interval = setInterval(checkConnection, 1000);
            return () => clearInterval(interval);
        }
    }, [state.executor, state.isWebSocketConnected]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            // Clean up executor on unmount using ref
            if (executorRef.current) {
                executorRef.current.dispose().catch(console.error);
            }
        };
    }, []); // Empty dependency array - only cleanup on unmount

    // ===== Context Value =====

    const contextValue: PlaygroundContextValue = {
        state,
        createAgent,
        createTeam,
        executePrompt,
        executeStreamPrompt,
        clearHistory,
        setAuth,
        disposeExecutor,
        setWorkflow,
        updateNodeStatus,
        setExecuting,
        getVisualizationData,
        getConnectionStatus
    };

    return (
        <PlaygroundContext.Provider value={contextValue}>
            {children}
        </PlaygroundContext.Provider>
    );
}

// ===== Hook =====

export function usePlayground() {
    const context = useContext(PlaygroundContext);
    if (context === undefined) {
        throw new Error('usePlayground must be used within a PlaygroundProvider');
    }
    return context;
}

// ===== Additional Hooks =====

export function usePlaygroundState() {
    const { state } = usePlayground();
    return state;
}

export function usePlaygroundActions() {
    const {
        createAgent,
        createTeam,
        executePrompt,
        executeStreamPrompt,
        clearHistory,
        setAuth,
        disposeExecutor
    } = usePlayground();

    return {
        createAgent,
        createTeam,
        executePrompt,
        executeStreamPrompt,
        clearHistory,
        setAuth,
        disposeExecutor
    };
} 