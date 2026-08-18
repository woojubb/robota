/**
 * PEER-005 (issue #1863, stage 3) — bytes between two local sessions, and nothing more.
 *
 * These cases run REAL sockets in a scratch directory. A stubbed transport would prove the code
 * calls the functions it calls; what has to be established here is that a message written by one
 * process shape arrives at another and that the ack comes back — the property the whole peer stack
 * has been waiting on, and the one a stub cannot show.
 *
 * What is deliberately NOT re-asserted: ordering, duplicates and ack issuance. Those belong to the
 * ledger in `agent-transport-protocol` and re-testing them here would create a second opinion about
 * rules that must have exactly one.
 */

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  listenForPeerMessages,
  peerSocketPath,
  sendPeerMessage,
  type IPeerListener,
} from '../local-peer-channel.js';

import type { IPeerMessage, IPeerMessageAck } from '@robota-sdk/agent-interface-transport';

const scratch: string[] = [];
const listeners: IPeerListener[] = [];

afterEach(async () => {
  while (listeners.length > 0) await listeners.pop()?.close();
  while (scratch.length > 0) rmSync(scratch.pop() as string, { recursive: true, force: true });
});

/** A directory shaped the way the rendezvous leaf leaves one: ours, and 0700. */
function guardedDirectory(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'peer-channel-'));
  chmodSync(dir, 0o700);
  scratch.push(dir);
  return dir;
}

function message(overrides: Partial<IPeerMessage> = {}): IPeerMessage {
  return {
    id: 'msg-1',
    sequence: 1,
    origin: { sessionId: 'session-sender' },
    text: 'hello from the other session',
    sentAt: 1_700_000_000_000,
    ...overrides,
  };
}

const ACCEPT = (received: IPeerMessage): IPeerMessageAck => ({
  id: received.id,
  sequence: received.sequence,
  state: 'delivered',
});

async function listen(dir: string, sessionId: string, onMessage = ACCEPT): Promise<IPeerListener> {
  const listener = await listenForPeerMessages({ guardedDirectory: dir, sessionId, onMessage });
  listeners.push(listener);
  return listener;
}

describe('a message reaches the other session', () => {
  it('delivers the text and returns the ack the receiver issued', async () => {
    const dir = guardedDirectory();
    const received: IPeerMessage[] = [];
    await listen(dir, 'session-receiver', (incoming) => {
      received.push(incoming);
      return ACCEPT(incoming);
    });

    const ack = await sendPeerMessage({
      guardedDirectory: dir,
      targetSessionId: 'session-receiver',
      message: message(),
    });

    expect(received).toHaveLength(1);
    expect(received[0]?.text).toBe('hello from the other session');
    expect(received[0]?.origin.sessionId).toBe('session-sender');
    expect(ack).toEqual({ id: 'msg-1', sequence: 1, state: 'delivered' });
  });

  it('carries back a verdict the carrier did not form', async () => {
    // The ledger answers a repeated id with the ORIGINAL verdict. This must pass `duplicate` through
    // untouched — a carrier that re-decided delivery states would give the sender a second opinion
    // about a rule that has exactly one owner.
    const dir = guardedDirectory();
    await listen(dir, 'session-receiver', (incoming) => ({
      id: incoming.id,
      sequence: incoming.sequence,
      state: 'duplicate',
    }));

    const ack = await sendPeerMessage({
      guardedDirectory: dir,
      targetSessionId: 'session-receiver',
      message: message(),
    });
    expect(ack.state).toBe('duplicate');
  });

  it('carries a refusal and its reason', async () => {
    const dir = guardedDirectory();
    await listen(dir, 'session-receiver', (incoming) => ({
      id: incoming.id,
      sequence: incoming.sequence,
      state: 'refused',
      reason: 'the session is shutting down',
    }));

    const ack = await sendPeerMessage({
      guardedDirectory: dir,
      targetSessionId: 'session-receiver',
      message: message(),
    });
    expect(ack).toMatchObject({ state: 'refused', reason: 'the session is shutting down' });
  });

  it('both directions on one directory', async () => {
    // Two sessions each listening and each sending — issue #1863's definition of done in miniature,
    // minus the shell. One listener answering while the other sends is the case a single-socket test
    // cannot reach.
    const dir = guardedDirectory();
    await listen(dir, 'session-a');
    await listen(dir, 'session-b');

    const toB = await sendPeerMessage({
      guardedDirectory: dir,
      targetSessionId: 'session-b',
      message: message({ id: 'a-to-b', origin: { sessionId: 'session-a' } }),
    });
    const toA = await sendPeerMessage({
      guardedDirectory: dir,
      targetSessionId: 'session-a',
      message: message({ id: 'b-to-a', origin: { sessionId: 'session-b' } }),
    });

    expect(toB).toMatchObject({ id: 'a-to-b', state: 'delivered' });
    expect(toA).toMatchObject({ id: 'b-to-a', state: 'delivered' });
  });
});

describe('what it refuses', () => {
  it('refuses to bind in a directory that is not 0700', async () => {
    // The trust claim IS the directory's mode. Binding in a world-writable directory and calling the
    // result `same-user-same-host` would be the copyable-credential failure the rendezvous exists to
    // prevent, wearing a socket.
    const dir = guardedDirectory();
    chmodSync(dir, 0o755);
    await expect(
      listenForPeerMessages({
        guardedDirectory: dir,
        sessionId: 'session-receiver',
        onMessage: ACCEPT,
      }),
    ).rejects.toThrow(/not admitted/);
  });

  it('refuses to send to a target outside the guarded directory', async () => {
    // Checked BEFORE connecting. Connecting first would already have handed the text over.
    const dir = guardedDirectory();
    await expect(
      sendPeerMessage({
        guardedDirectory: dir,
        targetSessionId: path.join('..', 'escape'),
        message: message(),
      }),
    ).rejects.toThrow(/not admitted|outside/);
  });

  it('fails rather than hanging when no session is listening there', async () => {
    const dir = guardedDirectory();
    await expect(
      sendPeerMessage({
        guardedDirectory: dir,
        targetSessionId: 'session-nobody',
        message: message(),
      }),
    ).rejects.toThrow();
  });

  it('answers an unreadable message with a refusal instead of silence', async () => {
    // The sender is waiting. Dropping it would be indistinguishable from a peer that died mid-send,
    // which is exactly the distinction the delivery states exist to make.
    const dir = guardedDirectory();
    await listen(dir, 'session-receiver');

    const { createConnection } = await import('node:net');
    const socketPath = peerSocketPath(dir, 'session-receiver');
    const reply = await new Promise<string>((resolve, reject) => {
      const socket = createConnection(socketPath, () => socket.write('not json at all\n'));
      socket.setEncoding('utf8');
      socket.on('data', (chunk: string) => resolve(chunk));
      socket.on('error', reject);
    });
    expect(JSON.parse(reply)).toMatchObject({ state: 'refused' });
  });
});

describe('rebinding after a crash', () => {
  it('takes over a socket file a dead session left behind', async () => {
    // A crashed session leaves its socket FILE with no listener behind it, and `listen()` on an
    // existing path fails with EADDRINUSE. Removing it is safe precisely BECAUSE the directory is
    // ours — nothing else could have put it there.
    //
    // The stale entry is written directly rather than by killing a server, because an in-process
    // server cannot be made to leak its path: closing it unlinks. The file IS the state a crash
    // leaves, so reproducing the state is more faithful than reproducing the crash.
    const dir = guardedDirectory();
    writeFileSync(peerSocketPath(dir, 'session-receiver'), '');

    const listener = await listenForPeerMessages({
      guardedDirectory: dir,
      sessionId: 'session-receiver',
      onMessage: ACCEPT,
    });
    listeners.push(listener);

    const ack = await sendPeerMessage({
      guardedDirectory: dir,
      targetSessionId: 'session-receiver',
      message: message(),
    });
    expect(ack.state).toBe('delivered');
  });
});
