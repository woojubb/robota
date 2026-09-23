import { describe, expect, it } from 'vitest';

import { FakeMcpSession, fixtureIdentity, fixtureTimeouts } from './supervisor-test-helpers.js';
import { MCPStdioError } from '../client/stdio-transport.js';
import { MCPConnectionSupervisor } from '../supervisor/connection.js';

import type { IMCPSession } from '../client/session.js';

describe('stdio supervisor cleanup ownership', () => {
  it('propagates a late session close failure through pending shutdown', async () => {
    let deliver: ((session: IMCPSession) => void) | undefined;
    const opened = new Promise<IMCPSession>((resolve) => {
      deliver = resolve;
    });
    const session = new FakeMcpSession({
      identity: fixtureIdentity(),
      close: async () => {
        throw new MCPStdioError('cleanup');
      },
    });
    const supervisor = new MCPConnectionSupervisor({
      serverId: 'server-1',
      awaitOpenCleanupOnTimeout: true,
      openSession: () => opened,
      timeouts: fixtureTimeouts(),
    });
    const connecting = expect(supervisor.ensureConnected()).rejects.toThrow();
    const shutdown = expect(supervisor.shutdown()).rejects.toThrow('Stdio transport cleanup');
    if (deliver === undefined) throw Error('open was not requested');
    deliver(session);
    await shutdown;
    await connecting;
    expect(session.closeCalls).toBe(1);
  });
});
