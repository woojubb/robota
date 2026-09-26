import { describe, expect, it } from 'vitest';

import {
  EnrollmentLinkError,
  dialEnrollment,
  listenForEnrollment,
  type IEnrollmentChannel,
} from '../enrollment-link.js';
import { createInMemoryMeshRelayHub } from '../mesh-relay.js';

const EXISTING = 'e'.repeat(43);
const JOINER = 'j'.repeat(43);

function nextFrame(channel: IEnrollmentChannel): Promise<unknown> {
  return new Promise((resolve) => {
    const stop = channel.onFrame((frame) => {
      stop();
      resolve(frame);
    });
  });
}

describe('enrollment link — a data channel bound to the negotiated connection', () => {
  it('connects dialer and listener through the relay; each names the other by its verified certificate', async () => {
    const hub = createInMemoryMeshRelayHub();
    const listenerRelay = hub.connect();
    const dialerRelay = hub.connect();
    const accepted: IEnrollmentChannel[] = [];
    const listener = listenForEnrollment({
      relay: listenerRelay,
      inbound: EXISTING,
      outbound: JOINER,
      onChannel: (channel) => accepted.push(channel),
    });
    try {
      const dialed = await dialEnrollment({
        relay: dialerRelay,
        inbound: JOINER,
        outbound: EXISTING,
        connectTimeoutMs: 10_000,
      });
      await expect.poll(() => accepted.length, { timeout: 10_000 }).toBe(1);
      const existing = accepted[0]!;
      expect(dialed.remoteFingerprint).toBe(existing.localFingerprint);
      expect(existing.remoteFingerprint).toBe(dialed.localFingerprint);
      expect(dialed.localFingerprint).not.toBe(existing.localFingerprint);

      const arrived = nextFrame(existing);
      dialed.send({ t: 'hello' });
      expect(await arrived).toEqual({ t: 'hello' });
      const closed = new Promise<void>((resolve) => existing.onClose(resolve));
      dialed.close();
      await closed;
    } finally {
      listener.close();
      listenerRelay.close();
      dialerRelay.close();
    }
  });

  it('refuses at once when nobody waits at the topic', async () => {
    const hub = createInMemoryMeshRelayHub();
    const relay = hub.connect();
    try {
      const error = await dialEnrollment({ relay, inbound: JOINER, outbound: EXISTING }).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(EnrollmentLinkError);
      expect((error as EnrollmentLinkError).reason).toBe('absent');
    } finally {
      relay.close();
    }
  });

  it('serves one attempt at a time: a second dialer is not taken while the first channel is open', async () => {
    const hub = createInMemoryMeshRelayHub();
    const listenerRelay = hub.connect();
    const first = hub.connect();
    const second = hub.connect();
    const accepted: IEnrollmentChannel[] = [];
    const listener = listenForEnrollment({
      relay: listenerRelay,
      inbound: EXISTING,
      outbound: JOINER,
      onChannel: (channel) => accepted.push(channel),
    });
    try {
      const one = await dialEnrollment({ relay: first, inbound: JOINER, outbound: EXISTING });
      const other = await dialEnrollment({
        relay: second,
        inbound: JOINER,
        outbound: EXISTING,
        connectTimeoutMs: 1_500,
      }).catch((e: unknown) => e);
      expect((other as EnrollmentLinkError).reason).toBe('timeout');
      expect(accepted).toHaveLength(1);
      one.close();
    } finally {
      listener.close();
      for (const relay of [listenerRelay, first, second]) relay.close();
    }
  });
});
