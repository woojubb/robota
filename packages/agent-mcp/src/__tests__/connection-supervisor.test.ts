/**
 * TC-09: the supervisor opens, reuses and closes a connection, and a `listChanged` notification marks
 * the affected catalog domain stale (absorbed MCP-003).
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

describe('MCPConnectionSupervisor — open / reuse / close / listChanged (TC-09)', () => {
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
