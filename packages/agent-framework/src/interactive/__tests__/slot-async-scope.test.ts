import { describe, expect, it } from 'vitest';

import { createSlotScope } from '../slot-async-scope.js';

/** A promise the test settles by hand, so overlapping runs can be ordered exactly. */
function gate<T = void>(): {
  promise: Promise<T>;
  open: (value: T) => void;
  fail: (error: Error) => void;
} {
  let open!: (value: T) => void;
  let fail!: (error: Error) => void;
  const promise = new Promise<T>((resolve, reject) => {
    open = resolve;
    fail = reject;
  });
  return { promise, open, fail };
}

describe('createSlotScope', () => {
  it('has no value outside a run and the run’s value inside it', () => {
    const scope = createSlotScope<string>();
    expect(scope.getStore()).toBeUndefined();
    const result = scope.run('inside', () => {
      expect(scope.getStore()).toBe('inside');
      return 42;
    });
    expect(result).toBe(42);
    expect(scope.getStore()).toBeUndefined();
  });

  it('keeps the value across awaits and releases it when the run settles', async () => {
    const scope = createSlotScope<string>();
    const done = gate();
    const running = scope.run('held', async () => {
      await done.promise;
      return scope.getStore();
    });
    expect(scope.getStore()).toBe('held');
    done.open();
    expect(await running).toBe('held');
    expect(scope.getStore()).toBeUndefined();
  });

  it('gives a nested run its own value and restores the outer one when it ends', () => {
    const scope = createSlotScope<string>();
    scope.run('outer', () => {
      scope.run('inner', () => expect(scope.getStore()).toBe('inner'));
      expect(scope.getStore()).toBe('outer');
    });
  });

  it('releases the value when the run throws or rejects, and passes the failure on', async () => {
    const scope = createSlotScope<string>();
    expect(() =>
      scope.run('thrown', () => {
        throw new Error('sync failure');
      }),
    ).toThrow('sync failure');
    expect(scope.getStore()).toBeUndefined();

    const failing = gate();
    const running = scope.run('rejected', async () => failing.promise);
    expect(scope.getStore()).toBe('rejected');
    failing.fail(new Error('async failure'));
    await expect(running).rejects.toThrow('async failure');
    expect(scope.getStore()).toBeUndefined();
  });

  it('removes only its own value when overlapping runs settle in either order', async () => {
    const scope = createSlotScope<string>();
    const first = gate();
    const second = gate();
    const a = scope.run('a', () => first.promise);
    const b = scope.run('b', () => second.promise);
    // The last to start is the one a read sees: a slot cannot tell the two chains apart.
    expect(scope.getStore()).toBe('b');
    first.open();
    await a;
    expect(scope.getStore()).toBe('b');
    second.open();
    await b;
    expect(scope.getStore()).toBeUndefined();
  });
});
