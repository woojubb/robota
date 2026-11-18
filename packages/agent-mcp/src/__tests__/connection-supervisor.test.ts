/**
 * The supervisor opens, reuses and closes a connection, and a `listChanged` notification marks
 * the affected catalog domain stale.
 */
import { describe, expect, it } from 'vitest';

import {
  FakeMcpSession,
  fixtureDiscovery,
  fixtureIdentity,
  fixtureTimeouts,
  flushMicrotasks,
} from './supervisor-test-helpers.js';
import { MCPConnectionSupervisor, type TMCPConnectionState } from '../supervisor/connection.js';

describe('MCPConnectionSupervisor — open / reuse / close / listChanged', () => {
  it('opens a session on first ensureConnected() and reports connected with the session identity', async () => {
    const identity = fixtureIdentity();
    let openCount = 0;
    const session = new FakeMcpSession({ identity });
    const supervisor = new MCPConnectionSupervisor({
      serverId: identity.serverId,
      openSession: async () => {
        openCount += 1;
        return session;
      },
      timeouts: fixtureTimeouts(),
    });

    expect(supervisor.getState()).toEqual({ kind: 'idle' });

    const opened = await supervisor.ensureConnected();

    expect(opened).toBe(session);
    expect(openCount).toBe(1);
    expect(supervisor.getState()).toEqual({ kind: 'connected', identity });
  });

  it('reuses the live session on a second ensureConnected() rather than opening a new one', async () => {
    const identity = fixtureIdentity();
    let openCount = 0;
    const session = new FakeMcpSession({ identity });
    const supervisor = new MCPConnectionSupervisor({
      serverId: identity.serverId,
      openSession: async () => {
        openCount += 1;
        return session;
      },
      timeouts: fixtureTimeouts(),
    });

    await supervisor.ensureConnected();
    const second = await supervisor.ensureConnected();

    expect(second).toBe(session);
    expect(openCount).toBe(1);
  });

  it('fires onStateChange on every transition', async () => {
    const identity = fixtureIdentity();
    const session = new FakeMcpSession({ identity });
    const seen: TMCPConnectionState[] = [];
    const supervisor = new MCPConnectionSupervisor({
      serverId: identity.serverId,
      openSession: async () => session,
      timeouts: fixtureTimeouts(),
      onStateChange: (state) => seen.push(state),
    });

    await supervisor.ensureConnected();
    await supervisor.shutdown();

    expect(seen.map((s) => s.kind)).toEqual(['connecting', 'connected', 'closed']);
  });

  it("hands the call's ask port to the session unchanged, and nothing when the call has none", async () => {
    const identity = fixtureIdentity();
    const session = new FakeMcpSession({ identity });
    const supervisor = new MCPConnectionSupervisor({
      serverId: identity.serverId,
      openSession: async () => session,
      timeouts: fixtureTimeouts(),
    });
    const ask = async () => ({ type: 'cancelled' as const });

    await supervisor.callTool('ping', {}, { ask });
    await supervisor.callTool('ping', {});

    expect(session.callToolCalls.map((call) => call.ask)).toEqual([ask, undefined]);
  });

  it('passes a dispatch admission to the connected session for that call only', async () => {
    const identity = fixtureIdentity();
    const seen: unknown[] = [];
    const session = Object.assign(new FakeMcpSession({
      identity,
      callTool: async (_name, _args, options) => {
        seen.push(options?.admitDispatch);
        return { content: [], isError: false };
      },
    }), { supportsDispatchAdmission: true as const });
    const supervisor = new MCPConnectionSupervisor({
      serverId: identity.serverId,
      openSession: async () => session,
      timeouts: fixtureTimeouts(),
    });
    const admit = async (dispatch: () => Promise<unknown>) => ({ response: dispatch() });
    expect(supervisor.forwardsDispatchAdmission).toBe(true);
    await supervisor.callTool('ping', {}, { admitDispatch: admit });
    await supervisor.callTool('ping', {});
    expect(seen).toEqual([admit, undefined]);
  });

  it('refuses admission before calling an older or unsupported session', async () => {
    const identity = fixtureIdentity();
    const session = new FakeMcpSession({ identity });
    const supervisor = new MCPConnectionSupervisor({
      serverId: identity.serverId,
      openSession: async () => session,
      timeouts: fixtureTimeouts(),
    });
    const admit = async (dispatch: () => Promise<unknown>) => ({ response: dispatch() });
    await expect(supervisor.callTool('ping', {}, { admitDispatch: admit })).rejects.toThrow(
      'This session cannot admit a tool dispatch',
    );
    expect(session.callToolCalls).toHaveLength(0);
    await supervisor.callTool('ping', {});
    expect(session.callToolCalls).toHaveLength(1);
  });

  it('closes the live session on shutdown()', async () => {
    const identity = fixtureIdentity();
    const session = new FakeMcpSession({ identity });
    const supervisor = new MCPConnectionSupervisor({
      serverId: identity.serverId,
      openSession: async () => session,
      timeouts: fixtureTimeouts(),
    });

    await supervisor.ensureConnected();
    await supervisor.shutdown();

    expect(session.closeCalls).toBe(1);
    expect(supervisor.getState()).toEqual({ kind: 'closed' });
  });

  it('marks the affected catalog domain stale immediately on a listChanged notification', async () => {
    const identity = fixtureIdentity();
    const session = new FakeMcpSession({ identity });
    const supervisor = new MCPConnectionSupervisor({
      serverId: identity.serverId,
      openSession: async () => session,
      timeouts: fixtureTimeouts(),
    });

    await supervisor.ensureConnected();
    await supervisor.discover();
    expect(supervisor.getLastKnownGood()?.stale).toEqual({
      tools: false,
      prompts: false,
      resources: false,
    });

    session.fireListChanged('tools');

    // Marked stale synchronously, before the triggered refresh() has even resolved.
    expect(supervisor.getLastKnownGood()?.stale.tools).toBe(true);

    await flushMicrotasks();

    // The refresh succeeded (same fake session, default discover()), so it clears back to false.
    expect(supervisor.getLastKnownGood()?.stale.tools).toBe(false);
  });

  it('surfaces a background refresh failure through lastRefreshFailure instead of dropping it', async () => {
    const identity = fixtureIdentity();
    let discoverCount = 0;
    const session = new FakeMcpSession({
      identity,
      discover: async (options) => {
        discoverCount += 1;
        if (discoverCount === 1) {
          return fixtureDiscovery(identity);
        }
        throw new Error('refresh failed');
      },
    });
    const supervisor = new MCPConnectionSupervisor({
      serverId: identity.serverId,
      openSession: async () => session,
      timeouts: fixtureTimeouts(),
    });

    await supervisor.ensureConnected();
    await supervisor.discover();
    expect(supervisor.lastRefreshFailure).toBeUndefined();

    session.fireListChanged('tools');
    // The failure path chains through two additional `try/catch` hops (`refresh()`'s own, then
    // `refreshInBackground()`'s) versus the success path, so it needs more than the default tick count.
    await flushMicrotasks(10);

    expect(supervisor.lastRefreshFailure).toEqual({
      domain: 'tools',
      message: 'refresh failed',
      at: expect.any(Number),
    });
    expect(supervisor.getLastKnownGood()?.stale.tools).toBe(true);
  });
});
