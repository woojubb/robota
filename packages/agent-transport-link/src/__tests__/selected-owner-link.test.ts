import { PassThrough, type Duplex } from 'node:stream';
import { createRuntimeIdentity, startSpawnerExchange, type IOwnerHandover } from '@robota-sdk/agent-keyring';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { openSelectedOwnerLink, openSpawnerLink } from '../index.js';
import { BINDING, connect, controlEndpoint, keyrings, listen, recordingRuntime } from './harness.js';

let owner: IOwnerHandover;
let stranger: IOwnerHandover;
beforeAll(async () => { ({ owner, stranger } = await keyrings()); });
afterAll(() => { owner.dispose(); stranger.dispose(); });

describe('selected owner link', () => {
  it('authenticates the selected binding and rejects a different key or start', async () => {
    const identity = createRuntimeIdentity();
    const exchange = startSpawnerExchange();
    const { spawnerKey, instancePublicKey } = exchange.complete(identity.answerSpawnerExchange(exchange.message));
    const runtime = recordingRuntime(identity);
    const server = await listen(controlEndpoint(identity, runtime.admit));
    try {
      const spawner = await openSpawnerLink(await connect(server.port), spawnerKey, instancePublicKey);
      await spawner.installTrustRoot(owner.certify(spawner.instancePublicKey, spawner.binding));
      spawner.close();
      const openStream = () => connect(server.port);
      const aborter = new AbortController();
      const client = await openSelectedOwnerLink({ binding: BINDING, handover: owner, openStream, signal: aborter.signal });
      expect(client.binding).toEqual(BINDING);
      expect(client.standing).toBe('owner');
      aborter.abort();
      await expect(client.control({ command: 'status', fields: {} })).resolves.toMatchObject({ status: 'renamed' });
      client.close();
      await expect(openSelectedOwnerLink({ binding: BINDING, handover: stranger, openStream })).rejects.toThrow();
      await expect(openSelectedOwnerLink({ binding: { ...BINDING, generation: 'AAAAAAAAAAAAAAAAAAAAAA' }, handover: owner, openStream })).rejects.toThrow();
    } finally { spawnerKey.wipe(); await server.close(); }
  });

  it('refuses a pre-aborted request before opening a carrier', async () => {
    const aborter = new AbortController();
    aborter.abort();
    const openStream = vi.fn(async () => new PassThrough());
    await expect(openSelectedOwnerLink({ binding: BINDING, handover: owner, openStream, signal: aborter.signal })).rejects.toThrow();
    expect(openStream).not.toHaveBeenCalled();
  });

  it('cancels a pending carrier and destroys any late stream', async () => {
    const aborter = new AbortController();
    let resolve!: (stream: Duplex) => void;
    const pending = new Promise<Duplex>((done) => { resolve = done; });
    const openStream = vi.fn(() => pending);
    const attempt = openSelectedOwnerLink({ binding: BINDING, handover: owner, openStream, signal: aborter.signal });
    aborter.abort();
    await expect(attempt).rejects.toThrow();
    const stream = new PassThrough();
    resolve(stream);
    await vi.waitFor(() => expect(stream.destroyed).toBe(true));
  });

  it('closes a carrier when a handshake is aborted', async () => {
    const aborter = new AbortController();
    let peerClosed!: () => void;
    const closed = new Promise<void>((resolve) => { peerClosed = resolve; });
    const server = await listen((socket) => {
      socket.once('close', peerClosed);
      socket.once('data', () => aborter.abort());
    });
    try {
      await expect(openSelectedOwnerLink({ binding: BINDING, handover: owner, signal: aborter.signal, openStream: () => connect(server.port) })).rejects.toThrow();
      await closed;
    } finally { await server.close(); }
  });
});
