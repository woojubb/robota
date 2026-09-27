import { describe, expect, it } from 'vitest';
import { MemoryConversationStore } from './memory-store';

describe('ConversationStore fencing and commits', () => {
  it('allows only one live owner and refuses expired or replaced fences', async () => {
    let now = 100;
    const store = new MemoryConversationStore({ now: () => now });
    await store.create('room', {});
    const first = await store.claim('room', 'first', 10);
    await expect(store.claim('room', 'second', 10)).rejects.toMatchObject({ code: 'busy' });
    now = 110;
    await expect(
      store.commit({ claim: first, expectedRevision: 0, operationId: 'stale', state: {} }),
    ).rejects.toMatchObject({ code: 'stale-claim' });
    const second = await store.claim('room', 'second', 20);
    expect(second.fence).toBeGreaterThan(first.fence);
    await expect(store.release(first)).rejects.toMatchObject({ code: 'stale-claim' });
    await expect(
      store.commit({ claim: first, expectedRevision: 0, operationId: 'old', state: {} }),
    ).rejects.toMatchObject({ code: 'stale-claim' });
    expect(
      (
        await store.commit({
          claim: second,
          expectedRevision: 0,
          operationId: 'new',
          state: { ok: true },
        })
      ).revision,
    ).toBe(1);
  });

  it('returns a committed operation after a lost response and detects changed retry payloads', async () => {
    const store = new MemoryConversationStore();
    await store.create('room', { messages: [] });
    const claim = await store.claim('room', 'owner', 60_000);
    const change = {
      claim,
      expectedRevision: 0,
      operationId: 'publish',
      state: { text: 'hello', cursor: 1 },
    };
    const published = await store.commit(change);
    await store.release(claim);
    expect(await store.commit({ ...change, state: { cursor: 1, text: 'hello' } })).toEqual(
      published,
    );
    expect(await store.lookupOperation('room', 'publish')).toEqual(published);
    await expect(store.commit({ ...change, state: { text: 'different' } })).rejects.toMatchObject({
      code: 'conflict',
    });
  });

  it('commits all fields atomically and prevents callers mutating stored state', async () => {
    const store = new MemoryConversationStore();
    const original = { messages: ['a'], checkpoint: { cursor: 1 } };
    await store.create('room', original);
    original.messages.push('injected');
    const claim = await store.claim('room', 'owner', 60_000);
    const attempts = await Promise.allSettled([
      store.commit({
        claim,
        expectedRevision: 0,
        operationId: 'one',
        state: { messages: ['b'], checkpoint: { cursor: 2 } },
      }),
      store.commit({
        claim,
        expectedRevision: 0,
        operationId: 'two',
        state: { messages: ['c'], checkpoint: { cursor: 3 } },
      }),
    ]);
    expect(attempts.map((a) => a.status)).toEqual(['fulfilled', 'rejected']);
    const loaded = await store.load('room');
    expect(loaded?.state).toEqual({ messages: ['b'], checkpoint: { cursor: 2 } });
    if (loaded) loaded.state = null;
    expect((await store.load('room'))?.state).toEqual({
      messages: ['b'],
      checkpoint: { cursor: 2 },
    });
  });

  it('renews ownership without changing the fence and refuses non-JSON state', async () => {
    let now = 0;
    const store = new MemoryConversationStore({ now: () => now });
    await store.create('room', {});
    const claim = await store.claim('room', 'owner', 10);
    now = 5;
    const renewed = await store.renew(claim, 10);
    expect(renewed.fence).toBe(claim.fence);
    now = 10;
    await expect(store.claim('room', 'other', 10)).rejects.toMatchObject({ code: 'busy' });
    await expect(
      store.commit({ claim: renewed, expectedRevision: 0, operationId: 'nan', state: NaN }),
    ).rejects.toMatchObject({ code: 'invalid-config' });
    expect((await store.load('room'))?.revision).toBe(0);
  });
});
