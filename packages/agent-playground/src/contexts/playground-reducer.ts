/**
 * Playground reducer - state management logic for PlaygroundContext
 */

import type {
  PlaygroundExecutor,
  IPlaygroundAgentConfig,
  IPlaygroundExecutorResult,
  TPlaygroundMode,
  IConversationEvent,
  IVisualizationData,
} from '../lib/playground/robota-executor';
import type { IPlaygroundToolMeta } from '../tools/catalog';
import { getPlaygroundToolCatalog } from '../tools/catalog';

// ===== State Types =====

export interface IPlaygroundState {
  executor: PlaygroundExecutor | null;
  isInitialized: boolean;
  isExecuting: boolean;
  mode: TPlaygroundMode;
  currentAgentConfig: IPlaygroundAgentConfig | null;
  agentConfigs: IPlaygroundAgentConfig[];
  conversationHistory: IConversationEvent[];
  lastExecutionResult: IPlaygroundExecutorResult | null;
  isWebSocketConnected: boolean;
  serverUrl: string;
  authToken: string | null;
  userId: string | null;
  sessionId: string | null;
  isLoading: boolean;
  error: string | null;
  visualizationData: IVisualizationData | null;
  executionStats: IPlaygroundExecutionStats;
  toolItems: IPlaygroundToolMeta[];
  addedToolsByAgent: Record<string, string[]>;
}

export interface IPlaygroundExecutionStats {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  averageExecutionTime: number;
  lastExecutionTime: Date | null;
  blockCreations: number;
  uiInteractions: number;
  streamingExecutions: number;
  agentModeExecutions: number;
  successRate: number;
}

export type TPlaygroundReducerAction =
  | { type: 'SET_EXECUTOR'; payload: PlaygroundExecutor | null }
  | { type: 'SET_INITIALIZED'; payload: boolean }
  | { type: 'SET_AGENT_CONFIG'; payload: IPlaygroundAgentConfig | null }
  | { type: 'ADD_AGENT_CONFIG'; payload: IPlaygroundAgentConfig }
  | { type: 'UPDATE_AGENT_CONFIG'; payload: { index: number; config: IPlaygroundAgentConfig } }
  | { type: 'SET_EXECUTING'; payload: boolean }
  | { type: 'SET_WEBSOCKET_CONNECTED'; payload: boolean }
  | { type: 'SET_AUTH'; payload: { userId?: string; sessionId?: string; authToken?: string } }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'UPDATE_VISUALIZATION_DATA'; payload: Partial<IVisualizationData> }
  | { type: 'SET_MODE'; payload: TPlaygroundMode }
  | { type: 'ADD_CONVERSATION_EVENT'; payload: IConversationEvent }
  | { type: 'SET_CONVERSATION_HISTORY'; payload: IConversationEvent[] }
  | { type: 'CLEAR_CONVERSATION_HISTORY' }
  | { type: 'SET_EXECUTION_RESULT'; payload: IPlaygroundExecutorResult }
  | { type: 'SET_TOOL_ITEMS'; payload: IPlaygroundToolMeta[] }
  | { type: 'ADD_TOOL_TO_AGENT_OVERLAY'; payload: { agentId: string; toolId: string } };

// ===== Initial State =====

export const initialState: IPlaygroundState = {
  executor: null,
  isInitialized: false,
  isExecuting: false,
  mode: 'agent',
  currentAgentConfig: null,
  agentConfigs: [],
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
  executionStats: {
    totalExecutions: 0,
    successfulExecutions: 0,
    failedExecutions: 0,
    averageExecutionTime: 0,
    lastExecutionTime: null,
    blockCreations: 0,
    uiInteractions: 0,
    streamingExecutions: 0,
    agentModeExecutions: 0,
    successRate: 100,
  },
  toolItems: getPlaygroundToolCatalog(),
  addedToolsByAgent: {},
};

// ===== Reducer =====

export function playgroundReducer(
  state: IPlaygroundState,
  action: TPlaygroundReducerAction,
): IPlaygroundState {
  switch (action.type) {
    case 'SET_EXECUTOR':
      return { ...state, executor: action.payload };
    case 'SET_INITIALIZED':
      return { ...state, isInitialized: action.payload, isLoading: false };
    case 'SET_EXECUTING':
      return { ...state, isExecuting: action.payload };
    case 'SET_MODE':
      return { ...state, mode: action.payload };
    case 'SET_AGENT_CONFIG':
      return { ...state, currentAgentConfig: action.payload, mode: 'agent' };
    case 'ADD_AGENT_CONFIG':
      return {
        ...state,
        agentConfigs: [...state.agentConfigs, action.payload],
        currentAgentConfig: action.payload,
        mode: 'agent',
      };
    case 'UPDATE_AGENT_CONFIG':
      return {
        ...state,
        agentConfigs: state.agentConfigs.map((cfg, i) =>
          i === action.payload.index ? action.payload.config : cfg,
        ),
      };
    case 'ADD_CONVERSATION_EVENT':
      return { ...state, conversationHistory: [...state.conversationHistory, action.payload] };
    case 'SET_CONVERSATION_HISTORY':
      return { ...state, conversationHistory: action.payload };
    case 'CLEAR_CONVERSATION_HISTORY':
      return { ...state, conversationHistory: [], lastExecutionResult: null };
    case 'SET_EXECUTION_RESULT': {
      const newStats: IPlaygroundExecutionStats = {
        ...state.executionStats,
        totalExecutions: state.executionStats.totalExecutions + 1,
        successfulExecutions:
          state.executionStats.successfulExecutions + (action.payload.success ? 1 : 0),
        failedExecutions: state.executionStats.failedExecutions + (action.payload.success ? 0 : 1),
        averageExecutionTime:
          state.executionStats.totalExecutions > 0
            ? (state.executionStats.averageExecutionTime * state.executionStats.totalExecutions +
                (action.payload.duration || 0)) /
              (state.executionStats.totalExecutions + 1)
            : action.payload.duration || 0,
        lastExecutionTime: new Date(),
      };
      return { ...state, lastExecutionResult: action.payload, executionStats: newStats };
    }
    case 'SET_WEBSOCKET_CONNECTED':
      return { ...state, isWebSocketConnected: action.payload };
    case 'SET_AUTH':
      return {
        ...state,
        userId: action.payload.userId || null,
        sessionId: action.payload.sessionId || null,
        authToken: action.payload.authToken || null,
      };
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload, isLoading: false };
    case 'UPDATE_VISUALIZATION_DATA': {
      const baseVisualization: IVisualizationData = state.visualizationData ?? {
        events: [],
        agents: [],
      };
      return { ...state, visualizationData: { ...baseVisualization, ...action.payload } };
    }
    case 'SET_TOOL_ITEMS':
      return { ...state, toolItems: [...action.payload] };
    case 'ADD_TOOL_TO_AGENT_OVERLAY': {
      const { agentId, toolId } = action.payload;
      const prev = state.addedToolsByAgent[agentId] ?? [];
      return {
        ...state,
        addedToolsByAgent: { ...state.addedToolsByAgent, [agentId]: [...prev, toolId] },
      };
    }
    default:
      return state;
  }
}
