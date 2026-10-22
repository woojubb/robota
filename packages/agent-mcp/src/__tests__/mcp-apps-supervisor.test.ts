import { describe, expect, it } from 'vitest';

import {
  FakeMcpSession,
  fixtureIdentity,
  fixtureTimeouts,
} from './supervisor-test-helpers.js';
import { MCPConnectionSupervisor, MCPSupervisorError } from '../supervisor/connection.js';

const URI = 'ui://dash/view';

function supervisorFor(session: FakeMcpSession, perCallMs = 1_234): MCPConnectionSupervisor {
  return new MCPConnectionSupervisor({
    serverId: session.identity.serverId,
    openSession: async () => session,
    timeouts: fixtureTimeouts({ perCallMs, toolCallMs: 99_999 }),
  });
}

describe('MCPConnectionSupervisor — readResource', () => {
  it('reads over the one live connection, under the per-request protocol timeout', async () => {
    const contents = [{ uri: URI, mimeType: 'text/html;profile=mcp-app', text: '<html></html>' }];
    const session = new FakeMcpSession({
      identity: fixtureIdentity(),
      readResource: async () => ({ contents }),
    });
    const supervisor = supervisorFor(session);
    await supervisor.callTool('ping', {});

    await expect(supervisor.readResource(URI)).resolves.toEqual({ contents });

    expect(session.readResourceCalls).toEqual([{ uri: URI, timeoutMs: 1_234 }]);
    expect(supervisor.getState().kind).toBe('connected');
  });

  it('hands the caller signal down so an abort reaches the request', async () => {
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    const session = new FakeMcpSession({
      identity: fixtureIdentity(),
      readResource: async (_uri, options) => {
        seen = options?.signal;
        return { contents: [] };
      },
    });
    await supervisorFor(session).readResource(URI, { signal: controller.signal });
    expect(seen).toBe(controller.signal);
  });

  it('classifies a failed read the way it classifies a failed call', async () => {
    const session = new FakeMcpSession({
      identity: fixtureIdentity(),
      readResource: async () => {
        throw Object.assign(new Error('forbidden'), { code: 403 });
      },
      callTool: async () => {
        throw Object.assign(new Error('forbidden'), { code: 403 });
      },
    });
    const supervisor = supervisorFor(session);

    const read = await supervisor.readResource(URI).catch((error: unknown) => error);
    const call = await supervisor.callTool('ping', {}).catch((error: unknown) => error);

    expect(read).toBeInstanceOf(MCPSupervisorError);
    expect(call).toBeInstanceOf(MCPSupervisorError);
    expect((read as MCPSupervisorError).classification).toBe(
      (call as MCPSupervisorError).classification,
    );
  });

  it('refuses a new read once the supervisor is shut down', async () => {
    const session = new FakeMcpSession({ identity: fixtureIdentity() });
    const supervisor = supervisorFor(session);
    await supervisor.ensureConnected();
    await supervisor.shutdown();
    await expect(supervisor.readResource(URI)).rejects.toThrow('shut down');
    expect(session.readResourceCalls).toEqual([]);
  });
});
