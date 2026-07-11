import { SessionResumeBridge } from '@robota-sdk/agent-transport-protocol';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-transport';
import { describe, expect, it, vi } from 'vitest';

import { PairingGate } from '../pairing-gate.js';

/**
 * REMOTE-013 E4 — when a `resumeBridge` is supplied, the gate routes the paired session through the bridge
 * (seq-stamped) instead of a fresh handler, and `cleanup()` DETACHES the bridge (session survives the drop).
 */

function fakeSession(): {
  session: IInteractiveSession;
  fire: (event: string, arg: unknown) => void;
} {
  const handlers = new Map<string, (arg: unknown) => void>();
  const session = {
    on: (e: string, h: (arg: unknown) => void) => handlers.set(e, h),
    off: (e: string) => handlers.delete(e),
    getMessages: () => [],
  } as unknown as IInteractiveSession;
  return { session, fire: (e, a) => handlers.get(e)?.(a) };
}

describe('PairingGate E4 resume bridge (REMOTE-013)', () => {
  it('routes the paired session through the bridge (seq-stamped) and detaches on cleanup', async () => {
    const { session, fire } = fakeSession();
    const bridge = new SessionResumeBridge({ session });
    const sent: string[] = [];
    const channel = { send: (d: string) => sent.push(d), close: () => {} };
    // Fake handshake that accepts immediately (isolates the bridge wiring from real B3 crypto).
    const fakeHandshake = (() => ({
      result: Promise.resolve({ sessionKey: 'k' }),
      onFrame: () => {},
    })) as never;

    const gate = new PairingGate({
      channel,
      session,
      secret: 's',
      role: 'initiator',
      localFingerprint: 'A',
      remoteFingerprint: 'B',
      resumeBridge: bridge,
      startHandshake: fakeHandshake,
    });
    // Drive to accept (the fake handshake resolves on a microtask).
    gate.onInbound(JSON.stringify({ t: 'pair-nonce', nonce: 'n' }));
    await Promise.resolve();
    await Promise.resolve();

    // A session event now flows through the bridge → the channel, seq-stamped.
    fire('text_delta', 'hi');
    expect(sent).toHaveLength(1);
    const frame = JSON.parse(sent[0]);
    expect(frame).toMatchObject({ type: 'text_delta', delta: 'hi', seq: 1 });

    // Cleanup DETACHES (does not dispose) — a subsequent event is buffered, not sent, and the session survives.
    gate.cleanup();
    fire('text_delta', 'gap'); // buffered at seq 2, not sent (detached)
    expect(sent).toHaveLength(1);

    // Re-attach a new channel + resume → the gap frame replays with its ORIGINAL seq 2 (continuity).
    const sent2: string[] = [];
    bridge.attach((d) => sent2.push(d));
    bridge.onClientMessage(JSON.stringify({ type: 'resume', lastSeq: 1 }));
    expect(sent2.map((s) => JSON.parse(s).seq)).toEqual([2]);
    bridge.dispose();
  });

  it('a resume/ack inbound frame post-accept is routed to the bridge (not the session)', async () => {
    const { session, fire } = fakeSession();
    const bridge = new SessionResumeBridge({ session });
    const sent: string[] = [];
    const channel = { send: (d: string) => sent.push(d), close: () => {} };
    const fakeHandshake = (() => ({
      result: Promise.resolve({ sessionKey: 'k' }),
      onFrame: () => {},
    })) as never;
    const gate = new PairingGate({
      channel,
      session,
      secret: 's',
      role: 'initiator',
      localFingerprint: 'A',
      remoteFingerprint: 'B',
      resumeBridge: bridge,
      startHandshake: fakeHandshake,
    });
    gate.onInbound(JSON.stringify({ t: 'pair-nonce', nonce: 'n' }));
    await Promise.resolve();
    await Promise.resolve();
    fire('text_delta', 'a'); // seq 1
    fire('text_delta', 'b'); // seq 2
    sent.length = 0;
    // ack via the channel → bridge frees ≤1; resume lastSeq 1 → replays only seq 2.
    gate.onInbound(JSON.stringify({ type: 'ack', seq: 1 }));
    gate.onInbound(JSON.stringify({ type: 'resume', lastSeq: 1 }));
    expect(sent.map((s) => JSON.parse(s).seq)).toEqual([2]);
    bridge.dispose();
  });
});
