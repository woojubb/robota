import type { ConversationState } from './conversation-state';
import { RoundtableError } from './errors';
import { assertJsonValue, canonicalJson } from './json';
import { StoreOwner } from './store-owner';
import type { ConversationStore } from './store-types';

/** Owns the committed typed state. Callers can only change it through an awaited transaction. */
export class ConversationPersistence {
  private initialized?: Promise<void>;
  private owner?: StoreOwner;
  private tail: Promise<unknown> = Promise.resolve();
  private committed: ConversationState;

  constructor(
    private readonly store: ConversationStore,
    initial: ConversationState,
    private readonly leaseMs: number,
    restored = false,
  ) {
    this.committed = structuredClone(initial);
    if (restored) this.initialized = Promise.resolve();
  }

  snapshot(): ConversationState {
    return structuredClone(this.committed);
  }

  async begin(): Promise<StoreOwner> {
    const id = this.committed.snapshot.conversationId;
    this.initialized ??= (async () => {
      const state = this.snapshot();
      assertJsonValue(state);
      await this.store.create(id, state);
    })();
    await this.initialized;
    const owner = await StoreOwner.acquire({
      store: this.store,
      conversationId: id,
      leaseMs: this.leaseMs,
    });
    if (
      owner.snapshot().revision !== this.committed.snapshot.revision ||
      canonicalJson(owner.snapshot().state) !== canonicalJson(this.committed)
    ) {
      await owner.close();
      throw new RoundtableError(
        'conflict',
        'Stored conversation changed; explicit recovery is required',
      );
    }
    this.owner = owner;
    return owner;
  }

  update(change: (draft: ConversationState, revision: number) => void): Promise<void> {
    const update = this.tail.then(async () => {
      const owner = this.owner;
      if (!owner)
        throw new RoundtableError('stale-claim', 'Conversation has no active store owner');
      const next = this.snapshot();
      const revision = owner.snapshot().revision + 1;
      change(next, revision);
      next.snapshot.revision = revision;
      assertJsonValue(next);
      await owner.commit(() => next);
      this.committed = structuredClone(next);
    });
    this.tail = update.catch(() => {});
    return update;
  }

  async end(): Promise<void> {
    await this.tail;
    const owner = this.owner;
    this.owner = undefined;
    await owner?.close();
  }
}
