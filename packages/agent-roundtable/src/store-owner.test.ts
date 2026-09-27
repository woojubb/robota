import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryConversationStore } from './memory-store';
import { StoreOwner } from './store-owner';

afterEach(() => vi.useRealTimers());

describe('conversation store ownership', () => {
  it('serializes parallel member commits against the latest store revision', async () => {
    const store = new MemoryConversationStore();
    await store.create('room', []);
    const owner = await StoreOwner.acquire({ store, conversationId: 'room', leaseMs: 60_000 });
    const add = (value: string) =>
      owner.commit((state) => {
        if (!Array.isArray(state)) throw new Error('expected list');
        return [...state, value];
      });
    await Promise.all([add('first'), add('second')]);
    expect(owner.snapshot()).toMatchObject({ revision: 2, state: ['first', 'second'] });
    await owner.close();
  });

  it('resolves a lost commit reply by operation id without repeating the commit', async () => {
    const store = new MemoryConversationStore();
    await store.create('room', []);
    const commit = store.commit.bind(store);
    const write = vi.spyOn(store, 'commit').mockImplementation(async (change) => {
      await commit(change);
      throw new Error('connection dropped after commit');
    });
    const owner = await StoreOwner.acquire({ store, conversationId: 'room', leaseMs: 60_000 });
    expect(await owner.commit(() => ['answer'])).toMatchObject({ revision: 1, state: ['answer'] });
    expect(write).toHaveBeenCalledOnce();
    expect(owner.signal.aborted).toBe(false);
    await owner.close();
  });

  it('stops admission and queued commits when persistence cannot be confirmed', async () => {
    const store = new MemoryConversationStore();
    await store.create('room', []);
    const write = vi.spyOn(store, 'commit').mockRejectedValue(new Error('storage unavailable'));
    const owner = await StoreOwner.acquire({ store, conversationId: 'room', leaseMs: 60_000 });
    const writes = await Promise.allSettled([owner.commit(() => ['a']), owner.commit(() => ['b'])]);
    expect(writes.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(write).toHaveBeenCalledOnce();
    expect(owner.snapshot().state).toEqual([]);
    expect(owner.signal.aborted).toBe(true);
    await expect(owner.admit()).rejects.toThrow();
    await owner.close();
  });

  it('renews a long-running claim and aborts execution immediately when renewal fails', async () => {
    vi.useFakeTimers();
    const store = new MemoryConversationStore();
    await store.create('room', []);
    const renewal = vi.spyOn(store, 'renew');
    const owner = await StoreOwner.acquire({ store, conversationId: 'room', leaseMs: 90 });
    await vi.advanceTimersByTimeAsync(120);
    expect(renewal.mock.calls.length).toBeGreaterThanOrEqual(3);
    await expect(store.claim('room', 'other', 90)).rejects.toMatchObject({ code: 'busy' });
    renewal.mockRejectedValue(new Error('owner lease lost'));
    await vi.advanceTimersByTimeAsync(30);
    expect(owner.signal.aborted).toBe(true);
    await expect(owner.admit()).rejects.toThrow('owner lease lost');
    await owner.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('expires locally while a renewal request is stuck and never revives that owner', async () => {
    vi.useFakeTimers();
    const store = new MemoryConversationStore();
    await store.create('room', []);
    const owner = await StoreOwner.acquire({ store, conversationId: 'room', leaseMs: 90 });
    let finish!: () => void;
    vi.spyOn(store, 'renew').mockImplementation(
      (claim) =>
        new Promise((resolve) => {
          finish = () => resolve({ ...claim, expiresAt: Date.now() + 90 });
        }),
    );
    await vi.advanceTimersByTimeAsync(91);
    expect(owner.signal.aborted).toBe(true);
    finish();
    await Promise.resolve();
    await expect(owner.admit()).rejects.toMatchObject({ code: 'stale-claim' });
    await owner.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects another scheduler and can transfer ownership after a clean release', async () => {
    const store = new MemoryConversationStore();
    await store.create('room', []);
    const first = await StoreOwner.acquire({ store, conversationId: 'room', leaseMs: 60_000 });
    await expect(
      StoreOwner.acquire({ store, conversationId: 'room', leaseMs: 60_000 }),
    ).rejects.toMatchObject({ code: 'busy' });
    await first.close();
    const second = await StoreOwner.acquire({ store, conversationId: 'room', leaseMs: 60_000 });
    await second.commit(() => ['new owner']);
    await expect(first.commit(() => ['stale'])).rejects.toThrow();
    await second.close();
    expect((await store.load('room'))?.state).toEqual(['new owner']);
  });

  it('releases expired ownership without waiting for an unresponsive renewal reply', async () => {
    vi.useFakeTimers();
    const store = new MemoryConversationStore();
    await store.create('room', []);
    const owner = await StoreOwner.acquire({ store, conversationId: 'room', leaseMs: 90 });
    vi.spyOn(store, 'renew').mockImplementation(() => new Promise(() => {}));
    const admission = owner.admit().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(91);
    const closed = vi.fn();
    void owner.close().then(closed);
    await vi.advanceTimersByTimeAsync(0);
    expect(closed).toHaveBeenCalledOnce();
    expect(await admission).toMatchObject({ code: 'stale-claim' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('closing before lease expiry cancels a queued commit awaiting renewal', async () => {
    const store = new MemoryConversationStore();
    await store.create('room', []);
    const owner = await StoreOwner.acquire({ store, conversationId: 'room', leaseMs: 60_000 });
    let entered!: () => void;
    const renewing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    vi.spyOn(store, 'renew').mockImplementation(() => {
      entered();
      return new Promise(() => {});
    });
    const write = vi.spyOn(store, 'commit');
    const commit = owner.commit(() => ['should not commit']).catch((error: unknown) => error);
    await renewing;
    const closed = vi.fn();
    void owner.close().then(closed);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(closed).toHaveBeenCalledOnce();
    expect(await commit).toMatchObject({ code: 'stale-claim' });
    expect(write).not.toHaveBeenCalled();
  });
});
