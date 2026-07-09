import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { SignalingRelay, type ISignalingPeer } from '../relay.js';
import { startSignalingServer } from '../server.js';

/** In-memory fake peer that records every frame it is sent — no socket, no network. */
function createFakePeer(id: string): ISignalingPeer & { readonly sent: string[] } {
  const sent: string[] = [];
  return {
    id,
    sent,
    send(raw: string): void {
      sent.push(raw);
    },
    close(): void {
      /* no-op */
    },
  };
}

function lastFrame(peer: { readonly sent: string[] }): Record<string, unknown> {
  return JSON.parse(peer.sent[peer.sent.length - 1]) as Record<string, unknown>;
}

describe('SignalingRelay (REMOTE-002 Stage A — content-blind rendezvous)', () => {
  it('TC-04: relays an SDP/ICE signal only to the counterpart sharing the rendezvous id', () => {
    const relay = new SignalingRelay();
    const host = createFakePeer('host');
    const remote = createFakePeer('remote');

    relay.handleFrame(host, JSON.stringify({ type: 'join', rendezvous: 'r1' }));
    relay.handleFrame(remote, JSON.stringify({ type: 'join', rendezvous: 'r1' }));
    expect(lastFrame(host)).toEqual({ type: 'joined', rendezvous: 'r1' });

    // Host sends an offer; only the remote (same rendezvous) receives it, verbatim.
    relay.handleFrame(host, JSON.stringify({ type: 'signal', kind: 'offer', data: { sdp: 'X' } }));
    expect(lastFrame(remote)).toEqual({ type: 'signal', kind: 'offer', data: { sdp: 'X' } });
    // The sender never receives its own signal echoed back.
    expect(host.sent.some((f) => JSON.parse(f).kind === 'offer')).toBe(false);
  });

  it('TC-04: never forwards a non-signaling payload to the counterpart', () => {
    const relay = new SignalingRelay();
    const host = createFakePeer('host');
    const remote = createFakePeer('remote');
    relay.handleFrame(host, JSON.stringify({ type: 'join', rendezvous: 'r1' }));
    relay.handleFrame(remote, JSON.stringify({ type: 'join', rendezvous: 'r1' }));
    const remoteFramesBefore = remote.sent.length;

    // A frame masquerading as session content, and a signal with an unknown kind — both rejected, never relayed.
    relay.handleFrame(host, JSON.stringify({ type: 'chat', message: 'secret session content' }));
    relay.handleFrame(host, JSON.stringify({ type: 'signal', kind: 'evil', data: 'x' }));

    // The remote received nothing new; the host got error replies for both.
    expect(remote.sent.length).toBe(remoteFramesBefore);
    expect(lastFrame(host)).toEqual({ type: 'error', reason: 'unsupported-frame' });
  });

  it('does not cross-forward signals between distinct rendezvous ids', () => {
    const relay = new SignalingRelay();
    const a = createFakePeer('a');
    const b = createFakePeer('b');
    relay.handleFrame(a, JSON.stringify({ type: 'join', rendezvous: 'ra' }));
    relay.handleFrame(b, JSON.stringify({ type: 'join', rendezvous: 'rb' }));
    const bBefore = b.sent.length;
    relay.handleFrame(a, JSON.stringify({ type: 'signal', kind: 'ice', data: 1 }));
    expect(b.sent.length).toBe(bBefore);
  });

  it('rejects a third peer on a full rendezvous and holds no state after all leave', () => {
    const relay = new SignalingRelay();
    const p1 = createFakePeer('p1');
    const p2 = createFakePeer('p2');
    const p3 = createFakePeer('p3');
    relay.handleFrame(p1, JSON.stringify({ type: 'join', rendezvous: 'r' }));
    relay.handleFrame(p2, JSON.stringify({ type: 'join', rendezvous: 'r' }));
    relay.handleFrame(p3, JSON.stringify({ type: 'join', rendezvous: 'r' }));
    expect(lastFrame(p3)).toEqual({ type: 'error', reason: 'rendezvous-full' });

    relay.remove(p1);
    relay.remove(p2);
    expect(relay.rendezvousCount).toBe(0);
  });

  it('rejects a signal before the peer has joined a rendezvous', () => {
    const relay = new SignalingRelay();
    const p = createFakePeer('p');
    relay.handleFrame(p, JSON.stringify({ type: 'signal', kind: 'offer', data: {} }));
    expect(lastFrame(p)).toEqual({ type: 'error', reason: 'not-joined' });
  });
});

describe('startSignalingServer (REMOTE-002 Stage A — loopback/ephemeral binding)', () => {
  it('binds loopback on an ephemeral port and relays a real SDP offer between two WS peers', async () => {
    const server = await startSignalingServer(); // defaults: 127.0.0.1 : ephemeral
    expect(server.port).toBeGreaterThan(0);
    const url = `ws://127.0.0.1:${server.port}`;

    const host = new WebSocket(url);
    const remote = new WebSocket(url);
    await Promise.all([once(host, 'open'), once(remote, 'open')]);

    // Resolve once the counterpart has confirmed its join, and again with the relayed signal.
    const relayed = new Promise<Record<string, unknown>>((resolve) => {
      remote.on('message', (d: Buffer) => {
        const frame = JSON.parse(d.toString());
        if (frame.type === 'signal') resolve(frame);
      });
    });
    const remoteJoined = new Promise<void>((resolve) => {
      remote.on('message', (d: Buffer) => {
        if (JSON.parse(d.toString()).type === 'joined') resolve();
      });
    });
    const hostJoined = new Promise<void>((resolve) => {
      host.on('message', (d: Buffer) => {
        if (JSON.parse(d.toString()).type === 'joined') resolve();
      });
    });

    host.send(JSON.stringify({ type: 'join', rendezvous: 'rr' }));
    remote.send(JSON.stringify({ type: 'join', rendezvous: 'rr' }));
    // Only send the offer once both peers are confirmed in the rendezvous — no ordering race.
    await Promise.all([hostJoined, remoteJoined]);
    host.send(JSON.stringify({ type: 'signal', kind: 'offer', data: { sdp: 'v=0' } }));

    const frame = await relayed;
    expect(frame).toEqual({ type: 'signal', kind: 'offer', data: { sdp: 'v=0' } });

    host.close();
    remote.close();
    await server.close();
  });
});

function once(ws: WebSocket, event: 'open'): Promise<void> {
  return new Promise((resolve) => ws.once(event, () => resolve()));
}
