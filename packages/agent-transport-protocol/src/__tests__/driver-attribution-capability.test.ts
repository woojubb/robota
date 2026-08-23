import { describe, expect, it, vi } from 'vitest';

import { createOutboundDelivery } from '../outbound-delivery.js';
import { subscribeSessionEvents } from '../ws-session-events.js';

import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';

import type { IInteractiveSession, TDriverId } from '@robota-sdk/agent-interface-session';

/**
 * ARCH-012 — the sharp edge of an optional contract member.
 *
 * `IInteractiveSession` declared `getActiveDriverId?()`, and the one consumer read it as
 * `session.getActiveDriverId?.() ?? undefined`. Two entirely different situations arrived as the same
 * `undefined`:
 *
 * - the host DOES attribute turns and no driver is active right now, and
 * - the host does not implement attribution at all.
 *
 * The second silently loses every co-drive attribution, with no error, no log, and nothing a reader
 * or a test could use to tell it from the first. The shipped `InteractiveSession` happens to
 * implement all three optional members, so the defect was latent for it and live for the 51 casts
 * that stand in for other implementations.
 *
 * The fix is not a better fallback. It is removing the optionality: a host either provides the
 * capability or does not claim the contract. These cases pin that the member is REQUIRED, which is
 * what makes "no active driver" the only thing `null` can mean.
 */
function hostWithAttribution(driverId: TDriverId | null): IInteractiveSession {
  // The conformant double, not another hand-rolled partial — the cast ratchet objected to the first
  // draft of this very file, which is the behaviour it exists for.
  return createTestInteractiveSession({
    getActiveDriverId: () => driverId,
    on: vi.fn(),
    off: vi.fn(),
  });
}

describe('driver attribution is a declared capability, not an optional call (ARCH-012)', () => {
  it('TYPE-LEVEL: a host that omits the attribution members does not satisfy the contract', () => {
    // Judged by `pnpm typecheck`, not by this assertion — `@ts-expect-error` fails the BUILD when the
    // error it expects does not occur.
    //
    // `Omit` rather than a hand-written object literal, deliberately. A literal missing the three
    // members is also missing the forty required ones, so `@ts-expect-error` would be satisfied by
    // the wrong error and the case would pass whether or not the optionality was ever removed. That
    // is precisely the accidental-green shape; the first draft of this test had it. This type carries
    // every other member and differs ONLY in the three.
    type OmitsAttribution = Omit<
      IInteractiveSession,
      'getActiveDriverId' | 'getPendingCount' | 'isInitialized'
    >;
    const host = {} as OmitsAttribution;
    // @ts-expect-error ARCH-012: the three are REQUIRED. If this ever compiles again the optionality
    // is back, and `undefined` means both "no active driver" and "cannot answer" once more.
    const asSession: IInteractiveSession = host;
    expect(asSession).toBeDefined();
  });

  it('stamps the active driver onto a turn-authored event', () => {
    const send = vi.fn();
    const session = hostWithAttribution('driver-7');
    subscribeSessionEvents(session, createOutboundDelivery(send, vi.fn()));

    const handler = vi.mocked(session.on).mock.calls.find(([name]) => name === 'user_message')?.[1];
    (handler as (content: string) => void)('hello');

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ driverId: 'driver-7' }));
  });

  it('omits the driver when the host attributes turns and none is active', () => {
    // `null` now means exactly one thing: nobody is driving. It used to be indistinguishable from
    // "this host cannot answer the question".
    const send = vi.fn();
    const session = hostWithAttribution(null);
    subscribeSessionEvents(session, createOutboundDelivery(send, vi.fn()));

    const handler = vi.mocked(session.on).mock.calls.find(([name]) => name === 'user_message')?.[1];
    (handler as (content: string) => void)('hello');

    expect(send).toHaveBeenCalledWith(expect.not.objectContaining({ driverId: expect.anything() }));
  });
});
