import { describe, expect, it } from 'vitest';
import { MemoryConversationStore } from '../memory-store';
import type { JsonValue } from '../json-value';
import type {
  ConversationClaim,
  ConversationCommit,
  ConversationEnvelope,
  ConversationStore,
} from '../store-types';
import { runDurableConversationStoreConformance } from './index';
import type { DurableConversationStoreConformanceCase } from './index';

/** A client over one shared backing store; a restart is a new client over the same backing. */
class DurableClient implements ConversationStore {
  readonly durability: 'memory' | 'durable' = 'durable';
  constructor(protected readonly backend: ConversationStore) {}
  create(id: string, state: JsonValue) {
    return this.backend.create(id, state);
  }
  load(id: string) {
    return this.backend.load(id);
  }
  claim(id: string, owner: string, lease: number) {
    return this.backend.claim(id, owner, lease);
  }
  renew(claim: ConversationClaim, lease: number) {
    return this.backend.renew(claim, lease);
  }
  release(claim: ConversationClaim) {
    return this.backend.release(claim);
  }
  commit(change: ConversationCommit) {
    return this.backend.commit(change);
  }
  lookupOperation(id: string, operation: string) {
    return this.backend.lookupOperation(id, operation);
  }
}

class DeclaresMemory extends DurableClient {
  override readonly durability = 'memory' as const;
}

/** State the writing process held but never reached storage. */
interface Unflushed {
  previous: Map<string, ConversationEnvelope>;
  rejected: Map<string, ConversationEnvelope>;
}

class LosesLastCommit extends DurableClient {
  constructor(
    backend: ConversationStore,
    private readonly unflushed: Unflushed,
    private readonly restarted: boolean,
  ) {
    super(backend);
  }
  override async load(id: string) {
    const current = await super.load(id);
    return (this.restarted ? this.unflushed.previous.get(id) : undefined) ?? current;
  }
  override async commit(change: ConversationCommit) {
    const id = change.claim.conversationId;
    const before = await this.backend.load(id);
    const committed = await super.commit(change);
    if (before) this.unflushed.previous.set(id, before);
    return committed;
  }
}

class ClientMemoryReceipts extends DurableClient {
  private readonly receipts = new Map<string, ConversationEnvelope>();
  private sequence = 0;
  override async commit(change: ConversationCommit) {
    const key = JSON.stringify([change.claim.conversationId, change.operationId]);
    const known = this.receipts.get(key);
    if (known) return known;
    const current = await this.backend.load(change.claim.conversationId);
    const envelope = await super.commit({
      ...change,
      expectedRevision: current?.revision ?? change.expectedRevision,
      operationId: `${change.operationId}/${++this.sequence}`,
    });
    this.receipts.set(key, envelope);
    return envelope;
  }
  override async lookupOperation(id: string, operation: string) {
    return this.receipts.get(JSON.stringify([id, operation]));
  }
}

class ResetsFences extends DurableClient {
  override async claim(id: string, owner: string, lease: number) {
    return { ...(await super.claim(id, owner, lease)), fence: 1 };
  }
}

class ShowsRejectedWrite extends DurableClient {
  constructor(
    backend: ConversationStore,
    private readonly unflushed: Unflushed,
    private readonly restarted: boolean,
  ) {
    super(backend);
  }
  override async commit(change: ConversationCommit) {
    try {
      return await super.commit(change);
    } catch (error) {
      const id = change.claim.conversationId;
      this.unflushed.rejected.set(JSON.stringify([id, change.operationId]), {
        schemaVersion: 1,
        conversationId: id,
        revision: change.expectedRevision + 1,
        state: change.state,
      });
      throw error;
    }
  }
  override async lookupOperation(id: string, operation: string) {
    const rejected = this.restarted
      ? this.unflushed.rejected.get(JSON.stringify([id, operation]))
      : undefined;
    return rejected ?? super.lookupOperation(id, operation);
  }
}

type Fault = (
  backend: ConversationStore,
  unflushed: Unflushed,
  restarted: boolean,
) => ConversationStore;

async function run(target: DurableConversationStoreConformanceCase | undefined, fault?: Fault) {
  const names: string[] = [];
  await runDurableConversationStoreConformance((name) => {
    names.push(name);
    let now = 1_000;
    const backend = new MemoryConversationStore({ now: () => now });
    const unflushed: Unflushed = { previous: new Map(), rejected: new Map() };
    const make = (restarted: boolean): ConversationStore =>
      fault && name === target ? fault(backend, unflushed, restarted) : new DurableClient(backend);
    const first = make(false);
    return {
      clients: [first, first],
      restart: () => make(true),
      leaseMs: 1_000,
      advanceTo: (time) => {
        now = Math.max(now, time);
      },
      cleanup: () => {},
    };
  });
  return names;
}

describe('durable ConversationStore conformance', () => {
  it('accepts a durable facade whose restarted clients share the backing storage', async () => {
    expect(await run(undefined)).toEqual([
      'roundtrip',
      'shared-cas',
      'leases',
      'renew-release-race',
      'operation-retries',
      'lost-reply',
      'invalid-inputs',
      'durable-declaration',
      'restart-commits',
      'restart-receipts',
      'restart-fencing',
      'restart-rejected-writes',
    ]);
  });

  it.each([
    ['durable-declaration', (backend) => new DeclaresMemory(backend)],
    [
      'restart-commits',
      (backend, unflushed, restarted) => new LosesLastCommit(backend, unflushed, restarted),
    ],
    ['restart-receipts', (backend) => new ClientMemoryReceipts(backend)],
    ['restart-fencing', (backend) => new ResetsFences(backend)],
    [
      'restart-rejected-writes',
      (backend, unflushed, restarted) => new ShowsRejectedWrite(backend, unflushed, restarted),
    ],
  ] satisfies [DurableConversationStoreConformanceCase, Fault][])(
    'fails exactly %s for its faulty store',
    async (name, fault) => {
      await expect(run(name, fault)).rejects.toThrow(`conformance [${name}]`);
    },
  );
});
