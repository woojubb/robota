import type {
  ConversationSnapshot,
  ParticipantCheckpoint,
  ParticipantOutcome,
  ParticipantTurn,
  RunResult,
  RuntimeReference,
  Selection,
} from './types';

export interface StoredMember {
  participantId: string;
  turn: ParticipantTurn;
  messageId: string;
  status: 'pending' | 'running' | 'settled' | 'prepared' | 'failed';
  checkpoint: ParticipantCheckpoint | null;
  outcome: Exclude<ParticipantOutcome, { kind: 'failed' }> | null;
  error: string | null;
}

export interface ConversationState {
  schemaVersion: 1;
  definition: {
    purpose: string | null;
    limits: { maxTurnsPerRun: number; timeoutMs: number | null };
    maxConcurrentParticipants: number;
    recovery: 'none' | 'durable';
    leaseMs: number;
    selector: RuntimeReference | null;
    contextPolicy: RuntimeReference;
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
  phase:
    | { kind: 'ready' }
    | { kind: 'selecting'; attemptId: string }
    | { kind: 'selected'; attemptId: string; selection: Selection }
    | { kind: 'group'; groupId: string; baseRevision: number; members: StoredMember[] };
  terminal: RunResult | null;
}
