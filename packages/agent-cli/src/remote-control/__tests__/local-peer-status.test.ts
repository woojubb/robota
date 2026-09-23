import { describe, expect, it, vi } from 'vitest';

import { bindLocalPeerStatus } from '../local-peer-status.js';

describe('#2726 — passive session activity observation', () => {
  it('follows actual execution and pending-input state without subscribing to prompts', () => {
    vi.useFakeTimers();
    try {
      const published: Array<string | undefined> = [];
      let state: 'working' | 'needs-input' | 'idle' | undefined;
      const session = {
        getLocalActivityStatus: () => state,
        on: vi.fn(),
        off: vi.fn(),
      };
      const channel = { isActiveForPeerStatus: false, getSession: () => session };
      const stop = bindLocalPeerStatus(
        { publishStatus: (status) => published.push(status) },
        channel,
      );
      state = 'idle';
      vi.advanceTimersByTime(250);
      expect(published.at(-1)).toBeUndefined();
      channel.isActiveForPeerStatus = true;
      vi.advanceTimersByTime(250);
      expect(published.at(-1)).toBe('idle');
      state = 'working';
      vi.advanceTimersByTime(250);
      expect(published.at(-1)).toBe('working');
      state = 'needs-input';
      vi.advanceTimersByTime(250);
      expect(published.at(-1)).toBe('needs-input');
      expect(session.on).not.toHaveBeenCalled();
      channel.isActiveForPeerStatus = false;
      vi.advanceTimersByTime(250);
      expect(published.at(-1)).toBeUndefined();
      stop();
      expect(session.off).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('invalidates a stopped channel even when replacement fails for longer than freshness', () => {
    vi.useFakeTimers();
    try {
      const published: Array<string | undefined> = [];
      const channel = {
        isActiveForPeerStatus: true,
        getSession: () => ({ getLocalActivityStatus: () => 'working' as const }),
      };
      const stop = bindLocalPeerStatus(
        { publishStatus: (status) => published.push(status) },
        channel,
      );
      expect(published.at(-1)).toBe('working');
      channel.isActiveForPeerStatus = false;
      vi.advanceTimersByTime(31_000);
      expect(published.at(-1)).toBeUndefined();
      expect(published.filter((status) => status === 'working')).toHaveLength(1);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
