import type { TUniversalMessage } from './messages';
import type { IManagedToolReceipt } from './managed-provider';
import type { IChatOptions } from './provider';
import type { IToolExecutionResult, TToolParameters } from './tool';
import type { TToolSearchSetting } from './tool-search';
import type { IRunTraceContext } from './trace-context';
import type { TMetadata } from './types';
import type { IToolContinuationPrompt, IToolWaitResponse } from './tool-continuation';

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

/** Data-only effective scheduling policy bound to a journaled tool batch. */
export interface IJournalToolBatchPolicy {
  version: 1;
  mode: 'parallel' | 'sequential';
  maxConcurrency: number;
  continueOnError: boolean;
  /** Invalid declarations are retained so the scheduler can produce its ordinary refusal. */
  scheduling?: Array<[unknown, unknown]>;
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
    | (IJournalActionIdentity & {
        kind: 'tool-intent';
        parameters: TToolParameters;
        batchPolicy?: IJournalToolBatchPolicy;
      })
    | (IJournalActionIdentity & { kind: 'tool-dispatch' })
    | (IJournalActionIdentity & { kind: 'tool-effect-start'; parameters: TToolParameters })
    | (IJournalActionIdentity & {
        kind: 'tool-wait';
        request: IToolContinuationPrompt & { requestId: string };
      })
    | (IJournalActionIdentity & { kind: 'tool-response'; response: IToolWaitResponse })
    | (IJournalActionIdentity & {
        kind: 'tool-result';
        result: IToolExecutionResult;
        loadedDeferredTools?: string[];
        batchPolicy?: IJournalToolBatchPolicy;
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
 * Stored records must round-trip their value types and shared references without collapsing them.
 * New batches record their effective scheduling policy and refuse a conflicting recovery policy.
 * For older records without a policy binding, the host must preserve an equivalent active policy.
 */
export interface IRecoverableExecutionJournal extends IExecutionJournal {
  read(executionId: string): Promise<readonly TExecutionJournalRecord[]>;
}

export interface IResumeToolCallsOptions {
  executionId: string;
  callId: string;
  journal: IRecoverableExecutionJournal;
  /** Exact replies to saved requests; receipts are persisted before further execution. */
  toolResponses?: readonly IToolWaitResponse[];
  /**
   * Return durable action receipts. A receipt alone does not prove that a native runtime is waiting
   * for the same call; its connection, conversation, frame and action frontier must also match.
   * Existing assistant history must match the complete saved response. Some model-step commits
   * project away provider parts or metadata; in that case receipt recovery refuses the history.
   */
  includeReceipts?: boolean;
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
export interface IResumeExecutionOptions extends Omit<
  IResumeToolCallsOptions,
  'callId' | 'includeReceipts'
> {
  onTextDelta?: IChatOptions['onTextDelta'];
  onThinkingDelta?: IChatOptions['onThinkingDelta'];
  traceContext?: IRunTraceContext;
}

export interface IResumeToolCallsResult {
  executionId: string;
  callId: string;
  messages: TUniversalMessage[];
  /** Present when requested and all batch results have durable settlements. */
  receipts?: readonly IManagedToolReceipt[];
}

/** Host-owned identity for a journaled provider invocation, including routing changes. */
export interface IModelJournalContext {
  journal: IExecutionJournal;
  executionId: string;
  callId: string;
  checkpoint?: IExecutionRoundCheckpoint;
  route(): { providerId: string; modelId: string };
}
