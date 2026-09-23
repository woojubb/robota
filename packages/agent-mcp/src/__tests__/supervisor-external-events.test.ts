import { describe, expect, it } from 'vitest';

import {
  FakeMcpSession,
  FakeSupervisorClock,
  fixtureIdentity,
  fixtureTimeouts,
  flushMicrotasks,
} from './supervisor-test-helpers.js';
import { MCPConnectionSupervisor } from '../supervisor/connection.js';

const EVENT = { senderId: 'alice', conversationId: 'chat-1', content: 'hello' };

describe('MCP supervisor external event subscriptions', () => {
  it('pins a subscribed session against idle close, then restores idle close on unsubscribe', async () => {
    const clock = new FakeSupervisorClock();
    const session = new FakeMcpSession({ identity: fixtureIdentity(), externalEventsDeclared: true });
    const supervisor = new MCPConnectionSupervisor({
      serverId: 'server-1',
      openSession: async () => session,
      timeouts: fixtureTimeouts({ idleMs: 20 }),
      clock,
    });
    await supervisor.ensureConnected();
    const received: unknown[] = [];
    const unsubscribe = supervisor.onExternalEvent((event) => received.push(event));
    session.fireExternalEvent(EVENT);
    expect(received).toEqual([EVENT]);

    await clock.advance(21);
    expect(supervisor.getState().kind).toBe('connected');
    expect(session.closeCalls).toBe(0);

    unsubscribe();
    await clock.advance(20);
    expect(supervisor.getState().kind).toBe('idle');
    expect(session.closeCalls).toBe(1);
  });

  it('retains one logical subscription across a transport close and bounded reconnect', async () => {
    const clock = new FakeSupervisorClock();
    const first = new FakeMcpSession({ identity: fixtureIdentity(), externalEventsDeclared: true });
    const second = new FakeMcpSession({ identity: fixtureIdentity(), externalEventsDeclared: true });
    let opens = 0;
    const supervisor = new MCPConnectionSupervisor({
      serverId: 'server-1',
      openSession: async () => ++opens === 1 ? first : second,
      timeouts: fixtureTimeouts(),
      backoff: { initialMs: 10, maxAttempts: 3 },
      clock,
    });
    await supervisor.ensureConnected();
    const received: unknown[] = [];
    const unsubscribe = supervisor.onExternalEvent((event) => received.push(event));

    first.fireTransportClose();
    expect(supervisor.getState()).toMatchObject({
      kind: 'failed', classification: 'transient', retry: 'pending',
    });
    first.fireExternalEvent(EVENT);
    expect(received).toEqual([]);
    const toolDuringBackoff = supervisor.callTool('echo', {});
    await clock.advance(10);
    await flushMicrotasks();
    await expect(toolDuringBackoff).resolves.toMatchObject({ isError: false });
    expect(second.callToolCalls).toHaveLength(1);
    expect(supervisor.getState().kind).toBe('connected');
    second.fireExternalEvent(EVENT);
    expect(received).toEqual([EVENT]);

    unsubscribe();
    await supervisor.shutdown();
    second.fireExternalEvent(EVENT);
    expect(received).toEqual([EVENT]);
  });

  it('refuses subscription when the connected server omitted the capability', async () => {
    const session = new FakeMcpSession({ identity: fixtureIdentity() });
    const supervisor = new MCPConnectionSupervisor({
      serverId: 'server-1',
      openSession: async () => session,
      timeouts: fixtureTimeouts(),
    });
    await supervisor.ensureConnected();
    expect(() => supervisor.onExternalEvent(() => undefined)).toThrow('external event');
    await supervisor.shutdown();
  });

  it('bounds repeated disconnects and does not spin forever', async () => {
    const clock = new FakeSupervisorClock();
    const first = new FakeMcpSession({ identity: fixtureIdentity(), externalEventsDeclared: true });
    const second = new FakeMcpSession({ identity: fixtureIdentity(), externalEventsDeclared: true });
    let opens = 0;
    const supervisor = new MCPConnectionSupervisor({
      serverId: 'server-1',
      openSession: async () => ++opens === 1 ? first : second,
      timeouts: fixtureTimeouts(),
      backoff: { initialMs: 10, maxAttempts: 2 },
      clock,
    });
    await supervisor.ensureConnected();
    const unsubscribe = supervisor.onExternalEvent(() => undefined);
    first.fireTransportClose();
    await clock.advance(10);
    await flushMicrotasks();
    second.fireTransportClose();
    expect(supervisor.getState()).toMatchObject({
      kind: 'failed', classification: 'transient', retry: 'manual-retry',
    });
    await clock.advance(10_000);
    expect(opens).toBe(2);
    unsubscribe();
    await supervisor.shutdown();
  });

  it('rejects a reconnect that drops the declared capability', async () => {
    const clock = new FakeSupervisorClock();
    const first = new FakeMcpSession({ identity: fixtureIdentity(), externalEventsDeclared: true });
    const second = new FakeMcpSession({ identity: fixtureIdentity() });
    let opens = 0;
    const supervisor = new MCPConnectionSupervisor({
      serverId: 'server-1',
      openSession: async () => ++opens === 1 ? first : second,
      timeouts: fixtureTimeouts(),
      backoff: { initialMs: 10, maxAttempts: 3 },
      clock,
    });
    await supervisor.ensureConnected();
    supervisor.onExternalEvent(() => undefined);
    first.fireTransportClose();
    await clock.advance(10);
    await flushMicrotasks();
    expect(second.closeCalls).toBe(1);
    expect(supervisor.getState()).toMatchObject({
      kind: 'failed', classification: 'config', retry: 'manual-retry',
    });
    await supervisor.shutdown();
  });

  it('does not report a connected session when it closed just before subscribing', async () => {
    const clock = new FakeSupervisorClock();
    const first = new FakeMcpSession({ identity: fixtureIdentity(), externalEventsDeclared: true });
    const closed = new FakeMcpSession({ identity: fixtureIdentity(), externalEventsDeclared: true });
    const replacement = new FakeMcpSession({ identity: fixtureIdentity(), externalEventsDeclared: true });
    let opens = 0;
    const supervisor = new MCPConnectionSupervisor({
      serverId: 'server-1',
      openSession: async () => {
        opens += 1;
        if (opens === 1) return first;
        if (opens === 2) {
          closed.fireTransportClose();
          return closed;
        }
        return replacement;
      },
      timeouts: fixtureTimeouts(),
      backoff: { initialMs: 10, maxAttempts: 3 },
      clock,
    });
    await supervisor.ensureConnected();
    const received: unknown[] = [];
    supervisor.onExternalEvent((event) => received.push(event));
    first.fireTransportClose();
    const waiting = supervisor.ensureConnected();
    await clock.advance(10);
    await expect(waiting).rejects.toThrow('closed during subscription');
    expect(supervisor.getState()).toMatchObject({ kind: 'failed', retry: 'pending' });
    await clock.advance(20);
    replacement.fireExternalEvent(EVENT);
    expect(received).toEqual([EVENT]);
    await supervisor.shutdown();
  });

  it('cancels a queued recovery when the last host listener opts out', async () => {
    const clock = new FakeSupervisorClock();
    const session = new FakeMcpSession({ identity: fixtureIdentity(), externalEventsDeclared: true });
    let opens = 0;
    const supervisor = new MCPConnectionSupervisor({
      serverId: 'server-1',
      openSession: async () => { opens += 1; return session; },
      timeouts: fixtureTimeouts(),
      backoff: { initialMs: 10 },
      clock,
    });
    await supervisor.ensureConnected();
    const unsubscribe = supervisor.onExternalEvent(() => undefined);
    session.fireTransportClose();
    const waiting = supervisor.ensureConnected();
    unsubscribe();
    await expect(waiting).rejects.toThrow('recovery was cancelled');
    await clock.advance(100);
    expect(opens).toBe(1);
    expect(supervisor.getState().kind).toBe('idle');
    await supervisor.shutdown();
  });
});
