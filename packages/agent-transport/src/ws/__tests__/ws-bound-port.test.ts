/**
 * A host can ask for any free port: with `port: 0` the system picks one, and `boundPort` reports the
 * port the server actually bound, which a client can reach.
 */
import { createTestInteractiveSession } from '@robota-sdk/agent-interface/session/testing';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';

import { WsTransport } from '../ws-transport-configurable.js';

const started: WsTransport[] = [];
afterEach(async () => {
  for (const transport of started.splice(0)) await transport.stop();
});

async function start(port: number): Promise<WsTransport> {
  const transport = new WsTransport({ port, open: true, openReason: 'bound port test' });
  transport.attach(
    createTestInteractiveSession({
      getMessages: () => [],
      getExecutionWorkspaceSnapshot: () => ({ entries: [] }) as never,
    }),
  );
  await transport.start();
  started.push(transport);
  return transport;
}

describe('the WebSocket transport bound port', () => {
  it('reports the port the system picked for port 0, and a client reaches it', async () => {
    const first = await start(0);
    const second = await start(0);
    expect(first.boundPort).toBeGreaterThan(0);
    expect(second.boundPort).toBeGreaterThan(0);
    expect(second.boundPort).not.toBe(first.boundPort);
    const ws = new WebSocket(`ws://127.0.0.1:${first.boundPort}`);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });
    ws.close();
  });
});
