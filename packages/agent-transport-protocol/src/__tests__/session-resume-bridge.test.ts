import { describe, expect, it, vi } from 'vitest';

import { createWsHandler } from '../ws-handler.js';
import { SessionResumeBridge } from '../session-resume-bridge.js';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-transport';

/**
 * REMOTE-013 E4 TC-02 — the persistent SessionResumeBridge: a monotonic seq CONTINUOUS across a
 * detach/attach (channel drop), gap output captured while detached and replayed on `resume`, `ack` freeing the
 * buffer, and — the regression guard — the WS `createWsHandler` path stamping NO seq.
 */

function fakeSession(): {
  session: IInteractiveSession;
  fire: (event: string, arg: unknown) => void;
} {
  const handlers = new Map<string, (arg: unknown) => void>();
  const session = {
    on: (event: string, handler: (arg: unknown) => void) => handlers.set(event, handler),
    off: (event: string) => handlers.delete(event),
    getMessages: () => [],
    getContextState: () => ({}),
    isExecuting: () => false,
    getPendingPrompt: () => null,
  } as unknown as IInteractiveSession;
  return { session, fire: (event, arg) => handlers.get(event)?.(arg) };
}

function frames(sink: { calls: string[] }): { type: string; seq?: number; delta?: string }[] {
  return sink.calls.map((c) => JSON.parse(c));
}

function sink(): TResumeSinkStub {
  const calls: string[] = [];
  return Object.assign((data: string) => void calls.push(data), { calls });
}
type TResumeSinkStub = ((data: string) => void) & { calls: string[] };

describe('SessionResumeBridge (REMOTE-013 TC-02)', () => {
  it('stamps a monotonic seq and forwards live to the attached sink', () => {
    const { session, fire } = fakeSession();
    const bridge = new SessionResumeBridge({ session });
    const s = sink();
    bridge.attach(s);
    fire('text_delta', 'a');
    fire('text_delta', 'b');
    expect(frames(s).map((f) => f.seq)).toEqual([1, 2]);
    expect(frames(s).map((f) => f.delta)).toEqual(['a', 'b']);
    bridge.dispose();
  });

  it('the Issue-A guard: seq is CONTINUOUS across detach/attach; gap output is captured + replayed on resume', () => {
    const { session, fire } = fakeSession();
    const bridge = new SessionResumeBridge({ session });

    const s1 = sink();
    bridge.attach(s1);
    fire('text_delta', 'a'); // seq 1 → s1
    expect(frames(s1).map((f) => f.seq)).toEqual([1]);

    // Channel drops.
    bridge.detach();
    fire('text_delta', 'b'); // seq 2 — buffered, NOT sent (no sink)
    fire('text_delta', 'c'); // seq 3 — buffered
    expect(s1.calls).toHaveLength(1); // s1 got nothing during the gap

    // New channel after reconnect. The client last applied seq 1 → asks for the tail.
    const s2 = sink();
    bridge.attach(s2);
    expect(s2.calls).toHaveLength(0); // attach does NOT auto-replay
    bridge.onClientMessage(JSON.stringify({ type: 'resume', lastSeq: 1 }));

    const replayed = frames(s2);
    // seq did NOT reset to 1 on the new channel — the gap frames keep their original 2,3.
    expect(replayed.map((f) => f.seq)).toEqual([2, 3]);
    expect(replayed.map((f) => f.delta)).toEqual(['b', 'c']);
    bridge.dispose();
  });

  it('reconnect hold (Issue-B): a LIVE frame emitted between attach and resume does not leapfrog the gap', () => {
    const { session, fire } = fakeSession();
    const bridge = new SessionResumeBridge({ session });
    const s1 = sink();
    bridge.attach(s1);
    fire('text_delta', 'a'); // seq 1 → client applies through 1

    // Drop; gap frames buffered.
    bridge.detach();
    fire('text_delta', 'b'); // seq 2 (gap)
    fire('text_delta', 'c'); // seq 3 (gap)

    // Reconnect attach with awaitResume → live forwarding is HELD until resume flushes the tail.
    const s2 = sink();
    bridge.attach(s2, { awaitResume: true });
    fire('text_delta', 'd'); // seq 4 — emitted BEFORE the client's resume arrives; must NOT be sent yet
    expect(s2.calls).toHaveLength(0); // held

    bridge.onClientMessage(JSON.stringify({ type: 'resume', lastSeq: 1 }));
    // The client receives 2,3,4 IN ORDER (gap then the held live frame) — none lost, none reordered.
    expect(frames(s2).map((f) => f.seq)).toEqual([2, 3, 4]);
    expect(frames(s2).map((f) => f.delta)).toEqual(['b', 'c', 'd']);

    // Hold released — a subsequent live frame flows immediately behind the flushed tail.
    fire('text_delta', 'e'); // seq 5
    expect(frames(s2).map((f) => f.seq)).toEqual([2, 3, 4, 5]);
    bridge.dispose();
  });

  it('ack frees the buffer up to seq; a later resume replays only the newer tail', () => {
    const { session, fire } = fakeSession();
    const bridge = new SessionResumeBridge({ session });
    const s = sink();
    bridge.attach(s);
    fire('text_delta', 'a'); // 1
    fire('text_delta', 'b'); // 2
    fire('text_delta', 'c'); // 3
    bridge.onClientMessage(JSON.stringify({ type: 'ack', seq: 2 })); // free 1,2

    const s2 = sink();
    bridge.detach();
    bridge.attach(s2);
    bridge.onClientMessage(JSON.stringify({ type: 'resume', lastSeq: 2 }));
    expect(frames(s2).map((f) => f.seq)).toEqual([3]); // only the un-acked tail
    bridge.dispose();
  });

  it('resume with a lastSeq older than the retained buffer sends resume_gap (no silent gap)', () => {
    const { session, fire } = fakeSession();
    const bridge = new SessionResumeBridge({ session, buffer: { maxFrames: 2 } });
    const s = sink();
    bridge.attach(s);
    fire('text_delta', 'a'); // 1 (evicted)
    fire('text_delta', 'b'); // 2
    fire('text_delta', 'c'); // 3 → buffer holds [2,3]
    const s2 = sink();
    bridge.detach();
    bridge.attach(s2);
    bridge.onClientMessage(JSON.stringify({ type: 'resume', lastSeq: 0 })); // saw nothing, 1 is gone
    expect(frames(s2)).toEqual([{ type: 'resume_gap' }]);
    bridge.dispose();
  });

  it('regression: the WS createWsHandler path stamps NO seq', () => {
    const { session, fire } = fakeSession();
    const sent: unknown[] = [];
    const { cleanup } = createWsHandler({ session, send: (m) => sent.push(m) });
    fire('text_delta', 'a');
    expect(sent).toEqual([{ type: 'text_delta', delta: 'a' }]); // no `seq` field
    cleanup();
  });
});
