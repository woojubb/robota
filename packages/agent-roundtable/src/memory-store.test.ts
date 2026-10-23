import { describe, expect, it } from 'vitest';
import { MemoryConversationStore } from './memory-store';
import { runConversationStoreConformance } from './testing';
import type { ConversationStoreConformanceFixture } from './testing';

function memoryFixture(): ConversationStoreConformanceFixture {
  let now = 1_000;
  const store = new MemoryConversationStore({ now: () => now });
  return {
    clients: [store, store],
    leaseMs: 1_000,
    advanceTo: (time) => {
      now = Math.max(now, time);
    },
    cleanup: () => {},
  };
}

describe('MemoryConversationStore public contract', () => {
  it('passes the exported backend conformance run', async () => {
    const cleaned: string[] = [];
    await runConversationStoreConformance((name) => ({
      ...memoryFixture(),
      cleanup: () => {
        cleaned.push(name);
      },
    }));
    expect(cleaned).toEqual([
      'roundtrip',
      'shared-cas',
      'leases',
      'renew-release-race',
      'operation-retries',
      'lost-reply',
      'invalid-inputs',
    ]);
  });
});
