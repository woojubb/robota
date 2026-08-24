/**
 * ARCH-030 / issue #1734 — the replay path's backpressure budget REACHES production.
 *
 * `IAttachOptions.pendingBytes` existed with zero production callers: the bridge could take a
 * carrier's backpressure reading and nothing gave it one, so the replay burst — the case the
 * reopened scope names — ran unbudgeted while every other outbound path on the same connection was
 * guarded.
 *
 * This case asserts the BEHAVIOUR, not the wiring. A test that checked the option reaches
 * `bridge.attach` would have passed on the day the defect existed, because the option was reaching
 * nothing on the way in. What can fail is a peer over budget going unclosed.
 */
import {
  DEFAULT_MAX_PENDING_BYTES,
  SessionResumeBridge,
} from '@robota-sdk/agent-transport-protocol';
import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';
import { describe, expect, it } from 'vitest';

import { attachSession } from '../session-attachment.js';

import type { IPairingChannel } from '../pairing-gate-options.js';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';

function fakeSession(): {
  session: IInteractiveSession;
  fire: (event: string, arg: unknown) => void;
} {
  const handlers = new Map<string, (arg: unknown) => void>();
  const session = createTestInteractiveSession({
    on: ((event: string, handler: (arg: unknown) => void) =>
      handlers.set(event, handler)) as IInteractiveSession['on'],
    off: ((event: string) => {
      handlers.delete(event);
    }) as IInteractiveSession['off'],
  });
  return { session, fire: (event, arg) => handlers.get(event)?.(arg) };
}

/** A channel whose backpressure the case controls, matching the optional structural slice. */
function channelHolding(bytes: () => number): IPairingChannel & { sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    send: (data: string) => void sent.push(data),
    close: () => undefined,
    get bufferedAmount(): number {
      return bytes();
    },
  };
}

describe('attachSession + the replay budget (ARCH-030)', () => {
  it('closes a peer that is over budget when the replay burst is attempted', () => {
    const { session, fire } = fakeSession();
    const bridge = new SessionResumeBridge({ session });
    for (const delta of ['a', 'b', 'c']) fire('text_delta', delta);

    let pending = 0;
    const channel = channelHolding(() => pending);
    const failures: string[] = [];
    const attached = attachSession({ channel, session, resumeBridge: bridge }, true, (error) =>
      failures.push(error.message),
    );

    // The peer has accepted a backlog it is not reading.
    pending = DEFAULT_MAX_PENDING_BYTES + 1;
    attached.onSessionMessage(JSON.stringify({ type: 'resume', lastSeq: 0 }));

    expect(channel.sent).toHaveLength(0);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('pending');
    attached.cleanup();
    bridge.dispose();
  });

  it('replays normally while the peer is reading', () => {
    // The companion the case above needs: without it, a budget that refused everything would pass.
    const { session, fire } = fakeSession();
    const bridge = new SessionResumeBridge({ session });
    for (const delta of ['a', 'b', 'c']) fire('text_delta', delta);

    const channel = channelHolding(() => 0);
    const failures: string[] = [];
    const attached = attachSession({ channel, session, resumeBridge: bridge }, true, (error) =>
      failures.push(error.message),
    );
    attached.onSessionMessage(JSON.stringify({ type: 'resume', lastSeq: 0 }));

    expect(channel.sent).toHaveLength(3);
    expect(failures).toHaveLength(0);
    attached.cleanup();
    bridge.dispose();
  });
});
