import { afterEach, describe, expect, it, vi } from 'vitest';

import { TuiPermissionQueue, TuiUserActionQueue } from '../tui-interaction-queues.js';

import type { IActionRequest } from '@robota-sdk/agent-core';

const FIRST: IActionRequest = {
  id: 'first',
  title: 'First?',
  options: [{ value: 'yes', label: 'Yes' }],
  maxSelect: 1,
};
const SECOND: IActionRequest = {
  id: 'second',
  title: 'Second?',
  options: [{ value: 'no', label: 'No' }],
  maxSelect: 1,
};

afterEach(() => vi.useRealTimers());

describe('TuiUserActionQueue', () => {
  it('resolves FIFO and promotes the next action', async () => {
    const queue = new TuiUserActionQueue(vi.fn());
    const first = queue.enqueue(FIRST, 'prompt-1');
    const second = queue.enqueue(SECOND, 'prompt-2');

    expect(queue.current).toBe(FIRST);
    queue.resolveCurrent({ type: 'answer', values: ['yes'] });
    expect(await first).toEqual({ type: 'answer', values: ['yes'] });
    expect(queue.current).toBe(SECOND);
    queue.resolveCurrent({ type: 'cancelled' });
    expect(await second).toEqual({ type: 'cancelled' });
    expect(queue.current).toBeNull();
  });

  it('cancels every active and queued action during a drain', async () => {
    const queue = new TuiUserActionQueue(vi.fn());
    const first = queue.enqueue(FIRST);
    const second = queue.enqueue(SECOND);
    queue.cancelAll();
    await expect(first).resolves.toEqual({ type: 'cancelled' });
    await expect(second).resolves.toEqual({ type: 'cancelled' });
    expect(queue.current).toBeNull();
  });
});

describe('TuiPermissionQueue', () => {
  it('resolves FIFO and promotes the next permission on the scheduled turn', async () => {
    vi.useFakeTimers();
    const queue = new TuiPermissionQueue(vi.fn());
    const first = queue.enqueue('Read', { path: 'a' }, 'permission-1');
    const second = queue.enqueue('Write', { path: 'b' }, 'permission-2');

    expect(queue.current?.toolName).toBe('Read');
    queue.current?.resolve(true);
    await expect(first).resolves.toBe(true);
    await vi.runAllTimersAsync();
    expect(queue.current?.toolName).toBe('Write');
    queue.current?.resolve('allow-session');
    await expect(second).resolves.toBe('allow-session');
  });

  it('denies every active and queued permission during a drain', async () => {
    const queue = new TuiPermissionQueue(vi.fn());
    const first = queue.enqueue('Read', { path: 'a' });
    const second = queue.enqueue('Write', { path: 'b' });
    queue.cancelAll();
    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(false);
    expect(queue.current).toBeNull();
  });

  it('preserves the active permission when a queued request is dismissed', async () => {
    const queue = new TuiPermissionQueue(vi.fn());
    const first = queue.enqueue('Read', { path: 'a' }, 'permission-1');
    const second = queue.enqueue('Write', { path: 'b' }, 'permission-2');
    const active = queue.current;

    expect(queue.dismissById('permission-2')).toBe(true);
    expect(queue.current).toBe(active);
    await expect(second).resolves.toBe(false);

    active?.resolve(true);
    await expect(first).resolves.toBe(true);
  });
});
