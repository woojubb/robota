import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { bindLocalPeerStatus } from '../local-peer-status.js';
import { announceLocalPeerPresence } from '../local-peer-presence.js';

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

  it('corrects a failed publication when the observation returns to the last successful state', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'peer-status-')));
    try {
      let fail = false;
      const presence = announceLocalPeerPresence({
        sessionId: 'self',
        guardedDirectory: dir,
        registry: {
          readStartTime: () => {
            if (fail) throw new Error('inspection failed');
            return 'T1';
          },
          now: Date.now,
        },
        on: () => {},
        off: () => {},
      });
      const session = {
        status: 'idle' as 'idle' | 'working',
        getLocalActivityStatus() {
          return this.status;
        },
      };
      const channel = { isActiveForPeerStatus: true, getSession: () => session };
      const stop = bindLocalPeerStatus(presence, channel, () => {});
      expect(presence.list()[0]?.status).toBe('idle');
      session.status = 'working';
      fail = true;
      vi.advanceTimersByTime(250);
      fail = false;
      session.status = 'idle';
      vi.advanceTimersByTime(31_000);
      expect(presence.list()[0]?.status).toBe('idle');
      stop();
      presence.withdraw();
    } finally {
      rmSync(dir, { recursive: true, force: true });
      vi.useRealTimers();
    }
  });

  it('clears a failed first publication after the channel stops', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'peer-status-')));
    try {
      let fail = false;
      const presence = announceLocalPeerPresence({
        sessionId: 'self',
        guardedDirectory: dir,
        registry: {
          readStartTime: () => {
            if (fail) throw new Error('inspection failed');
            return 'T1';
          },
          now: Date.now,
        },
        on: () => {},
        off: () => {},
      });
      const channel = {
        isActiveForPeerStatus: true,
        getSession: () => ({ getLocalActivityStatus: () => 'working' as const }),
      };
      fail = true;
      const stop = bindLocalPeerStatus(presence, channel, () => {});
      fail = false;
      channel.isActiveForPeerStatus = false;
      vi.advanceTimersByTime(31_000);
      expect(presence.list()[0]?.status).toBe('unknown');
      stop();
      presence.withdraw();
    } finally {
      rmSync(dir, { recursive: true, force: true });
      vi.useRealTimers();
    }
  });
});
