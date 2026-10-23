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

type ClientFactory = (backend: ConversationStore) => ConversationStore;

async function runWithFault(
  target: ConversationStoreConformanceCase,
  wrap: ClientFactory,
  cleaned: string[],
) {
  await runConversationStoreConformance((name) => {
    let now = 1_000;
    const backend = new MemoryConversationStore({ now: () => now });
    const subject = name === target ? wrap(backend) : new Client(backend);
    return {
      clients: [subject, subject],
      leaseMs: 1_000,
      advanceTo: (time) => {
        now = Math.max(now, time);
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
