import { describe, expect, it } from 'vitest';
import { MemoryConversationStore } from '../memory-store';
import type {
  ConversationClaim,
  ConversationCommit,
  ConversationEnvelope,
  ConversationStore,
} from '../store-types';
import type { JsonValue } from '../json-value';
import { runConversationStoreConformance } from './index';
import type { ConversationStoreConformanceCase } from './index';

/** Independent client facade: backend faults affect actual public operations, not suite assertions. */
class Client implements ConversationStore {
  readonly durability = 'memory' as const;
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

class CasBypass extends Client {
  override async commit(change: ConversationCommit) {
    // A backend that checks CAS outside the atomic write loses the original expected revision.
    // Sequentializing this deliberately faulty implementation makes both stale writers win.
    const current = await this.backend.load(change.claim.conversationId);
    if (!current) throw new Error('missing test conversation');
    try {
      return await this.backend.commit({ ...change, expectedRevision: current.revision });
    } catch {
      const latest = await this.backend.load(change.claim.conversationId);
      if (!latest) throw new Error('missing test conversation');
      return this.backend.commit({ ...change, expectedRevision: latest.revision });
    }
  }
}

class FenceBypass extends Client {
  private latest = new Map<string, ConversationClaim>();
  override async claim(id: string, owner: string, lease: number) {
    const claim = await super.claim(id, owner, lease);
    this.latest.set(id, claim);
    return claim;
  }
  override commit(change: ConversationCommit) {
    return super.commit({
      ...change,
      claim: this.latest.get(change.claim.conversationId) ?? change.claim,
    });
  }
}

class LeaseRevival extends Client {
  override async renew(claim: ConversationClaim, lease: number) {
    try {
      return await super.renew(claim, lease);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'stale-claim')) throw error;
      const replacement = await super.claim(claim.conversationId, claim.ownerId, lease);
      // Incorrectly reports renewal of the retired fence after acquiring a different one.
      return { ...claim, expiresAt: replacement.expiresAt };
    }
  }
}

class RetryAsNewWrite extends Client {
  private sequence = 0;
  override async commit(change: ConversationCommit) {
    const current = await this.load(change.claim.conversationId);
    if (!current) throw new Error('missing test conversation');
    return super.commit({
      ...change,
      expectedRevision: current.revision,
      operationId: `${change.operationId}/${++this.sequence}`,
    });
  }
  // Preserve ordinary receipt lookup; retry alone is faulty.
  override async lookupOperation(id: string, operation: string) {
    for (let n = this.sequence; n > 0; n--) {
      const found = await super.lookupOperation(id, `${operation}/${n}`);
      if (found) return found;
    }
    return undefined;
  }
}

class ReceiptLoss extends Client {
  override async lookupOperation(): Promise<ConversationEnvelope | undefined> {
    return undefined;
  }
}

interface TestClock {
  now: number;
}

class ExpiredWrite extends Client {
  constructor(
    backend: ConversationStore,
    private readonly clock: TestClock,
  ) {
    super(backend);
  }
  override async commit(change: ConversationCommit) {
    const saved = this.clock.now;
    if (saved >= change.claim.expiresAt) this.clock.now = change.claim.expiresAt - 1;
    try {
      return await super.commit(change);
    } finally {
      this.clock.now = saved;
    }
  }
}

function shallow(envelope: ConversationEnvelope): ConversationEnvelope {
  const state = envelope.state;
  return {
    ...envelope,
    state: Array.isArray(state)
      ? [...state]
      : state !== null && typeof state === 'object'
        ? { ...state }
        : state,
  };
}

class ShallowOutput extends Client {
  private views = new Map<string, ConversationEnvelope>();
  private receipts = new Map<string, ConversationEnvelope>();
  override async create(id: string, state: JsonValue) {
    const envelope = await super.create(id, state);
    this.views.set(id, envelope);
    return shallow(envelope);
  }
  override async load(id: string) {
    const envelope = this.views.get(id);
    return envelope && shallow(envelope);
  }
  override async commit(change: ConversationCommit) {
    const envelope = await super.commit(change);
    const key = JSON.stringify([change.claim.conversationId, change.operationId]);
    let receipt = this.receipts.get(key);
    if (!receipt) {
      receipt = envelope;
      this.views.set(envelope.conversationId, envelope);
      this.receipts.set(key, envelope);
    }
    return shallow(receipt);
  }
  override async lookupOperation(id: string, operation: string) {
    const envelope = this.receipts.get(JSON.stringify([id, operation]));
    return envelope && shallow(envelope);
  }
}

class JsonCoercion extends Client {
  private coerce(state: JsonValue): JsonValue {
    try {
      return state !== null && typeof state === 'object'
        ? JSON.parse(JSON.stringify(state))
        : state;
    } catch {
      return state;
    } // Preserve the independently covered cyclic-input rejection.
  }
  override create(id: string, state: JsonValue) {
    return super.create(id, this.coerce(state));
  }
  override commit(change: ConversationCommit) {
    return super.commit({ ...change, state: this.coerce(change.state) });
  }
}

type ClientFactory = (backend: ConversationStore, clock: TestClock) => ConversationStore;

async function runWithFault(
  target: ConversationStoreConformanceCase,
  wrap: ClientFactory,
  cleaned: string[],
) {
  await runConversationStoreConformance((name) => {
    const clock = { now: 1_000 };
    const backend = new MemoryConversationStore({ now: () => clock.now });
    const subject = name === target ? wrap(backend, clock) : new Client(backend);
    return {
      clients: [subject, subject],
      leaseMs: 1_000,
      advanceTo: (time) => {
        clock.now = Math.max(clock.now, time);
      },
      cleanup: () => {
        cleaned.push(name);
      },
    };
  });
}

describe('ConversationStore conformance fault sensitivity', () => {
  it.each([
    ['shared-cas', (backend) => new CasBypass(backend)],
    ['leases', (backend) => new FenceBypass(backend)],
    ['leases', (backend) => new LeaseRevival(backend)],
    ['operation-retries', (backend) => new RetryAsNewWrite(backend)],
    ['lost-reply', (backend) => new ReceiptLoss(backend)],
    ['leases', (backend, clock) => new ExpiredWrite(backend, clock)],
    ['roundtrip', (backend) => new ShallowOutput(backend)],
    ['invalid-inputs', (backend) => new JsonCoercion(backend)],
  ] satisfies [ConversationStoreConformanceCase, ClientFactory][])(
    'rejects a faulty backend in %s and cleans its fixture',
    async (name, wrap) => {
      const cleaned: string[] = [];
      await expect(runWithFault(name, wrap, cleaned)).rejects.toThrow(`conformance [${name}]`);
      expect(cleaned.at(-1)).toBe(name);
    },
  );

  it('accepts two distinct clients sharing one backend and never skips a scenario', async () => {
    const names: string[] = [];
    await runConversationStoreConformance((name) => {
      names.push(name);
      let now = 1_000;
      const backend = new MemoryConversationStore({ now: () => now });
      return {
        clients: [new Client(backend), new Client(backend)],
        leaseMs: 1_000,
        advanceTo: (time) => {
          now = Math.max(now, time);
        },
        cleanup: () => {},
      };
    });
    expect(names).toHaveLength(7);
  });

  it('cleans an invalid fixture before failing without continuing', async () => {
    let cleaned = 0;
    let created = 0;
    await expect(
      runConversationStoreConformance(() => {
        created++;
        const store = new MemoryConversationStore();
        return {
          clients: [store, store],
          leaseMs: 0,
          advanceTo: () => {},
          cleanup: () => {
            cleaned++;
          },
        };
      }),
    ).rejects.toThrow('fixture leaseMs');
    expect(cleaned).toBe(1);
    expect(created).toBe(1);
  });
});
