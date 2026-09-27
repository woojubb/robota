import { RoundtableError } from './errors';
import { abortableWait } from './abortable-wait';
import { canonicalJson } from './json';
import type { ConversationClaim, ConversationEnvelope, ConversationStore } from './store-types';
import type { JsonValue } from './types';

/** Serializes commits from concurrent members under one fenced conversation owner. */
export class StoreOwner {
  private readonly abort = new AbortController();
  readonly signal = this.abort.signal;
  private tail: Promise<unknown> = Promise.resolve();
  private renewal?: Promise<void>;
  private heartbeat?: ReturnType<typeof setTimeout>;
  private expiry?: ReturnType<typeof setTimeout>;
  private closing?: Promise<void>;
  private closed = false;

  private constructor(
    private readonly store: ConversationStore,
    private claim: ConversationClaim,
    private envelope: ConversationEnvelope,
    private readonly leaseMs: number,
  ) {
    this.schedule();
  }

  static async acquire(options: {
    store: ConversationStore;
    conversationId: string;
    leaseMs: number;
  }): Promise<StoreOwner> {
    const claim = await options.store.claim(
      options.conversationId,
      crypto.randomUUID(),
      options.leaseMs,
    );
    try {
      const envelope = await options.store.load(options.conversationId);
      if (!envelope) throw new RoundtableError('conflict', 'Claimed conversation does not exist');
      return new StoreOwner(options.store, claim, envelope, options.leaseMs);
    } catch (error) {
      await options.store.release(claim).catch(() => {});
      throw error;
    }
  }

  snapshot(): ConversationEnvelope {
    return structuredClone(this.envelope);
  }

  commit(change: (state: JsonValue, revision: number) => JsonValue): Promise<ConversationEnvelope> {
    if (this.closed)
      return Promise.reject(new RoundtableError('stale-claim', 'Conversation owner is closed'));
    const operation = this.tail.then(async () => {
      this.assertActive();
      // Calculate against the latest committed state, never a sibling's captured snapshot.
      const state = structuredClone(
        change(structuredClone(this.envelope.state), this.envelope.revision),
      );
      const fingerprint = canonicalJson(state);
      await this.admit();
      const operationId = crypto.randomUUID();
      const expectedRevision = this.envelope.revision;
      let confirmed: ConversationEnvelope;
      try {
        try {
          confirmed = await this.store.commit({
            claim: this.claim,
            expectedRevision,
            operationId,
            state,
          });
        } catch (error) {
          // A rejected network response does not tell us whether the transaction committed.
          const receipt = await this.store.lookupOperation(this.claim.conversationId, operationId);
          if (!receipt) throw error;
          confirmed = receipt;
        }
        if (
          confirmed.schemaVersion !== 1 ||
          confirmed.conversationId !== this.claim.conversationId ||
          confirmed.revision !== expectedRevision + 1 ||
          canonicalJson(confirmed.state) !== fingerprint
        ) {
          throw new RoundtableError('conflict', 'Store returned a mismatched commit receipt');
        }
      } catch (error) {
        this.lose(error);
        throw error;
      }
      this.envelope = structuredClone(confirmed);
      return this.snapshot();
    });
    // A rejected write must not leave unhandled rejections or allow queued effects to continue.
    this.tail = operation.catch(() => {});
    return operation;
  }

  /** Call at each runtime dispatch boundary, then recheck signal before entering runtime code. */
  async admit(): Promise<void> {
    this.assertActive();
    await abortableWait(this.renew(), this.signal);
    this.assertActive();
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.lose(new RoundtableError('stale-claim', 'Conversation owner is closed'));
    this.closing = (async () => {
      await this.tail;
      // Renewal cannot recreate a released fence. Its delayed response does not own cleanup.
      try {
        await this.store.release(this.claim);
      } catch (error) {
        if (!(error instanceof RoundtableError && error.code === 'stale-claim')) throw error;
      }
    })();
    return this.closing;
  }

  private async renew(): Promise<void> {
    if (this.renewal) return this.renewal;
    this.assertActive();
    const pending = this.store
      .renew(this.claim, this.leaseMs)
      .then((claim) => {
        if (
          claim.fence !== this.claim.fence ||
          claim.ownerId !== this.claim.ownerId ||
          claim.conversationId !== this.claim.conversationId ||
          !Number.isSafeInteger(claim.expiresAt)
        ) {
          throw new RoundtableError('stale-claim', 'Store returned a different claim');
        }
        // A late renewal must never revive an owner whose local lease already expired.
        if (!this.signal.aborted && !this.closed) {
          this.claim = claim;
          this.schedule();
        }
      })
      .catch((error: unknown) => {
        this.lose(error);
        throw error;
      })
      .finally(() => {
        this.renewal = undefined;
      });
    this.renewal = pending;
    return pending;
  }

  private assertActive(): void {
    if (this.closed) throw new RoundtableError('stale-claim', 'Conversation owner is closed');
    if (this.claim.expiresAt <= Date.now())
      this.lose(new RoundtableError('stale-claim', 'Conversation claim expired'));
    this.signal.throwIfAborted();
  }

  private schedule(): void {
    this.clearTimers();
    const remaining = this.claim.expiresAt - Date.now();
    if (remaining <= 0) {
      this.lose(new RoundtableError('stale-claim', 'Conversation claim expired'));
      return;
    }
    this.expiry = setTimeout(
      () => this.lose(new RoundtableError('stale-claim', 'Conversation claim expired')),
      remaining,
    );
    this.heartbeat = setTimeout(
      () => {
        void this.renew().catch(() => {});
      },
      Math.max(1, Math.min(remaining, this.leaseMs / 3)),
    );
  }

  private lose(error: unknown): void {
    this.clearTimers();
    this.abort.abort(error);
  }
  private clearTimers(): void {
    clearTimeout(this.heartbeat);
    clearTimeout(this.expiry);
  }
}
