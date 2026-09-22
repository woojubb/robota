/**
 * TC-16: startup, per-call, global-default and idle timeouts are four distinct typed settings, each
 * independently configurable, and a value set for one does not change another (MCP-003).
 *
 * Decision recorded for this test file (no contract text pins it down further): `perCallMs` is
 * forwarded verbatim as the per-request budget on every `discover`/`callTool` request; `globalDefaultMs`
 * is the DEFAULT overall abort budget applied by the supervisor only when the caller passes no
 * `signal` of their own to `discover`/`refresh`/`callTool` — a caller-supplied signal means the caller
 * owns cancellation and the default is not layered on top of it.
 */
import { describe, expect, it } from 'vitest';

import {
  FakeMcpSession,
  FakeSupervisorClock,
  fixtureIdentity,
  fixtureTimeouts,
  flushMicrotasks,
} from './supervisor-test-helpers.js';
import { MCPConnectionSupervisor } from '../supervisor/connection.js';

describe('MCPConnectionSupervisor — four distinct timeouts (TC-16)', () => {
  it('setting one timeout field leaves the others at their configured values', () => {
    const base = fixtureTimeouts();
    const onlyIdleChanged = { ...base, idleMs: 1 };

    expect(onlyIdleChanged.startupMs).toBe(base.startupMs);
    expect(onlyIdleChanged.perCallMs).toBe(base.perCallMs);
    expect(onlyIdleChanged.globalDefaultMs).toBe(base.globalDefaultMs);
    expect(onlyIdleChanged.idleMs).toBe(1);
  });

  it('startupMs bounds the open call, independent of the other three', async () => {
    const clock = new FakeSupervisorClock();
    const supervisor = new MCPConnectionSupervisor({
      serverId: 'server-1',
      openSession: () => new Promise<never>(() => undefined), // never resolves
      timeouts: { startupMs: 50, perCallMs: 9_999, globalDefaultMs: 9_999, idleMs: 9_999 },
      clock,
    });

    const pending = supervisor.ensureConnected().catch((error: unknown) => error);

    await clock.advance(49);
    expect(supervisor.getState().kind).toBe('connecting');

    await clock.advance(1);
    const result = await pending;
    expect(result).toBeInstanceOf(Error);
    expect(supervisor.getState().kind).toBe('failed');
  });

  it('perCallMs is forwarded verbatim to each list/call request, independent of the other three', async () => {
    const identity = fixtureIdentity();
    const session = new FakeMcpSession({ identity });
    const supervisor = new MCPConnectionSupervisor({
      serverId: identity.serverId,
      openSession: async () => session,
      timeouts: { startupMs: 1_111, perCallMs: 42, globalDefaultMs: 2_222, idleMs: 3_333 },
    });

    await supervisor.ensureConnected();
    await supervisor.discover();
    expect(session.discoverCalls[0]?.perRequestTimeoutMs).toBe(42);

    await supervisor.callTool('noop', {});
    expect(session.callToolCalls[0]?.timeoutMs).toBe(42);
  });

  it('globalDefaultMs bounds a call only when the caller supplies no signal', async () => {
    const clock = new FakeSupervisorClock();
    const identity = fixtureIdentity();
    const session = new FakeMcpSession({
      identity,
      callTool: () => new Promise<never>(() => undefined), // hangs
    });
    const supervisor = new MCPConnectionSupervisor({
      serverId: identity.serverId,
      openSession: async () => session,
      timeouts: { startupMs: 9_999, perCallMs: 9_999, globalDefaultMs: 75, idleMs: 9_999 },
      clock,
    });
    await supervisor.ensureConnected();

    const noSignal = supervisor.callTool('slow', {}).catch((error: unknown) => error);
    await clock.advance(75);
    const result = await noSignal;
    expect(result).toBeInstanceOf(Error);

    // With an explicit signal, the caller owns cancellation: the default budget is not layered on.
    let settled = false;
    supervisor
      .callTool('slow', {}, { signal: new AbortController().signal })
      .then(() => (settled = true))
      .catch(() => (settled = true));
    await clock.advance(10_000); // far past globalDefaultMs
    await flushMicrotasks();
    expect(settled).toBe(false);
  });

  it('idleMs closes the session after inactivity and returns to idle, independent of the other three', async () => {
    const clock = new FakeSupervisorClock();
    const identity = fixtureIdentity();
    const session = new FakeMcpSession({ identity });
    const supervisor = new MCPConnectionSupervisor({
      serverId: identity.serverId,
      openSession: async () => session,
      timeouts: { startupMs: 9_999, perCallMs: 9_999, globalDefaultMs: 9_999, idleMs: 30 },
      clock,
    });

    await supervisor.ensureConnected();
    expect(supervisor.getState().kind).toBe('connected');

    await clock.advance(29);
    expect(supervisor.getState().kind).toBe('connected');

    await clock.advance(1);
    expect(supervisor.getState().kind).toBe('idle');
    expect(session.closeCalls).toBe(1);
  });
});
