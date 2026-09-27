import type { ConversationStore } from './store-types';
import type { JsonValue } from './json-value';
import type {
  ConversationRequest,
  ParticipantRequest,
  ParticipantResponse,
  ResumeRequest,
  ResponseReceipt,
} from './request-types';

export type { JsonValue } from './json-value';
export type * from './request-types';

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
  context: { baseRevision: number; messages: readonly SharedMessage[] };
}

export type ParticipantOutcome =
  | { kind: 'speak'; content: string }
  | { kind: 'yield' }
  | { kind: 'failed'; message: string }
  | { kind: 'wait'; requests: readonly ParticipantRequest[] };

export interface ParticipantExecutionOptions {
  signal: AbortSignal;
  onDelta: (text: string) => Promise<void>;
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
  /** Omit only for a stateless policy whose progress is derived from the selection context. */
  checkpoint?(): Promise<ParticipantCheckpoint>;
  select(
    context: SelectionContext,
    options: { signal: AbortSignal },
  ): Selection | Promise<Selection>;
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
}

export interface LoadRoundtableOptions {
  conversationId: string;
  store: ConversationStore;
  registry: RoundtableRegistry;
  onEvent?: RoundtableOptions['onEvent'];
  onEventError?: RoundtableOptions['onEventError'];
}

export interface ConversationSnapshot {
  conversationId: string;
  revision: number;
  messages: SharedMessage[];
  turns: CompletedTurn[];
  requests: ConversationRequest[];
}

export type RunResult = { revision: number } & (
  | { status: 'completed'; reason: string }
  | { status: 'limited'; reason: 'turns' | 'time' }
  | { status: 'cancelled' }
  | { status: 'failed'; message: string }
  | { status: 'waiting'; requests: ConversationRequest[] }
);

export type RoundtableEvent =
  | { type: 'group-started'; groupId: string; participantIds: string[]; baseRevision: number }
  | { type: 'delta'; groupId: string; turnId: string; participantId: string; text: string }
  | { type: 'prepared'; groupId: string; turnId: string; participantId: string }
  | { type: 'published'; groupId: string; messages: SharedMessage[] };

export interface RoundtableOptions {
  conversationId: string;
  purpose?: string;
  participants: readonly ParticipantDefinition[];
  selector?: TurnSelector;
  limits: { maxTurnsPerRun: number; timeoutMs?: number };
  maxConcurrentParticipants?: number;
  store?: ConversationStore;
  recovery?: 'none' | 'durable';
  leaseMs?: number;
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
  run(options?: { signal?: AbortSignal }): Promise<RunResult>;
  submitInput(input: ExternalInput): Promise<{ revision: number; messageId: string }>;
  /** Accept a correlated response; execution advances only on a later run(). */
  resume(input: ResumeRequest): Promise<ResponseReceipt>;
  snapshot(): ConversationSnapshot;
  dispose(): Promise<void>;
}
