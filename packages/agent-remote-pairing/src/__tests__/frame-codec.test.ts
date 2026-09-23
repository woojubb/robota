import { describe, expect, it } from 'vitest';

import {
  PRE_AUTH_FRAME_LIMITS,
  decodeEnrollFrame,
  decodePairingFrame,
  decodeReconnectFrame,
} from '../frame-codec.js';
import { startPairingHandshake } from '../handshake.js';
import { startDeviceReconnect, startHostReconnect } from '../reconnect.js';

import type { TFrameDecodeResult } from '../frame-codec.js';

/**
 * Issue #2046 — the pre-auth frame corpus. Every entry passed the old discriminator-only carrier
 * predicates (`t` was right) and reached crypto/controller code with an empty, wrong-typed, malformed
 * or unbounded field. The owner codec rejects each one before any crypto work.
 */
const OK = 'QUJD';
const over = (limit: number): string => 'A'.repeat(limit + 1);

const MALFORMED: ReadonlyArray<[string, unknown, (value: unknown) => TFrameDecodeResult<unknown>]> =
  [
    ['null', null, decodePairingFrame],
    ['array', [{ t: 'pair-nonce', nonce: OK }], decodePairingFrame],
    ['pair-nonce without nonce', { t: 'pair-nonce' }, decodePairingFrame],
    ['pair-nonce with empty nonce', { t: 'pair-nonce', nonce: '' }, decodePairingFrame],
    ['pair-nonce with numeric nonce', { t: 'pair-nonce', nonce: 42 }, decodePairingFrame],
    ['pair-nonce with padded base64', { t: 'pair-nonce', nonce: 'QUJD==' }, decodePairingFrame],
    ['pair-nonce with base64 (+/)', { t: 'pair-nonce', nonce: 'QU+J/D' }, decodePairingFrame],
    [
      'pair-nonce over ceiling',
      { t: 'pair-nonce', nonce: over(PRE_AUTH_FRAME_LIMITS.nonce) },
      decodePairingFrame,
    ],
    ['pair-confirm with object mac', { t: 'pair-confirm', mac: {} }, decodePairingFrame],
    [
      'pair-confirm over ceiling',
      { t: 'pair-confirm', mac: over(PRE_AUTH_FRAME_LIMITS.mac) },
      decodePairingFrame,
    ],
    ['unknown pairing discriminator', { t: 'pair-xyz', nonce: OK }, decodePairingFrame],
    ['rc-hello without deviceId', { t: 'rc-hello', nonceDevice: OK }, decodeReconnectFrame],
    [
      'rc-hello with empty nonceDevice',
      { t: 'rc-hello', deviceId: OK, nonceDevice: '' },
      decodeReconnectFrame,
    ],
    [
      'rc-hello deviceId over ceiling',
      { t: 'rc-hello', deviceId: over(PRE_AUTH_FRAME_LIMITS.deviceId), nonceDevice: OK },
      decodeReconnectFrame,
    ],
    ['rc-host without sig', { t: 'rc-host', nonceHost: OK }, decodeReconnectFrame],
    [
      'rc-host with whitespace sig',
      { t: 'rc-host', nonceHost: OK, sig: 'ab cd' },
      decodeReconnectFrame,
    ],
    [
      'rc-host sig over ceiling',
      { t: 'rc-host', nonceHost: OK, sig: over(PRE_AUTH_FRAME_LIMITS.sig) },
      decodeReconnectFrame,
    ],
    ['rc-device with null sig', { t: 'rc-device', sig: null }, decodeReconnectFrame],
    ['enroll-key without spki', { t: 'enroll-key' }, decodeEnrollFrame],
    ['enroll-key with empty spki', { t: 'enroll-key', spki: '' }, decodeEnrollFrame],
    [
      'enroll-key spki over ceiling',
      { t: 'enroll-key', spki: over(PRE_AUTH_FRAME_LIMITS.spki) },
      decodeEnrollFrame,
    ],
    [
      'pairing frame handed to the reconnect decoder',
      { t: 'pair-nonce', nonce: OK },
      decodeReconnectFrame,
    ],
  ];

describe('pre-auth frame codec (issue #2046)', () => {
  it.each(MALFORMED)('rejects %s before any crypto work', (_label, value, decode) => {
    const result = decode(value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).not.toContain(over(0).repeat(2)); // reasons never echo values
  });

  it('decodes each well-formed variant to exactly its declared fields (extra keys dropped)', () => {
    expect(decodePairingFrame({ t: 'pair-nonce', nonce: OK, extra: 1 })).toEqual({
      ok: true,
      frame: { t: 'pair-nonce', nonce: OK },
    });
    expect(decodePairingFrame({ t: 'pair-confirm', mac: OK })).toEqual({
      ok: true,
      frame: { t: 'pair-confirm', mac: OK },
    });
    expect(decodeReconnectFrame({ t: 'rc-hello', deviceId: OK, nonceDevice: OK })).toEqual({
      ok: true,
      frame: { t: 'rc-hello', deviceId: OK, nonceDevice: OK },
    });
    expect(decodeReconnectFrame({ t: 'rc-host', nonceHost: OK, sig: OK })).toEqual({
      ok: true,
      frame: { t: 'rc-host', nonceHost: OK, sig: OK },
    });
    expect(decodeReconnectFrame({ t: 'rc-device', sig: OK })).toEqual({
      ok: true,
      frame: { t: 'rc-device', sig: OK },
    });
    expect(decodeEnrollFrame({ t: 'enroll-key', spki: OK })).toEqual({
      ok: true,
      frame: { t: 'enroll-key', spki: OK },
    });
  });

  it('accepts a value exactly at the ceiling', () => {
    const nonce = 'A'.repeat(PRE_AUTH_FRAME_LIMITS.nonce);
    expect(decodePairingFrame({ t: 'pair-nonce', nonce }).ok).toBe(true);
  });
});

describe('async frame transitions settle the result channel (issue #2046)', () => {
  it('a pairing handshake whose crypto rejects settles `result` instead of detaching', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      const controller = startPairingHandshake({
        secret: 'not-base64url!!', // fromBase64Url on this throws inside computeConfirmations
        role: 'initiator',
        localFingerprint: 'AA',
        remoteFingerprint: 'BB',
        send: () => {},
        timeoutMs: 5_000,
      });
      controller.onFrame({ t: 'pair-nonce', nonce: 'QUJD' });
      await expect(controller.result).rejects.toThrow(/pairing rejected/);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('a host reconnect whose resolver rejects settles `result` (no detached rejection)', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      const controller = startHostReconnect({
        hostIdentityId: 'h',
        localFingerprint: 'AA',
        remoteFingerprint: 'BB',
        hostPrivateKey: {} as CryptoKey,
        resolveDevicePublicKey: async () => {
          throw new Error('storage unavailable');
        },
        send: () => {},
        timeoutMs: 5_000,
      });
      controller.onFrame({ t: 'rc-hello', deviceId: 'QUJD', nonceDevice: 'QUJD' });
      await expect(controller.result).rejects.toThrow(/storage unavailable/);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('a device reconnect whose verify rejects settles `result` (no detached rejection)', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      const controller = startDeviceReconnect({
        deviceId: 'QUJD',
        hostIdentityId: 'h',
        localFingerprint: 'AA',
        remoteFingerprint: 'BB',
        devicePrivateKey: {} as CryptoKey,
        pinnedHostPublicKey: {} as CryptoKey, // verifyChallenge rejects on a non-key
        send: () => {},
        timeoutMs: 5_000,
      });
      controller.onFrame({ t: 'rc-host', nonceHost: 'QUJD', sig: 'QUJD' });
      await expect(controller.result).rejects.toThrow(/reconnect rejected/);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
