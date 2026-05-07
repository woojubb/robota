import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type {
  IPlaygroundAgentConfig,
  IPlaygroundExecutorResult,
} from '../../lib/playground/robota-executor';

export type TExecutionState =
  | 'idle'
  | 'initializing'
  | 'running'
  | 'streaming'
  | 'error'
  | 'completed';

export interface IRobotaExecutionHookReturn {
  executionState: TExecutionState;
  isExecuting: boolean;
  isStreaming: boolean;
  canExecute: boolean;
  currentAgentConfig: IPlaygroundAgentConfig | null;
  currentMode: 'agent';
  lastResult: IPlaygroundExecutorResult | null;
  executionHistory: IPlaygroundExecutorResult[];
  lastError: Error | null;
  errorCount: number;
  averageExecutionTime: number;
  totalExecutions: number;
  successRate: number;
  createAgent: (config: IPlaygroundAgentConfig) => Promise<void>;
  executePrompt: (prompt: string) => Promise<IPlaygroundExecutorResult>;
  executeStreamPrompt: (
    prompt: string,
    onChunk?: (chunk: string) => void,
  ) => Promise<IPlaygroundExecutorResult>;
  retryLastExecution: () => Promise<IPlaygroundExecutorResult | null>;
  cancelExecution: () => void;
  clearExecutionHistory: () => void;
  streamingResponse: string;
  clearStreamingResponse: () => void;
  getDefaultAgentConfig: () => IPlaygroundAgentConfig;
  validateConfiguration: (config: IPlaygroundAgentConfig) => { isValid: boolean; errors: string[] };
}

export interface IExecutionRefs {
  lastPromptRef: MutableRefObject<string>;
  executionTimeoutRef: MutableRefObject<NodeJS.Timeout | null>;
  abortControllerRef: MutableRefObject<AbortController | null>;
}

export interface IExecutionHistoryState {
  executionHistory: IPlaygroundExecutorResult[];
  lastError: Error | null;
  errorCount: number;
  averageExecutionTime: number;
  totalExecutions: number;
  successRate: number;
  recordError: (error: Error) => void;
  clearLastError: () => void;
  clearExecutionHistory: () => void;
}

export interface IExecutionLocalState extends IExecutionHistoryState {
  executionState: TExecutionState;
  setExecutionState: Dispatch<SetStateAction<TExecutionState>>;
  isExecuting: boolean;
  isStreaming: boolean;
  canExecute: boolean;
  streamingResponse: string;
  setStreamingResponse: Dispatch<SetStateAction<string>>;
  refs: IExecutionRefs;
}

export interface IRobotaExecutionContextActions {
  createAgent: (config: IPlaygroundAgentConfig) => Promise<void>;
  executePrompt: (prompt: string) => Promise<IPlaygroundExecutorResult>;
  executeStreamPrompt: (
    prompt: string,
    onChunk: (chunk: string) => void,
  ) => Promise<IPlaygroundExecutorResult>;
}

export interface IRobotaExecutionActions {
  createAgent: (config: IPlaygroundAgentConfig) => Promise<void>;
  executePrompt: (prompt: string) => Promise<IPlaygroundExecutorResult>;
  executeStreamPrompt: (
    prompt: string,
    onChunk?: (chunk: string) => void,
  ) => Promise<IPlaygroundExecutorResult>;
  retryLastExecution: () => Promise<IPlaygroundExecutorResult | null>;
  cancelExecution: () => void;
  clearStreamingResponse: () => void;
}
