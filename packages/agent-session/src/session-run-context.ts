import type { ContextWindowTracker } from './context-window-tracker.js';
import type { TSessionLogData } from './session-logger.js';
import type { IProviderCallTraceObservation, ISessionOptions } from './session-types.js';
import type {
  Robota,
  IAIProvider,
  IExecutionJournal,
  IContextWindowState,
  IModelFallbackNotice,
  IHookTypeExecutor,
  ISubprocessTraceEnv,
  TTextDeltaCallback,
  TModelEffortSelection,
} from '@robota-sdk/agent-core';

/** Dependencies injected by Session.run() */
export interface IRunContext {
  sessionId: string;
  cwd: string;
  model: string;
  /** Model-effort selection for informational model-call hooks. */
  effort?: TModelEffortSelection;
  /** Current permission mode — passed to all hook inputs as permission_mode */
  permissionMode?: string;
  /** Absolute path to session transcript file — passed to all hook inputs as transcript_path */
  transcriptPath?: string;
  agent: Robota;
  aiProvider: IAIProvider;
  contextTracker: ContextWindowTracker;
  hooks: Record<string, unknown> | undefined;
  hookTypeExecutors: IHookTypeExecutor[] | undefined;
  sessionStartStdout: string;
  log: (event: string, data: TSessionLogData) => void;
  /** RUNTIME-004: abort must not rewrite history. `hookTraceEnv` is the prompt's, for PreCompact. */
  compact: (
    signal?: AbortSignal,
    hookTraceEnv?: ISubprocessTraceEnv,
    executionJournal?: IExecutionJournal,
  ) => Promise<void>;
  persistSession: () => void;
  getSessionStore: () => boolean;
  clearSessionStartStdout: () => void;
  maxTurns?: number;
  onTextDelta?: TTextDeltaCallback;
  onContextUpdate?: (state: IContextWindowState) => void;
  onToolExecution?: ISessionOptions['onToolExecution'];
  emitProviderCallCompleted?: (observation: IProviderCallTraceObservation) => void;
  /** Tell the session's owner a request moved to another model, so it can say so. */
  emitProviderFallback?: (notice: IModelFallbackNotice) => void;
  knownToolNames?: readonly string[];
}
