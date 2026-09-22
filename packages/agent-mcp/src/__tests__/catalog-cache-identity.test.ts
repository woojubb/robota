/**
 * TC-22: a retained last-known-good catalog carries an explicit identity (server id plus negotiated
 * `protocolVersion` plus `serverInfo.version`), a reconnect whose identity differs invalidates it
 * rather than reusing it, and nothing is inferred from a stale session id (MCP-003 condition 9).
 *
 * `IMCPServerIdentity` (`../catalog/types.ts`) has no session-id field at all — `serverId`,
 * `serverName`, `serverVersion`, `protocolVersion` — so the identity comparison this test drives
 * structurally cannot fall back to inferring anything from one.
 */
import { describe, expect, it } from 'vitest';

import {
  FakeMcpSession,
  fixtureIdentity,
  fixtureTimeouts,
  FakeSupervisorClock,
} from './supervisor-test-helpers.js';
import { MCPConnectionSupervisor } from '../supervisor/connection.js';

describe('MCPConnectionSupervisor — last-known-good catalog identity (TC-22)', () => {
  it('drops the retained catalog when a reconnect carries a different identity', async () => {
    const clock = new FakeSupervisorClock();
    const originalIdentity = fixtureIdentity({ serverVersion: '1.0.0' });
    const originalSession = new FakeMcpSession({ identity: originalIdentity });
    const upgradedIdentity = fixtureIdentity({ serverVersion: '2.0.0' }); // same serverId, different serverVersion
    const upgradedSession = new FakeMcpSession({ identity: upgradedIdentity });

    let openCount = 0;
    const supervisor = new MCPConnectionSupervisor({
      serverId: originalIdentity.serverId,
      openSession: async () => {
        openCount += 1;
        return openCount === 1 ? originalSession : upgradedSession;
      },
      timeouts: { ...fixtureTimeouts(), idleMs: 10 },
      clock,
    });

    await supervisor.ensureConnected();
    await supervisor.discover();
    expect(supervisor.getLastKnownGood()).toBeDefined();

    // Go idle (not a reconnect, and not an identity change) — the catalog must survive this.
    await clock.advance(10);
    expect(supervisor.getState().kind).toBe('idle');
    expect(supervisor.getLastKnownGood()).toBeDefined();

    // Reconnect: the new session reports a DIFFERENT identity (protocolVersion/serverVersion changed).
    await supervisor.ensureConnected();
    expect(openCount).toBe(2);
    expect(supervisor.getLastKnownGood()).toBeUndefined();
  });

  it('retains the catalog across a reconnect when the identity is unchanged', async () => {
    const clock = new FakeSupervisorClock();
    const identity = fixtureIdentity();
    const session = new FakeMcpSession({ identity });

    let openCount = 0;
    const supervisor = new MCPConnectionSupervisor({
      serverId: identity.serverId,
      openSession: async () => {
        openCount += 1;
        return session;
      },
      timeouts: { ...fixtureTimeouts(), idleMs: 10 },
      clock,
    });

    await supervisor.ensureConnected();
    await supervisor.discover();
    const before = supervisor.getLastKnownGood();
    expect(before).toBeDefined();

    await clock.advance(10); // idle-close
    await supervisor.ensureConnected(); // reconnect with the SAME identity
    expect(openCount).toBe(2);

    expect(supervisor.getLastKnownGood()).toEqual(before);
  });
});
