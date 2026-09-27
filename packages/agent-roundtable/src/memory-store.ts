import { RoundtableError } from './errors';
import { canonicalJson } from './json';
import type {
  ConversationClaim,
  ConversationCommit,
  ConversationEnvelope,
  ConversationStore,
} from './store-types';
import type { JsonValue } from './types';

interface Entry {
  envelope: ConversationEnvelope;
  fence: number;
  claim?: ConversationClaim;
  operations: Map<string, { fingerprint: string; envelope: ConversationEnvelope }>;
}

/** Process-local implementation. It deliberately does not advertise durable recovery. */
export class MemoryConversationStore implements ConversationStore {
  readonly durability = 'memory' as const;
  private readonly entries = new Map<string, Entry>();
  private readonly now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
  }

  async create(conversationId: string, state: JsonValue): Promise<ConversationEnvelope> {
    if (!conversationId) throw new RoundtableError('invalid-config', 'Conversation id is required');
    canonicalJson(state);
    if (this.entries.has(conversationId))
      throw new RoundtableError('conflict', 'Conversation already exists');
    const envelope: ConversationEnvelope = {
      schemaVersion: 1,
      conversationId,
      revision: 0,
      state: structuredClone(state),
    };
    this.entries.set(conversationId, { envelope, fence: 0, operations: new Map() });
    return structuredClone(envelope);
  }

  async load(conversationId: string): Promise<ConversationEnvelope | undefined> {
    return structuredClone(this.entries.get(conversationId)?.envelope);
  }

  async claim(
    conversationId: string,
    ownerId: string,
    leaseMs: number,
  ): Promise<ConversationClaim> {
    const entry = this.entry(conversationId);
    const expiresAt = this.expiry(leaseMs);
    if (!ownerId) throw new RoundtableError('invalid-config', 'Claim owner id is required');
    if (entry.claim && entry.claim.expiresAt > this.now()) {
      throw new RoundtableError('busy', 'Conversation has an unexpired owner');
    }
    const claim = { conversationId, ownerId, fence: ++entry.fence, expiresAt };
    entry.claim = claim;
    return { ...claim };
  }

  async renew(claim: ConversationClaim, leaseMs: number): Promise<ConversationClaim> {
    const entry = this.owned(claim);
    entry.claim = { ...claim, expiresAt: this.expiry(leaseMs) };
    return { ...entry.claim };
  }

  async release(claim: ConversationClaim): Promise<void> {
    const entry = this.owned(claim);
    entry.claim = undefined;
  }

  async commit(change: ConversationCommit): Promise<ConversationEnvelope> {
    if (!change.operationId)
      throw new RoundtableError('invalid-config', 'Commit operation id is required');
    const fingerprint = canonicalJson({
      expectedRevision: change.expectedRevision,
      state: change.state,
    });
    const entry = this.entry(change.claim.conversationId);
    const previous = entry.operations.get(change.operationId);
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new RoundtableError('conflict', 'Operation id was used for another commit');
      return structuredClone(previous.envelope);
    }
    this.owned(change.claim);
    if (entry.envelope.revision !== change.expectedRevision) {
      throw new RoundtableError('conflict', 'Conversation revision changed');
    }
    const envelope: ConversationEnvelope = {
      schemaVersion: 1,
      conversationId: change.claim.conversationId,
      revision: change.expectedRevision + 1,
      state: structuredClone(change.state),
    };
    entry.envelope = envelope;
    entry.operations.set(change.operationId, { fingerprint, envelope });
    return structuredClone(envelope);
  }

  async lookupOperation(
    conversationId: string,
    operationId: string,
  ): Promise<ConversationEnvelope | undefined> {
    return structuredClone(this.entries.get(conversationId)?.operations.get(operationId)?.envelope);
  }

  private entry(id: string): Entry {
    const entry = this.entries.get(id);
    if (!entry) throw new RoundtableError('conflict', 'Conversation does not exist');
    return entry;
  }

  private owned(claim: ConversationClaim): Entry {
    const entry = this.entry(claim.conversationId);
    if (
      !entry.claim ||
      entry.claim.fence !== claim.fence ||
      entry.claim.ownerId !== claim.ownerId ||
      entry.claim.expiresAt <= this.now()
    ) {
      throw new RoundtableError('stale-claim', 'Conversation claim expired or changed owner');
    }
    return entry;
  }

  private expiry(leaseMs: number): number {
    const now = this.now();
    if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0 || !Number.isSafeInteger(now + leaseMs)) {
      throw new RoundtableError(
        'invalid-config',
        'Lease duration and clock must produce a finite expiry',
      );
    }
    return now + leaseMs;
  }
}
