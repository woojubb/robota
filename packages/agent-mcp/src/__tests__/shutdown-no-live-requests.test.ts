/**
 * TC-17: after cancellation and after session shutdown the transport's own close is asserted called
 * and no reconnect timer remains armed under the fake clock. Deliberately NOT measured via
 * `getActiveResourcesInfo` — the fake clock's own pending-timer count is the instrument.
 */
import { describe, expect, it } from 'vitest';

import {
  FakeMcpSession,
  FakeSupervisorClock,
  fixtureIdentity,
  fixtureTimeouts,
} from './supervisor-test-helpers.js';
import { MCPConnectionSupervisor, MCPSupervisorError } from '../supervisor/connection.js';

describe('MCPConnectionSupervisor — shutdown leaves no live request (TC-17)', () => {
  it('closes the live session and clears the idle timer, leaving zero pending timers', async () => {
    const clock = new FakeSupervisorClock();
    const identity = fixtureIdentity();
    const session = new FakeMcpSession({ identity });
    const supervisor = new MCPConnectionSupervisor({
      serverId: identity.serverId,
      openSession: async () => session,
      timeouts: fixtureTimeouts(),
      clock,
    });

    await supervisor.ensureConnected();
    expect(clock.pendingCount).toBe(1); // the idle timer, armed while connected

    await supervisor.shutdown();

    expect(session.closeCalls).toBe(1);
    expect(clock.pendingCount).toBe(0);
    expect(supervisor.getState()).toEqual({ kind: 'closed' });
  });

  it('is idempotent — a second shutdown() does not close the session again', async () => {
    const identity = fixtureIdentity();
    const session = new FakeMcpSession({ identity });
    const supervisor = new MCPConnectionSupervisor({
      serverId: identity.serverId,
      openSession: async () => session,
      timeouts: fixtureTimeouts(),
    });

    await supervisor.ensureConnected();
    await supervisor.shutdown();
    await supervisor.shutdown();

    expect(session.closeCalls).toBe(1);
  });

  it('cancels an in-flight open attempt and leaves no timer armed', async () => {
    const clock = new FakeSupervisorClock();
    let capturedSignal: AbortSignal | undefined;
    const supervisor = new MCPConnectionSupervisor({
      serverId: 'server-1',
      openSession: (signal) => {
        capturedSignal = signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted by caller')));
        });
      },
      timeouts: fixtureTimeouts(),
      clock,
    });

    const pending = supervisor.ensureConnected().catch((error: unknown) => error);
    expect(supervisor.getState().kind).toBe('connecting');

    await supervisor.shutdown();

    expect(capturedSignal?.aborted).toBe(true);
    expect(supervisor.getState()).toEqual({ kind: 'closed' });
    expect(clock.pendingCount).toBe(0);

    const result = await pending;
    expect(result).toBeInstanceOf(Error);
  });

  it('clears an armed backoff retry timer on shutdown', async () => {
    const clock = new FakeSupervisorClock();
    const supervisor = new MCPConnectionSupervisor({
      serverId: 'server-1',
      openSession: async () => {
        throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });
      },
      timeouts: fixtureTimeouts(),
      clock,
    });

    await expect(supervisor.ensureConnected()).rejects.toThrow();
    expect(clock.pendingCount).toBe(1); // the backoff retry timer

    await supervisor.shutdown();

    expect(clock.pendingCount).toBe(0);
    expect(supervisor.getState()).toEqual({ kind: 'closed' });
  });

  it('closes a session that finishes opening after shutdown(), never announcing it as connected', async () => {
    const clock = new FakeSupervisorClock();
    const identity = fixtureIdentity();
    const session = new FakeMcpSession({ identity });

    let resolveOpen: (session: FakeMcpSession) => void = () => {
      throw new Error('resolveOpen called before assignment');
    };
    const opened = new Promise<FakeMcpSession>((resolve) => {
      resolveOpen = resolve;
    });

    const supervisor = new MCPConnectionSupervisor({
      serverId: identity.serverId,
      openSession: () => opened,
      timeouts: fixtureTimeouts(),
      clock,
    });

    const pending = supervisor.ensureConnected();
    expect(supervisor.getState().kind).toBe('connecting');

    await supervisor.shutdown();
    expect(supervisor.getState()).toEqual({ kind: 'closed' });

    resolveOpen(session);

    await expect(pending).rejects.toBeInstanceOf(MCPSupervisorError);
    expect(supervisor.getState()).toEqual({ kind: 'closed' });
    expect(session.closeCalls).toBe(1);
    expect(clock.pendingCount).toBe(0);
  });
});
