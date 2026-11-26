import { describe, expect, it } from 'vitest';
import { createDeltaQueue } from './delta-queue';

describe('createDeltaQueue', () => {
  it('delivers pushed deltas to the sink in order, one at a time', async () => {
    const delivered: string[] = [];
    const active: number[] = [];
    let concurrent = 0;
    const queue = createDeltaQueue(async (text) => {
      concurrent += 1;
      active.push(concurrent);
      await new Promise((resolve) => setTimeout(resolve, 1));
      concurrent -= 1;
      delivered.push(text);
    });
    queue.push('a');
    queue.push('b');
    queue.push('c');
    await queue.flush();
    expect(delivered).toEqual(['a', 'b', 'c']);
    expect(Math.max(...active)).toBe(1);
  });

  it('flush resolves only once every pushed delta has been delivered', async () => {
    const delivered: string[] = [];
    const queue = createDeltaQueue(async (text) => {
      await Promise.resolve();
      delivered.push(text);
    });
    queue.push('x');
    queue.push('y');
    expect(delivered).toEqual([]);
    await queue.flush();
    expect(delivered).toEqual(['x', 'y']);
  });

  it('rethrows the first delivery failure from flush and stops delivering later deltas', async () => {
    const delivered: string[] = [];
    const failure = new Error('sink rejected');
    const queue = createDeltaQueue(async (text) => {
      if (text === 'bad') throw failure;
      delivered.push(text);
    });
    queue.push('good');
    queue.push('bad');
    queue.push('never delivered');
    await expect(queue.flush()).rejects.toBe(failure);
    expect(delivered).toEqual(['good']);
  });

  it('a push after flush observed a failure does not deliver either', async () => {
    const delivered: string[] = [];
    const failure = new Error('sink rejected');
    const queue = createDeltaQueue(async (text) => {
      if (text === 'bad') throw failure;
      delivered.push(text);
    });
    queue.push('bad');
    await expect(queue.flush()).rejects.toBe(failure);
    queue.push('late');
    await expect(queue.flush()).rejects.toBe(failure);
    expect(delivered).toEqual([]);
  });

  it('never leaves a rejected sink call unobserved, even when flush is only awaited well after it failed', async () => {
    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandledRejection);
    const failure = new Error('sink rejected');
    const queue = createDeltaQueue(async (text) => {
      if (text === 'bad') throw failure;
    });
    queue.push('bad');
    // Long enough for Node to flag any promise in the chain that has no handler attached yet —
    // a sink failure can arrive a full macrotask before its caller ever calls flush.
    await new Promise((resolve) => setTimeout(resolve, 20));
    process.off('unhandledRejection', onUnhandledRejection);
    expect(unhandled).toEqual([]);
    await expect(queue.flush()).rejects.toBe(failure);
  });
});
