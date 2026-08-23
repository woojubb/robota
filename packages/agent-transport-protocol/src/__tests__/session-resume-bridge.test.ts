import { describe, expect, it, vi } from 'vitest';

import { createOutboundDelivery } from '../outbound-delivery.js';
import { createWsHandler } from '../ws-handler.js';
import { SessionResumeBridge } from '../session-resume-bridge.js';
import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';

import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';

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
  // ARCH-012: the published conformant double, overridden where this case needs behaviour. The
  // hand-rolled partial it replaces was `as unknown as IInteractiveSession` — a cast that hid four
  // missing members, so this suite proved things the real contract does not permit.
  const session = createTestInteractiveSession({
    on: ((event: string, handler: (arg: unknown) => void) =>
      handlers.set(event, handler)) as IInteractiveSession['on'],
    off: ((event: string) => {
      handlers.delete(event);
    }) as IInteractiveSession['off'],
  });
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
const TEST_ATTACH_OPTIONS = { onDeliveryError: vi.fn() };

describe('SessionResumeBridge (REMOTE-013 TC-02)', () => {
  it('stamps a monotonic seq and forwards live to the attached sink', () => {
    const { session, fire } = fakeSession();
    const bridge = new SessionResumeBridge({ session });
    const s = sink();
    bridge.attach(s, TEST_ATTACH_OPTIONS);
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
    bridge.attach(s1, TEST_ATTACH_OPTIONS);
    fire('text_delta', 'a'); // seq 1 → s1
    expect(frames(s1).map((f) => f.seq)).toEqual([1]);

    // Channel drops.
    bridge.detach();
    fire('text_delta', 'b'); // seq 2 — buffered, NOT sent (no sink)
    fire('text_delta', 'c'); // seq 3 — buffered
    expect(s1.calls).toHaveLength(1); // s1 got nothing during the gap

    // New channel after reconnect. The client last applied seq 1 → asks for the tail.
    const s2 = sink();
    bridge.attach(s2, TEST_ATTACH_OPTIONS);
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
    bridge.attach(s1, TEST_ATTACH_OPTIONS);
    fire('text_delta', 'a'); // seq 1 → client applies through 1

    // Drop; gap frames buffered.
    bridge.detach();
    fire('text_delta', 'b'); // seq 2 (gap)
    fire('text_delta', 'c'); // seq 3 (gap)

    // Reconnect attach with awaitResume → live forwarding is HELD until resume flushes the tail.
    const s2 = sink();
    bridge.attach(s2, { ...TEST_ATTACH_OPTIONS, awaitResume: true });
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
    bridge.attach(s, TEST_ATTACH_OPTIONS);
    fire('text_delta', 'a'); // 1
    fire('text_delta', 'b'); // 2
    fire('text_delta', 'c'); // 3
    bridge.onClientMessage(JSON.stringify({ type: 'ack', seq: 2 })); // free 1,2

    const s2 = sink();
    bridge.detach();
    bridge.attach(s2, TEST_ATTACH_OPTIONS);
    bridge.onClientMessage(JSON.stringify({ type: 'resume', lastSeq: 2 }));
    expect(frames(s2).map((f) => f.seq)).toEqual([3]); // only the un-acked tail
    bridge.dispose();
  });

  it('resume with a lastSeq older than the retained buffer sends resume_gap (no silent gap)', () => {
    const { session, fire } = fakeSession();
    const bridge = new SessionResumeBridge({ session, buffer: { maxFrames: 2 } });
    const s = sink();
    bridge.attach(s, TEST_ATTACH_OPTIONS);
    fire('text_delta', 'a'); // 1 (evicted)
    fire('text_delta', 'b'); // 2
    fire('text_delta', 'c'); // 3 → buffer holds [2,3]
    const s2 = sink();
    bridge.detach();
    bridge.attach(s2, TEST_ATTACH_OPTIONS);
    bridge.onClientMessage(JSON.stringify({ type: 'resume', lastSeq: 0 })); // saw nothing, 1 is gone
    expect(frames(s2)).toEqual([{ type: 'resume_gap' }]);
    bridge.dispose();
  });

  // CMD-004 Stage D — the bridge's single subscription requester-routes `ui_intent` with the
  // LATE-BOUND driver id (`setDriverId` binds after pairing), so a skipped intent is never
  // buffered and can never leak to this surface through a later `resume` replay.
  it('requester-routes ui_intent by the late-bound driver id; foreign intents are never buffered', () => {
    const { session, fire } = fakeSession();
    const bridge = new SessionResumeBridge({ session });
    const s = sink();
    bridge.attach(s, TEST_ATTACH_OPTIONS);

    // Not paired yet (no driver id): an intent attributed to another surface is skipped.
    fire('ui_intent', { intent: { type: 'show-settings' }, requesterDriverId: 'device-9' });
    expect(s.calls).toHaveLength(0);

    bridge.setDriverId('device-9');
    fire('ui_intent', { intent: { type: 'show-settings' }, requesterDriverId: 'device-9' });
    expect(frames(s)).toEqual([
      {
        type: 'ui_intent',
        event: { intent: { type: 'show-settings' }, requesterDriverId: 'device-9' },
        seq: 1, // the skipped foreign intent consumed NO seq — it was routed out BEFORE buffering
      },
    ]);

    // Another surface's intent stays invisible even across a reconnect replay.
    fire('ui_intent', { intent: { type: 'show-plugin-manager' }, requesterDriverId: 'device-2' });
    const s2 = sink();
    bridge.detach();
    bridge.attach(s2, TEST_ATTACH_OPTIONS);
    bridge.onClientMessage(JSON.stringify({ type: 'resume', lastSeq: 0 }));
    expect(frames(s2).filter((f) => f.type === 'ui_intent')).toHaveLength(1); // only device-9's own

    // Unattributed intents are unroutable → delivered (never silently dropped).
    fire('ui_intent', { intent: { type: 'show-agent-switcher' } });
    expect(frames(s2).at(-1)).toEqual({
      type: 'ui_intent',
      event: { intent: { type: 'show-agent-switcher' } },
      seq: 2, // the device-2 intent consumed no seq either — routing precedes the buffer
    });
    bridge.dispose();
  });

  it('regression: the WS createWsHandler path stamps NO seq', () => {
    const { session, fire } = fakeSession();
    const sent: unknown[] = [];
    const { cleanup } = createWsHandler({
      session,
      deliver: createOutboundDelivery((m) => sent.push(m), vi.fn()),
    });
    fire('text_delta', 'a');
    expect(sent).toEqual([{ type: 'text_delta', delta: 'a' }]); // no `seq` field
    cleanup();
  });

  it('reports a WebRTC sink failure and detaches instead of swallowing it', () => {
    const { session, fire } = fakeSession();
    const failures: Array<{ message: string; event: string }> = [];
    const bridge = new SessionResumeBridge({ session });
    bridge.attach(
      () => {
        throw new Error('data channel closed');
      },
      {
        onDeliveryError: (error, event) => {
          failures.push({ message: error.message, event });
          throw new Error('diagnostic callback failed');
        },
      },
    );

    fire('branch_event', {
      kind: 'checkpoint_created',
      checkpointId: 'turn-0001',
      branchId: 'main',
    });

    expect(failures).toEqual([{ message: 'data channel closed', event: 'branch_event' }]);
    expect(bridge.lastSeq).toBe(1); // retained for replay after the carrier reconnects
    bridge.dispose();
  });

  // ARCH-030: the bridge's own string-level try/catch is gone; its only guard is the per-attachment
  // outbound boundary. These three pin the semantics that used to be side effects of `detach()`.
  describe('the attachment boundary (ARCH-030)', () => {
    it('reports ONCE across a failing multi-frame replay, and the dropped frames survive', () => {
      const { session, fire } = fakeSession();
      const failures: Array<{ message: string; event: string }> = [];
      const bridge = new SessionResumeBridge({ session });

      // Three frames buffered while no channel is attached — the reconnect gap.
      fire('text_delta', 'a');
      fire('text_delta', 'b');
      fire('text_delta', 'c');
      expect(bridge.lastSeq).toBe(3);

      bridge.attach(
        () => {
          throw new Error('data channel closed');
        },
        {
          awaitResume: true,
          onDeliveryError: (error, event) => failures.push({ message: error.message, event }),
        },
      );
      bridge.onClientMessage(JSON.stringify({ type: 'resume', lastSeq: 0 }));

      // One report for the whole tail. Before the boundary this was one only because
      // `reportDeliveryError` happened to `detach()` mid-loop; now it is the stated contract.
      expect(failures).toEqual([{ message: 'data channel closed', event: 'text_delta' }]);

      // Nothing was acked, so every frame is still replayable on the NEXT sink.
      const healthy = sink();
      bridge.attach(healthy, { awaitResume: true, onDeliveryError: vi.fn() });
      bridge.onClientMessage(JSON.stringify({ type: 'resume', lastSeq: 0 }));
      expect(frames(healthy).map((f) => f.seq)).toEqual([1, 2, 3]);
      expect(frames(healthy).map((f) => f.delta)).toEqual(['a', 'b', 'c']);
      bridge.dispose();
    });

    it('a fresh attach un-latches the connection, and seq stays continuous across the failure', () => {
      const { session, fire } = fakeSession();
      const bridge = new SessionResumeBridge({ session });
      bridge.attach(
        () => {
          throw new Error('data channel closed');
        },
        { onDeliveryError: vi.fn() },
      );
      fire('text_delta', 'a');

      const second = sink();
      const secondFailures: string[] = [];
      bridge.attach(second, { onDeliveryError: (error) => secondFailures.push(error.message) });
      fire('text_delta', 'b');

      // The new attachment delivers: a latched boundary is not carried across `attach`.
      expect(frames(second).map((f) => f.seq)).toEqual([2]);
      expect(secondFailures).toEqual([]);
      expect(bridge.lastSeq).toBe(2); // the failed frame still consumed its seq
      bridge.dispose();
    });

    it('routes a reply to an inbound frame through the same boundary as the event fan-out', () => {
      const handlers = new Map<string, (arg: unknown) => void>();
      const session = createTestInteractiveSession({
        on: ((event: string, handler: (arg: unknown) => void) =>
          handlers.set(event, handler)) as IInteractiveSession['on'],
        off: ((event: string) => {
          handlers.delete(event);
        }) as IInteractiveSession['off'],
      });
      const failures: Array<{ message: string; event: string }> = [];
      const bridge = new SessionResumeBridge({ session });
      bridge.attach(
        () => {
          throw new Error('data channel closed');
        },
        { onDeliveryError: (error, event) => failures.push({ message: error.message, event }) },
      );

      // A synchronous query reply — before ARCH-030 the bridge guarded this at the string level, and
      // the handler path next to it did not guard it at all.
      expect(() => bridge.onClientMessage(JSON.stringify({ type: 'get-executing' }))).not.toThrow();
      expect(failures).toEqual([{ message: 'data channel closed', event: 'executing' }]);
      bridge.dispose();
    });
  });
});
