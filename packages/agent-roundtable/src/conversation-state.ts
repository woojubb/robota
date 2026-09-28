import type {
  ConversationSnapshot,
  ParticipantCheckpoint,
  ParticipantOutcome,
  ParticipantTurn,
  RunResult,
  RuntimeReference,
  Selection,
  ParticipantResponse,
  ResponseReceipt,
} from './types';

/** Only failure and semantic completion end a conversation; other run results leave it resumable. */
export type TerminalResult = Extract<RunResult, { status: 'completed' | 'failed' }>;

export interface StoredMember {
  participantId: string;
  turn: ParticipantTurn;
  messageId: string;
  status: 'pending' | 'running' | 'settled' | 'prepared' | 'waiting' | 'resumable' | 'failed';
  requestIds: string[];
  checkpoint: ParticipantCheckpoint | null;
  outcome: Exclude<ParticipantOutcome, { kind: 'failed' }> | null;
  error: string | null;
}

export interface ConversationState {
  schemaVersion: 1;
  definition: {
    purpose: string | null;
    limits: {
      maxTurnsPerRun: number;
      timeoutMs: number | null;
      maxModelCallsPerRun: number | null;
      maxModelCallsPerConversation: number | null;
      maxModelCallsPerParticipant: number | null;
    };
    maxConcurrentParticipants: number;
    recovery: 'none' | 'durable';
    leaseMs: number;
    selector: RuntimeReference | null;
    contextPolicy: RuntimeReference;
    /** Null until a pricing policy is first configured; then immutable without explicit migration. */
    pricingVersion: string | null;
  };
  selectorCheckpoint: ParticipantCheckpoint | null;
  snapshot: ConversationSnapshot;
  participants: {
    id: string;
    description: string | null;
    runtime: RuntimeReference | null;
    checkpoint: ParticipantCheckpoint | null;
    delivered: string[];
  }[];
  inputs: { id: string; fingerprint: string; result: { revision: number; messageId: string } }[];
  responses: {
    value: ParticipantResponse;
    fingerprint: string;
    result: ResponseReceipt;
    inputMessageId: string | null;
    inputTurnId: string | null;
  }[];
  phase:
    | { kind: 'ready' }
    | { kind: 'selecting'; attemptId: string }
    | { kind: 'selected'; attemptId: string; selection: Selection }
    | { kind: 'group'; groupId: string; baseRevision: number; members: StoredMember[] };
  terminal: TerminalResult | null;
}
