/**
 * TC-10 (MCP-003 condition 8, runtime half): a failed connection exposes one failed value carrying
 * its classification, and the same classification is readable from it rather than re-derived by the
 * caller.
 */
import { describe, expect, it } from 'vitest';

import { FakeMcpSession, fixtureIdentity, fixtureTimeouts } from './supervisor-test-helpers.js';
import { MCPConnectionSupervisor, MCPSupervisorError } from '../supervisor/connection.js';

describe('MCPConnectionSupervisor — canonical failed state (TC-10)', () => {
  it('exposes classification directly on getState() without the caller re-deriving it', async () => {
    const supervisor = new MCPConnectionSupervisor({
      serverId: 'server-1',
      openSession: async () => {
        const error = new Error('401 unauthorized');
        throw error;
      },
      timeouts: fixtureTimeouts(),
    });

    await expect(supervisor.ensureConnected()).rejects.toThrow();

    const state = supervisor.getState();
    expect(state.kind).toBe('failed');
    if (state.kind !== 'failed') {
      throw new Error('unreachable');
    }
    // The caller reads `state.classification` — it does not call classifyMcpFailure(error) again.
    expect(state.classification).toBe('auth');
    expect(state.retry).toBe('manual-retry');
  });

  it('throws one MCPSupervisorError whose .classification matches the state the failure produced', async () => {
    const identity = fixtureIdentity();
    const session = new FakeMcpSession({
      identity,
      callTool: async () => {
        throw Object.assign(new Error('tool not found'), { code: -32601 });
      },
    });
    const supervisor = new MCPConnectionSupervisor({
      serverId: identity.serverId,
      openSession: async () => session,
      timeouts: fixtureTimeouts(),
    });

    await supervisor.ensureConnected();

    let caught: unknown;
    try {
      await supervisor.callTool('missing-tool', {});
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(MCPSupervisorError);
    expect((caught as MCPSupervisorError).classification).toBe('not-found');
  });
});
