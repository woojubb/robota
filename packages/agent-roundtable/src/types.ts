import type { ConversationStore } from './store-types';
import type { JsonValue } from './json-value';
import type {
  ConversationRequest,
  ParticipantRequest,
  ParticipantResponse,
  ResumeRequest,
  ResponseReceipt,
} from './request-types';
import type {
  ModelCallCapability,
  PricePolicy,
  TurnServices,
  UsageBudget,
  UsageEstimator,
  UsageReconciliation,
  UsageRecord,
} from './usage-types';

export type { JsonValue } from './json-value';
export type {
  ActionRequest,
  ConversationRequest,
  InputRequest,
  ParticipantRequest,
  ParticipantResponse,
  RequestResponse,
  ResponseReceipt,
  ResumeRequest,
} from './request-types';
export type {
  ModelCallBound,
  ModelCallCapability,
  ModelCallIntent,
  Money,
  PricePolicy,
  ToolEffectIntent,
  TurnServices,
  UsageAmount,
  UsageCallKind,
  UsageBudget,
  UsageEstimate,
  UsageEstimator,
  UsageOutcome,
  UsagePrincipal,
  UsageProvenance,
  UsageReconciliation,
  UsageRecord,
  UsageReport,
  UsageReservation,
  UsageSummary,
  UsageTokens,
} from './usage-types';
export { summarizeUsage } from './usage-types';

export interface ParticipantCheckpoint {
  version: string;
  data: JsonValue;
}

export interface RuntimeReference {
  id: string;
  version: string;
}

export interface SharedMessage {
  id: string;
  participantId: string;
  content: string;
  revision: number;
  turnId: string;
  groupId: string;
}

export interface ParticipantTurn {
  conversationId: string;
  participantId: string;
  turnId: string;
  attemptId: string;
  groupId: string;
  purpose?: string;
  context: {
    baseRevision: number;
    messages: readonly SharedMessage[];
    /** Text the context policy substituted for the messages it consumed without delivering them. */
    summary?: string;
    /** Ids of undelivered messages this turn accounts for through `summary` alone, or not at all. */
    consumed?: readonly string[];
  };
}

export type ParticipantOutcome =
  | { kind: 'speak'; content: string }
  | { kind: 'yield' }
  | { kind: 'failed'; message: string }
  | { kind: 'wait'; requests: readonly ParticipantRequest[] };

export interface ParticipantExecutionOptions {
  signal: AbortSignal;
  onDelta: (text: string) => Promise<void>;
  /** Bound to this turn's participant; a participant that makes no model calls can ignore it. */
  services: TurnServices;
}

export interface ParticipantSession {
  /** Exports private state at a settled runtime boundary; never enters the shared transcript. */
  checkpoint?(): Promise<ParticipantCheckpoint>;
  runTurn(turn: ParticipantTurn, options: ParticipantExecutionOptions): Promise<ParticipantOutcome>;
  /** Continue the same turn from a settled wait; never submit its original input again. */
  resumeTurn?(
    turn: ParticipantTurn,
    responses: readonly ParticipantResponse[],
    options: ParticipantExecutionOptions,
  ): Promise<ParticipantOutcome>;
}

export interface ParticipantLease {
  session: ParticipantSession;
  release(): Promise<void>;
}

export interface ParticipantFactory {
  /** Every opened session supports checkpointed waits and resumeTurn. */
  supportsContinuation?: boolean;
  /** Checkpoint formats this factory can restore without migration. */
  checkpointVersions?: readonly string[];
  /**
   * Declared so model-call limits, pricing and budgets can be enforced; required to configure any.
   * A budget accepts only 'none' or 'enforced'.
   */
  modelCalls?: ModelCallCapability;
  openSession(context: {
    conversationId: string;
    participantId: string;
    checkpoint?: ParticipantCheckpoint;
  }): Promise<ParticipantLease>;
}

export interface AgentParticipant {
  kind: 'agent';
  id: string;
  description?: string;
  runtime: RuntimeReference;
  factory: ParticipantFactory;
}

export interface ExternalParticipant {
  kind: 'external';
  id: string;
  description?: string;
}

export type ParticipantDefinition = AgentParticipant | ExternalParticipant;

export type Selection =
  | { kind: 'speak'; participantId: string }
  | { kind: 'parallel'; participantIds: readonly string[] }
  | { kind: 'wait'; participantId: string; reason: string }
  | { kind: 'finish'; reason: string };

export interface CompletedTurn {
  id: string;
  groupId: string;
  participantId: string;
  outcome: 'speak' | 'yield';
}

export interface SelectionContext {
  participants: readonly { id: string; kind: 'agent' | 'external'; description?: string }[];
  messages: readonly SharedMessage[];
  turns: readonly CompletedTurn[];
  remainingTurns: number;
}

export interface TurnSelector {
  /** A version covers policy and configuration. Unversioned selectors cannot be loaded. */
  reference?: RuntimeReference;
  /**
   * Declared so model-call limits, pricing and budgets can be enforced; required to configure any.
   * A budget accepts only 'none' or 'enforced'.
   */
  modelCalls?: ModelCallCapability;
  /** Omit only for a stateless policy whose progress is derived from the selection context. */
  checkpoint?(): Promise<ParticipantCheckpoint>;
  select(
    context: SelectionContext,
    options: { signal: AbortSignal; services: TurnServices },
  ): Selection | Promise<Selection>;
}

export interface ContextAssemblyInput {
  recipient: { kind: 'participant'; id: string };
  /** Every message the recipient has not consumed and did not write, in transcript order. */
  undelivered: readonly SharedMessage[];
  purpose?: string;
}

export interface ContextAssembly {
  /** A subset of `undelivered`, each message unchanged and listed once. */
  messages: readonly SharedMessage[];
  /** Replaces what `consumed` leaves out; non-empty, at most 32768 characters, never a message. */
  summary?: string;
  /**
   * Ids of undelivered messages left out of `messages` that are consumed anyway: the recipient is
   * never offered them again. An undelivered message in neither list is deferred to a later turn.
   */
  consumed: readonly string[];
}

/** What a participant is offered at the start of its turn out of the messages it has not seen. */
export interface ContextPolicy {
  /** A version covers policy and configuration; a conversation saves it and loading must resolve the same one. */
  reference: RuntimeReference;
  /** Only a policy that makes no model calls is admitted; a model-backed summarizer is a metered caller. */
  modelCalls?: 'none';
  /**
   * A function of its input alone: its own state is not saved, and the view it assembles is stored
   * with the turn, so a loaded conversation never asks again. An invalid or thrown result fails the
   * conversation before any turn starts.
   */
  assemble(input: ContextAssemblyInput): ContextAssembly;
}

export interface SelectorRegistration {
  reference: RuntimeReference;
  checkpointVersions?: readonly string[];
  create(context: { checkpoint?: ParticipantCheckpoint }): TurnSelector | Promise<TurnSelector>;
}

/** Host-owned bindings; credentials, functions and live clients never enter stored state. */
export interface RoundtableRegistry {
  resolveParticipant(
    reference: RuntimeReference,
  ):
    | { reference: RuntimeReference; factory: ParticipantFactory }
    | Promise<{ reference: RuntimeReference; factory: ParticipantFactory }>;
  resolveSelector?(
    reference: RuntimeReference,
  ): SelectorRegistration | Promise<SelectorRegistration>;
  /** Required to load a conversation saved with a context policy other than the built-in one. */
  resolveContextPolicy?(reference: RuntimeReference): ContextPolicy | Promise<ContextPolicy>;
}

export interface LoadRoundtableOptions {
  conversationId: string;
  store: ConversationStore;
  registry: RoundtableRegistry;
  /** Must match the version the conversation was created or last loaded with. */
  pricing?: PricePolicy;
  /** Required to load a conversation saved with an estimated budget, and refused for any other. */
  estimator?: UsageEstimator;
  onEvent?: RoundtableOptions['onEvent'];
  onEventError?: RoundtableOptions['onEventError'];
}

export interface ConversationSnapshot {
  conversationId: string;
  revision: number;
  messages: SharedMessage[];
  turns: CompletedTurn[];
  requests: ConversationRequest[];
  usage: UsageRecord[];
}

export type RunResult = { revision: number } & (
  | { status: 'completed'; reason: string }
  | { status: 'limited'; reason: 'turns' | 'time' | 'model-calls' | 'budget' }
  | { status: 'cancelled' }
  | { status: 'failed'; message: string }
  | { status: 'waiting'; requests: ConversationRequest[] }
);

export type RoundtableEvent =
  | { type: 'group-started'; groupId: string; participantIds: string[]; baseRevision: number }
  | { type: 'delta'; groupId: string; turnId: string; participantId: string; text: string }
  | { type: 'prepared'; groupId: string; turnId: string; participantId: string }
  | { type: 'published'; groupId: string; messages: SharedMessage[] }
  | { type: 'usage'; record: UsageRecord };

export interface RoundtableOptions {
  conversationId: string;
  purpose?: string;
  participants: readonly ParticipantDefinition[];
  selector?: TurnSelector;
  /** Defaults to `increments()`; its reference is saved with the conversation and checked on load. */
  contextPolicy?: ContextPolicy;
  limits: {
    maxTurnsPerRun: number;
    timeoutMs?: number;
    maxModelCallsPerRun?: number;
    maxModelCallsPerConversation?: number;
    maxModelCallsPerParticipant?: number;
  };
  maxConcurrentParticipants?: number;
  store?: ConversationStore;
  recovery?: 'none' | 'durable';
  leaseMs?: number;
  /** Requires every agent factory and the selector to declare `modelCalls`. */
  pricing?: PricePolicy;
  /**
   * A token or cost ceiling over the whole conversation, saved with it. Requires every agent factory
   * and the selector to declare `modelCalls` as 'none' or 'enforced'; a cost amount requires `pricing`.
   */
  budget?: UsageBudget;
  /** Supplies a call's bound in an 'estimated' budget, and is refused with any other mode. */
  estimator?: UsageEstimator;
  onEvent?: (event: RoundtableEvent) => void | Promise<void>;
  onEventError?: (error: unknown, event: RoundtableEvent) => void | Promise<void>;
}

export interface ExternalInput {
  participantId: string;
  inputId: string;
  expectedRevision: number;
  replyToRequestId?: string;
  content: string;
}

export interface Roundtable {
  /**
   * Advance until the conversation waits, finishes or reaches a limit. Cancellation, disposal and
   * limits end only this run: a result a participant returned is kept, and an attempt stopped
   * without one runs again on the next run. Failure and completion are final and are returned by
   * every later run. Rejects with `recovery-required` only when stored state holds a turn that was
   * never seen to settle, such as after the process stopped mid-turn.
   */
  run(options?: { signal?: AbortSignal }): Promise<RunResult>;
  submitInput(input: ExternalInput): Promise<{ revision: number; messageId: string }>;
  /** Accept a correlated response; execution advances only on a later run(). */
  resume(input: ResumeRequest): Promise<ResponseReceipt>;
  /**
   * Settles what a call whose usage was never fully reported counts against the budget, replacing the
   * bound it keeps counted until then. Only the host can do this: a participant cannot refund itself.
   * The same amounts again are a no-op; different ones, or a call whose usage is already known, conflict.
   * Never changes a call count, and is refused while a run, input or resume is active.
   */
  reconcileUsage(input: UsageReconciliation): Promise<{ revision: number }>;
  snapshot(): ConversationSnapshot;
  dispose(): Promise<void>;
}
