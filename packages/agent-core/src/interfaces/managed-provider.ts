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

/** A text final frame carries no deferred actions or unverified native continuation. */
export type TManagedTurnResult = Pick<IAssistantMessage, 'id' | 'role' | 'timestamp' | 'state'> & {
  content: string;
  toolCalls?: never;
  metadata?: never;
  parts?: never;
};

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

/** A Session-owned, turn-scoped admission that becomes invalid when its claim is released. */
export interface IManagedTurnAdmission {
  assertActive(): void;
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

/** Explicit model-step form for registries that use the discriminated contract. */
export interface IModelStepProvider extends IAIProvider {
  readonly kind: 'model-step';
}

/** Both new execution forms can be narrowed directly by their kind. */
export type TDiscriminatedExecutionProvider = IModelStepProvider | IManagedRunProvider;

/** Untagged model-step providers remain accepted during the compatibility window. */
export type TExecutionProvider = IAIProvider | TDiscriminatedExecutionProvider;

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
