import type { TUniversalMessage } from './messages';
import type { IChatOptions } from './provider';
import type { IToolExecutionResult, TToolParameters } from './tool';
import type { TToolSearchSetting } from './tool-search';
import type { IRunTraceContext } from './trace-context';
import type { TMetadata } from './types';

/** Data-only provider options; callbacks, signals, tracing and adapter credentials are excluded. */
export type TJournalModelOptions = Pick<
  IChatOptions,
  | 'model'
  | 'tools'
  | 'maxTokens'
  | 'temperature'
  | 'effort'
  | 'toolChoice'
  | 'nativeWebTools'
  | 'responseFormat'
>;

interface IJournalIdentity {
  recordId: string;
  executionId: string;
}
interface IJournalModelIdentity {
  callId: string;
  providerId: string;
  modelId: string;
}
interface IJournalActionIdentity {
  actionId: string;
  parentCallId: string;
  toolCallId: string;
  toolName: string;
}

export interface IExecutionContinuationState {
  version: 1;
  kind: 'round' | 'summary';
  startedAt: string;
  turnMessageId: string;
  model: Pick<IChatOptions, 'maxTokens' | 'temperature' | 'effort' | 'toolChoice'> & {
    provider: string;
    model: string;
    topP?: number;
  };
  timeout?: number;
  toolSearch?: TToolSearchSetting;
  structuredOutput: boolean;
  /** Versioned data contract; runtime callbacks and signals are supplied by the recovering host. */
  options: Pick<IChatOptions, 'maxTokens' | 'temperature' | 'toolChoice'> & {
    maxExecutionRounds: number;
    maxSameToolInputs?: number;
    allowToolOnlyCompletion: boolean;
    withholdHostedTools: boolean;
    ephemeralSystemContext?: string;
    sessionId?: string;
    userId?: string;
    metadata?: TMetadata;
  };
  toolsExecuted: string[];
  consecutiveUnknownToolFailureRounds: number;
  forcedSummaryInstruction?: string;
  loadedDeferredTools?: string[];
}

/** Canonical private history, separate from transformed/ephemeral provider input. */
export interface IExecutionRoundCheckpoint {
  version: 1;
  effectAdmission: 'required';
  messages: TUniversalMessage[];
  round: number;
  contextLimit: number;
  cumulativeInputTokens: number;
  sameToolInputCounts: Array<[string, number]>;
  maxSameToolInputs?: number;
  continuation?: IExecutionContinuationState;
  /** Versioned state belonging to a runtime wrapper, never inferred from transcript text. */
  owner?: { kind: string; version: number; state: TToolParameters };
}

export type TExecutionJournalRecord = IJournalIdentity &
  (
    | (IJournalModelIdentity & {
        kind: 'model-request';
        messages: TUniversalMessage[];
        options: TJournalModelOptions;
        checkpoint?: IExecutionRoundCheckpoint;
      })
    | (IJournalModelIdentity & { kind: 'model-response'; response: TUniversalMessage })
    | (IJournalModelIdentity & {
        kind: 'model-cache-hit';
        response: TUniversalMessage;
        checkpoint?: IExecutionRoundCheckpoint;
      })
    | (IJournalModelIdentity & { kind: 'model-failure'; error: { name: string; message: string } })
    | (IJournalActionIdentity & { kind: 'tool-intent'; parameters: TToolParameters })
    | (IJournalActionIdentity & { kind: 'tool-dispatch' })
    | (IJournalActionIdentity & { kind: 'tool-effect-start'; parameters: TToolParameters })
    | (IJournalActionIdentity & {
        kind: 'tool-result';
        result: IToolExecutionResult;
        loadedDeferredTools?: string[];
      })
  );

/**
 * Awaited, fail-closed execution boundary. Rejection stops this run before further dispatch.
 * The host owns storage, serialization of message dates, idempotency and recovery decisions.
 * Model records describe an adapter invocation, not its opaque retries or network requests.
 * Only a supported mandatory-effect checkpoint can prove an unstarted action; an intent alone cannot.
 */
export interface IExecutionJournal {
  append(record: TExecutionJournalRecord): Promise<void>;
}

/**
 * Reads the complete, ordered, current prefix from the same authority used for append.
 * The host must hold exclusive fenced ownership and drain the old runtime before recovery.
 * Appending an identical recordId is idempotent; conflicting content must be rejected.
 */
export interface IRecoverableExecutionJournal extends IExecutionJournal {
  read(executionId: string): Promise<readonly TExecutionJournalRecord[]>;
}

export interface IResumeToolCallsOptions {
  executionId: string;
  callId: string;
  journal: IRecoverableExecutionJournal;
  signal?: AbortSignal;
  /** Observe newly committed recovery history using the ordinary history-mutation contract. */
  onExecutionEvent?: (event: string, data: Record<string, unknown>) => void;
}

/**
 * Continue the latest settled invocation on the original provider/model under exclusive host ownership.
 * Structured-output validators and unknown effects require reconciliation rather than automatic replay.
 * Turn-level lifecycle hooks are omitted because their effects have no durable receipts;
 * hosts requiring those effects must settle them separately. Recovered history remains available.
 */
export interface IResumeExecutionOptions extends Omit<IResumeToolCallsOptions, 'callId'> {
  onTextDelta?: IChatOptions['onTextDelta'];
  traceContext?: IRunTraceContext;
}

export interface IResumeToolCallsResult {
  executionId: string;
  callId: string;
  messages: TUniversalMessage[];
}

/** Host-owned identity for a journaled provider invocation, including routing changes. */
export interface IModelJournalContext {
  journal: IExecutionJournal;
  executionId: string;
  callId: string;
  checkpoint?: IExecutionRoundCheckpoint;
  route(): { providerId: string; modelId: string };
}
