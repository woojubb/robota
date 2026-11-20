import type { IAssistantMessage, IToolCall, TUniversalMessage } from './messages';
import type { IAIProvider, IChatOptions, ITokenUsage } from './provider';
import type { IToolExecutionResult } from './tool';
import type { IToolSchema } from './tool-schema';

/** A complete assistant frame whose calls must be admitted together by the host. */
export type TManagedToolBatch = Omit<IAssistantMessage, 'toolCalls'> & {
  toolCalls: [IToolCall, ...IToolCall[]];
};

/** A durable host settlement associated with the native call and host action. */
export interface IManagedToolReceipt {
  toolCallId: string;
  actionId: string;
  result: IToolExecutionResult;
}

/** The committed history and tool projection provided at the start of a managed turn. */
export interface IManagedTurnInput {
  messages: readonly TUniversalMessage[];
  tools: readonly IToolSchema[];
  model: string;
  options: Omit<
    IChatOptions,
    | 'tools'
    | 'model'
    | 'signal'
    | 'onTextDelta'
    | 'onThinkingDelta'
    | 'onProviderNativeRawPayload'
    | 'onModelEffortOutcome'
    | 'onModelFallback'
    | 'outboundTraceContext'
  >;
}

export type TManagedTurnEvent =
  | { kind: 'text-delta'; frameId: string; text: string }
  | { kind: 'thinking-delta'; frameId: string; text: string }
  | { kind: 'usage'; frameId: string; usage: ITokenUsage };

/** A managed final frame cannot ask the host to execute tools a second time. */
export type TManagedTurnResult = Omit<IAssistantMessage, 'toolCalls'> & { toolCalls?: never };

/** Host-owned operations available only while the session turn is active. */
export interface IManagedTurnHost {
  readonly signal: AbortSignal;
  emit(event: TManagedTurnEvent): Promise<void>;
  /**
   * The host journals and validates the complete frame before admitting any of its effects.
   * Receipts are returned only after the corresponding results are durable.
   */
  execute(batch: TManagedToolBatch): Promise<readonly IManagedToolReceipt[]>;
}

/** A provider that owns its native run and submits each complete tool batch to the host. */
export interface IManagedRunProvider {
  readonly kind: 'managed-run';
  readonly name: string;
  readonly version: string;
  run(input: IManagedTurnInput, host: IManagedTurnHost): Promise<TManagedTurnResult>;
  validateConfig(): boolean;
  dispose?(): Promise<void>;
  close?(): Promise<void>;
}

/** The legacy step interface remains accepted while callers migrate to the discriminant. */
export type TExecutionProvider = IAIProvider | IManagedRunProvider;

export class ManagedRunUnavailableError extends Error {
  readonly code = 'MANAGED_RUN_UNAVAILABLE';

  constructor(provider: string) {
    super(`Managed execution is not available for provider ${provider}`);
    this.name = 'ManagedRunUnavailableError';
  }
}

export function isManagedRunProvider(
  provider: TExecutionProvider,
): provider is IManagedRunProvider {
  return 'kind' in provider && provider.kind === 'managed-run';
}
