/**
 * TC-15: a `listChanged` notification refreshes the affected catalog domain WITHOUT reconnecting, and
 * a refresh that fails preserves the prior catalog and exposes `stale` plus the error rather than
 * emptying it (MCP-003).
 */
import { describe, expect, it } from 'vitest';

import {
  FakeMcpSession,
  fixtureDiscovery,
  fixtureIdentity,
  fixtureTimeouts,
  flushMicrotasks,
} from './supervisor-test-helpers.js';
import { MCPConnectionSupervisor } from '../supervisor/connection.js';

describe('MCPConnectionSupervisor — last-known-good on listChanged (TC-15)', () => {
  it('refreshes the affected domain without opening a second session', async () => {
    const identity = fixtureIdentity();
    let openCount = 0;
    const initial = fixtureDiscovery(identity, {
      tools: {
        state: { kind: 'supported', count: 1, listChanged: true },
        items: [{ name: 'old-tool', inputSchema: { type: 'object' } }],
        pages: 1,
      },
    });
    const updated = fixtureDiscovery(identity, {
      tools: {
        state: { kind: 'supported', count: 2, listChanged: true },
        items: [
          { name: 'old-tool', inputSchema: { type: 'object' } },
          { name: 'new-tool', inputSchema: { type: 'object' } },
        ],
        pages: 1,
      },
    });

    let discoverCallCount = 0;
    const session = new FakeMcpSession({
      identity,
      discover: async () => {
        discoverCallCount += 1;
        return discoverCallCount === 1 ? initial : updated;
      },
    });
    const supervisor = new MCPConnectionSupervisor({
      serverId: identity.serverId,
      openSession: async () => {
        openCount += 1;
        return session;
      },
      timeouts: fixtureTimeouts(),
    });

    await supervisor.ensureConnected();
    await supervisor.discover();
    expect(supervisor.getLastKnownGood()?.discovery.tools.items).toHaveLength(1);

    session.fireListChanged('tools');
    await flushMicrotasks();

    expect(openCount).toBe(1); // never reconnected
    const lastKnownGood = supervisor.getLastKnownGood();
    expect(lastKnownGood?.discovery.tools.items.map((t) => t.name)).toEqual([
      'old-tool',
      'new-tool',
    ]);
    expect(lastKnownGood?.stale.tools).toBe(false);
  });

  it('keeps the prior catalog and marks stale plus the error when a refresh fails', async () => {
    const identity = fixtureIdentity();
    let openCount = 0;
    const initial = fixtureDiscovery(identity, {
      prompts: {
        state: { kind: 'supported', count: 1, listChanged: true },
        items: [{ name: 'greeting' }],
        pages: 1,
      },
    });

    let discoverCallCount = 0;
    const session = new FakeMcpSession({
      identity,
      discover: async () => {
        discoverCallCount += 1;
        if (discoverCallCount === 1) {
          return initial;
        }
        throw Object.assign(new Error('gateway timeout'), { status: 504 });
      },
    });
    const supervisor = new MCPConnectionSupervisor({
      serverId: identity.serverId,
      openSession: async () => {
        openCount += 1;
        return session;
      },
      timeouts: fixtureTimeouts(),
    });

    await supervisor.ensureConnected();
    await supervisor.discover();

    session.fireListChanged('prompts');
    await flushMicrotasks();

    expect(openCount).toBe(1); // still never reconnected

    const lastKnownGood = supervisor.getLastKnownGood();
    // The prior catalog is preserved rather than emptied.
    expect(lastKnownGood?.discovery.prompts.items.map((p) => p.name)).toEqual(['greeting']);
    expect(lastKnownGood?.stale.prompts).toBe(true);
    expect(lastKnownGood?.lastError).toMatchObject({ classification: 'transient' });
  });
});
