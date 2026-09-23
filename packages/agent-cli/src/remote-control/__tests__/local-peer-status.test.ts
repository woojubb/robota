import { describe, expect, it, vi } from 'vitest';

import { bindLocalPeerStatus } from '../local-peer-status.js';

describe('#2726 — session activity publication', () => {
  it('keeps a new channel unknown until its session initializes, then announces idle', () => {
    vi.useFakeTimers();
    try {
      const published: Array<string | undefined> = [];
      let initialized = false;
      const session = {
        get isInitialized() {
          return initialized;
        },
        isExecuting: () => false,
        on: () => {},
        off: () => {},
      };
      const stop = bindLocalPeerStatus(
        { publishStatus: (status) => published.push(status) },
        session as never,
      );
      expect(published).toEqual([]);
      initialized = true;
      vi.advanceTimersByTime(1_000);
      expect(published).toEqual(['idle']);
      stop();
      expect(published).toEqual(['idle', undefined]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('publishes fixed states without request content and detaches on switch', () => {
    const published: Array<string | undefined> = [];
    const listeners = new Map<string, Set<(value?: unknown) => void>>();
    let executing = false;
    const session = {
      isExecuting: () => executing,
      on: (event: string, handler: (value?: unknown) => void) => {
        const set = listeners.get(event) ?? new Set();
        set.add(handler);
        listeners.set(event, set);
      },
      off: (event: string, handler: (value?: unknown) => void) =>
        listeners.get(event)?.delete(handler),
    };
    const emit = (event: string, value?: unknown) => {
      for (const handler of listeners.get(event) ?? []) handler(value);
    };
    const stop = bindLocalPeerStatus(
      { publishStatus: (status) => published.push(status) },
      session as never,
    );
    executing = true;
    emit('turn_source', 'human');
    emit('permission_request', { id: 'a', toolArgs: { secret: 'never-publish' } });
    emit('ask_request', { id: 'b', request: { message: 'private' } });
    emit('prompt_resolved', { id: 'a' });
    expect(published.at(-1)).toBe('needs-input');
    emit('prompt_resolved', { id: 'b' });
    expect(published.at(-1)).toBe('working');
    executing = false;
    emit('complete', {});
    expect(published.at(-1)).toBe('idle');
    stop();
    emit('turn_source', 'human');
    expect(published.at(-1)).toBeUndefined();
    expect(JSON.stringify(published)).not.toContain('never-publish');
  });
});
