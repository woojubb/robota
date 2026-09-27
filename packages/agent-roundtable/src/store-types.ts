import type { JsonValue } from './json-value';

/** A store preserves the complete envelope; the conversation owner decodes its state. */
export interface ConversationEnvelope {
  schemaVersion: 1;
  conversationId: string;
  revision: number;
  state: JsonValue;
}

export interface ConversationClaim {
  conversationId: string;
  ownerId: string;
  fence: number;
  /** UTC Unix milliseconds; store and scheduler clocks must have bounded skew. */
  expiresAt: number;
}

export interface ConversationCommit {
  claim: ConversationClaim;
  expectedRevision: number;
  operationId: string;
  state: JsonValue;
}

export interface ConversationStore {
  readonly durability: 'memory' | 'durable';
  create(conversationId: string, state: JsonValue): Promise<ConversationEnvelope>;
  load(conversationId: string): Promise<ConversationEnvelope | undefined>;
  claim(conversationId: string, ownerId: string, leaseMs: number): Promise<ConversationClaim>;
  /** Atomic: never renew an expired/released/replaced claim or recreate its fence. */
  renew(claim: ConversationClaim, leaseMs: number): Promise<ConversationClaim>;
  release(claim: ConversationClaim): Promise<void>;
  commit(change: ConversationCommit): Promise<ConversationEnvelope>;
  lookupOperation(
    conversationId: string,
    operationId: string,
  ): Promise<ConversationEnvelope | undefined>;
}
