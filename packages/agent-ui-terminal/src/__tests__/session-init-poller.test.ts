import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSessionInitPoller } from '../flows/session-init-poller.js';

describe('createSessionInitPoller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('TC-04: calls onReady and stops once the check succeeds', () => {
    const onReady = vi.fn();
    const onFailure = vi.fn();
    let ready = false;
    const poller = createSessionInitPoller({
      check: () => {
        if (!ready) throw new Error('InteractiveSession not initialized. Call submit().');
      },
      intervalMs: 200,
      timeoutMs: 15000,
      onReady,
      onFailure,
    });
    poller.start();
    vi.advanceTimersByTime(600);
    expect(onReady).not.toHaveBeenCalled();
    ready = true;
    vi.advanceTimersByTime(200);
    expect(onReady).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2000);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('TC-04: benign not-initialized errors poll until timeout, then fail with timeout kind', () => {
    const onReady = vi.fn();
    const onFailure = vi.fn();
    const poller = createSessionInitPoller({
      check: () => {
        throw new Error('InteractiveSession not initialized. Call submit().');
      },
      intervalMs: 200,
      timeoutMs: 1000,
      onReady,
      onFailure,
    });
    poller.start();
    vi.advanceTimersByTime(900);
    expect(onFailure).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure.mock.calls[0]?.[0]).toMatchObject({ kind: 'timeout' });
    expect(onReady).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it('TC-04: a real error fails immediately with the error attached', () => {
    const onFailure = vi.fn();
    const poller = createSessionInitPoller({
      check: () => {
        throw new Error('ENOENT: session store unreadable');
      },
      intervalMs: 200,
      timeoutMs: 15000,
      onReady: vi.fn(),
      onFailure,
    });
    poller.start();
    vi.advanceTimersByTime(200);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure.mock.calls[0]?.[0]).toMatchObject({ kind: 'error' });
    expect(String((onFailure.mock.calls[0]?.[0] as { error: Error }).error.message)).toContain(
      'ENOENT',
    );
    vi.advanceTimersByTime(2000);
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it('stop() cancels polling without callbacks', () => {
    const onReady = vi.fn();
    const onFailure = vi.fn();
    const poller = createSessionInitPoller({
      check: () => {
        throw new Error('InteractiveSession not initialized.');
      },
      intervalMs: 200,
      timeoutMs: 1000,
      onReady,
      onFailure,
    });
    poller.start();
    vi.advanceTimersByTime(400);
    poller.stop();
    vi.advanceTimersByTime(5000);
    expect(onReady).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
  });
});
