/**
 * TC-14: reconnect uses bounded exponential backoff, the observable state moves
 * pending → failed → manual-retry, the retry bound is reached rather than looping, and every timer
 * is deterministic with no foreground polling (MCP-003).
 */
import { describe, expect, it } from 'vitest';

import { FakeSupervisorClock, fixtureTimeouts } from './supervisor-test-helpers.js';
import { MCPConnectionSupervisor } from '../supervisor/connection.js';

// `startupMs` also goes through the injected clock (it races `openSession` under a deterministic
// timer too), so `scheduledDelaysMs` interleaves startup-timeout entries with backoff-retry entries.
// A sentinel far outside any backoff delay used below keeps the two trivially separable.
const STARTUP_SENTINEL_MS = 999_999;
const timeoutsWithSentinelStartup = fixtureTimeouts({ startupMs: STARTUP_SENTINEL_MS });

function backoffDelaysOf(clock: FakeSupervisorClock): number[] {
  return clock.scheduledDelaysMs.filter((ms) => ms !== STARTUP_SENTINEL_MS);
}

describe('MCPConnectionSupervisor — reconnect backoff (TC-14)', () => {
  it('backs off exponentially, capped, up to maxAttempts, then requires a manual retry', async () => {
    const clock = new FakeSupervisorClock();
    let openCount = 0;
    const supervisor = new MCPConnectionSupervisor({
      serverId: 'server-1',
      openSession: async () => {
        openCount += 1;
        throw Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
      },
      timeouts: timeoutsWithSentinelStartup,
      backoff: { initialMs: 100, factor: 2, maxAttempts: 3, maxMs: 10_000 },
      clock,
    });

    // Attempt 1 fails transient -> pending, one retry timer armed for 100ms.
    await expect(supervisor.ensureConnected()).rejects.toThrow();
    expect(openCount).toBe(1);
    expect(supervisor.getState()).toMatchObject({
      kind: 'failed',
      classification: 'transient',
      attempt: 1,
      retry: 'pending',
    });
    expect(clock.pendingCount).toBe(1);
    expect(backoffDelaysOf(clock)).toEqual([100]);

    // The armed timer fires attempt 2 on its own — no foreground polling, no external await needed
    // beyond advancing the fake clock.
    await clock.advance(100);
    expect(openCount).toBe(2);
    expect(supervisor.getState()).toMatchObject({
      kind: 'failed',
      classification: 'transient',
      attempt: 2,
      retry: 'pending',
    });
    expect(clock.pendingCount).toBe(1);
    expect(backoffDelaysOf(clock)).toEqual([100, 200]);

    // Attempt 3 hits the bound (maxAttempts=3): manual-retry, no further timer.
    await clock.advance(200);
    expect(openCount).toBe(3);
    expect(supervisor.getState()).toMatchObject({
      kind: 'failed',
      classification: 'transient',
      attempt: 3,
      retry: 'manual-retry',
    });
    expect(clock.pendingCount).toBe(0);
    expect(backoffDelaysOf(clock)).toEqual([100, 200]);

    // Time passing further does not resurrect a fourth attempt: the bound is reached, not looped.
    await clock.advance(10_000);
    expect(openCount).toBe(3);
  });

  it('caps the delay at maxMs rather than growing forever', async () => {
    const clock = new FakeSupervisorClock();
    const supervisor = new MCPConnectionSupervisor({
      serverId: 'server-1',
      openSession: async () => {
        throw Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
      },
      timeouts: timeoutsWithSentinelStartup,
      backoff: { initialMs: 1_000, factor: 10, maxAttempts: 3, maxMs: 2_000 },
      clock,
    });

    await expect(supervisor.ensureConnected()).rejects.toThrow();
    expect(backoffDelaysOf(clock)).toEqual([1_000]);

    await clock.advance(1_000);
    // Uncapped this would be 10_000; the policy caps it at maxMs=2_000.
    expect(backoffDelaysOf(clock)).toEqual([1_000, 2_000]);
  });

  it('lets retry() start a fresh attempt cycle after manual-retry', async () => {
    const clock = new FakeSupervisorClock();
    let shouldFail = true;
    const supervisor = new MCPConnectionSupervisor({
      serverId: 'server-1',
      openSession: async () => {
        if (shouldFail) {
          throw Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
        }
        throw new Error('unused');
      },
      timeouts: fixtureTimeouts(),
      backoff: { initialMs: 100, factor: 2, maxAttempts: 1, maxMs: 10_000 },
      clock,
    });

    await expect(supervisor.ensureConnected()).rejects.toThrow();
    expect(supervisor.getState()).toMatchObject({ retry: 'manual-retry', attempt: 1 });

    // ensureConnected() must NOT auto-open from manual-retry.
    await expect(supervisor.ensureConnected()).rejects.toThrow();
    expect(supervisor.getState()).toMatchObject({ attempt: 1 });

    // retry() is the explicit operator action, and starts attempt counting over at 1.
    shouldFail = true;
    await expect(supervisor.retry()).rejects.toThrow();
    expect(supervisor.getState()).toMatchObject({ retry: 'manual-retry', attempt: 1 });
  });
});
