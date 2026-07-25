import { SimpleCache } from './cache';

// HARNESS-025: TTL expiry is driven by the fake clock, never by a real wall-clock sleep.
// `SimpleCache` compares `Date.now()` against the entry timestamp, and Jest's modern fake timers
// mock `Date` alongside the timer queue — so advancing the fake clock is what makes an entry
// expire. A real `setTimeout` sleep made these two cases both slow and load-dependent (a stalled
// CI box could overshoot, and a coarse clock could undershoot, the 50ms TTL).
beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('SimpleCache', () => {
  it('stores and retrieves values within TTL', () => {
    const cache = new SimpleCache<string>();
    cache.set('key1', 'value1', 1000); // 1 second TTL
    expect(cache.get('key1')).toBe('value1');
  });

  it('returns null for missing keys', () => {
    const cache = new SimpleCache<string>();
    expect(cache.get('nonexistent')).toBeNull();
  });

  it('expires values after TTL', () => {
    const cache = new SimpleCache<string>();
    cache.set('key1', 'value1', 50); // 50ms TTL

    // Still inside the TTL window: the entry must survive.
    jest.advanceTimersByTime(49);
    expect(cache.get('key1')).toBe('value1');

    // Past the TTL window: the entry must be gone.
    jest.advanceTimersByTime(2);
    expect(cache.get('key1')).toBeNull();
  });

  it('supports cache invalidation', () => {
    const cache = new SimpleCache<string>();
    cache.set('key1', 'value1', 1000);
    cache.delete('key1');
    expect(cache.get('key1')).toBeNull();
  });

  it('reports correct size', () => {
    const cache = new SimpleCache<string>();
    expect(cache.size()).toBe(0);
    cache.set('a', 'alpha', 1000);
    cache.set('b', 'beta', 1000);
    expect(cache.size()).toBe(2);
  });

  it('clears all entries', () => {
    const cache = new SimpleCache<string>();
    cache.set('a', 'alpha', 1000);
    cache.set('b', 'beta', 1000);
    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.get('a')).toBeNull();
  });

  it('getOrSet returns cached value on second call', async () => {
    const cache = new SimpleCache<string>();
    let callCount = 0;
    const factory = async () => {
      callCount++;
      return 'computed';
    };
    const first = await cache.getOrSet('k', factory, 1000);
    const second = await cache.getOrSet('k', factory, 1000);
    expect(first).toBe('computed');
    expect(second).toBe('computed');
    expect(callCount).toBe(1); // factory called only once
  });

  it('cleans up expired entries', () => {
    const cache = new SimpleCache<string>();
    cache.set('short', 'v', 50); // expires quickly
    cache.set('long', 'v2', 60000); // stays valid

    // Before the short TTL elapses, cleanup() must evict nothing.
    jest.advanceTimersByTime(49);
    cache.cleanup();
    expect(cache.size()).toBe(2);

    // Once the short TTL has elapsed, cleanup() drops only the expired entry.
    jest.advanceTimersByTime(2);
    cache.cleanup();
    expect(cache.size()).toBe(1);
    expect(cache.get('long')).toBe('v2');
  });
});
