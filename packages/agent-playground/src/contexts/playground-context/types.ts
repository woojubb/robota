import type { Dispatch, MutableRefObject, ReactNode } from 'react';

import type {
  IPlaygroundAgentConfig,
  IPlaygroundExecutorResult,
  IVisualizationData,
  PlaygroundExecutor,
} from '../../lib/playground/robota-executor';
import type { IPlaygroundToolMeta } from '../../tools/catalog';
import type { IPlaygroundState, TPlaygroundReducerAction } from '../playground-reducer';

export interface IPlaygroundActionsValue {
  createAgent: (config: IPlaygroundAgentConfig) => Promise<void>;
  addAgentConfig: (config: IPlaygroundAgentConfig) => void;
  updateAgentConfig: (index: number, config: IPlaygroundAgentConfig) => void;
  executePrompt: (prompt: string) => Promise<IPlaygroundExecutorResult>;
  executeStreamPrompt: (
    prompt: string,
    onChunk: (chunk: string) => void,
  ) => Promise<IPlaygroundExecutorResult>;
  clearHistory: () => void;
  setAuth: (userId: string, sessionId: string, authToken: string) => void;
  disposeExecutor: () => Promise<void>;
  setExecuting: (isExecuting: boolean) => void;
  setToolItems: (tools: IPlaygroundToolMeta[]) => void;
  addToolToAgentOverlay: (agentId: string, toolId: string) => void;
  getVisualizationData: () => IVisualizationData | null;
  getConnectionStatus: () => { connected: boolean; url: string };
}

export interface IPlaygroundContextValue extends IPlaygroundActionsValue {
  state: IPlaygroundState;
}

export interface IPlaygroundProviderProps {
  children: ReactNode;
  defaultServerUrl?: string;
}

export interface IPlaygroundRefs {
  executorRef: MutableRefObject<PlaygroundExecutor | null>;
  isInitializedRef: MutableRefObject<boolean>;
  modeRef: MutableRefObject<IPlaygroundState['mode']>;
  wsConnectedRef: MutableRefObject<boolean>;
  visualizationDataRef: MutableRefObject<IVisualizationData | null>;
  connectionStatusRef: MutableRefObject<{ connected: boolean; url: string }>;
}

export type TPlaygroundDispatch = Dispatch<TPlaygroundReducerAction>;
