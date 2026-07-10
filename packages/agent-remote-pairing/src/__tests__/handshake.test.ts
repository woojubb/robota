import { describe, expect, it } from 'vitest';

import { generatePairingSecret } from '../pairing.js';
import { startPairingHandshake, type TPairingFrame } from '../handshake.js';

const FP_A = 'AA:AA:AA:AA:AA:AA:AA:AA';
const FP_B = 'BB:BB:BB:BB:BB:BB:BB:BB';
const FP_M = 'CC:CC:CC:CC:CC:CC:CC:CC';

/**
 * Wire two handshake controllers together through a `relay` function that may tamper with frames — models the
 * data-channel carrying the pairing frames through a (possibly malicious) path.
 */
function pair(
  secret: { a: string; b: string },
  fingerprints: { aLocal: string; aRemote: string; bLocal: string; bRemote: string },
  relay: (
    from: 'a' | 'b',
    frame: TPairingFrame,
  ) => { to: 'a' | 'b'; frame: TPairingFrame } | null = (from, frame) => ({
    to: from === 'a' ? 'b' : 'a',
    frame,
  }),
) {
  const controllers: {
    a?: ReturnType<typeof startPairingHandshake>;
    b?: ReturnType<typeof startPairingHandshake>;
  } = {};
  const deliver = (from: 'a' | 'b', frame: TPairingFrame): void => {
    const routed = relay(from, frame);
    if (!routed) return;
    // deliver asynchronously to mimic the channel
    queueMicrotask(() => controllers[routed.to]?.onFrame(routed.frame));
  };
  controllers.a = startPairingHandshake({
    secret: secret.a,
    role: 'initiator',
    localFingerprint: fingerprints.aLocal,
    remoteFingerprint: fingerprints.aRemote,
    send: (frame) => deliver('a', frame),
    timeoutMs: 2000,
  });
  controllers.b = startPairingHandshake({
    secret: secret.b,
    role: 'responder',
    localFingerprint: fingerprints.bLocal,
    remoteFingerprint: fingerprints.bRemote,
    send: (frame) => deliver('b', frame),
    timeoutMs: 2000,
  });
  return controllers as {
    a: ReturnType<typeof startPairingHandshake>;
    b: ReturnType<typeof startPairingHandshake>;
  };
}

describe('pairing handshake (REMOTE-005 B3)', () => {
  it('accepts and derives a session key when both peers share the secret and observe the same channel', async () => {
    const secret = generatePairingSecret().secret;
    const { a, b } = pair(
      { a: secret, b: secret },
      { aLocal: FP_A, aRemote: FP_B, bLocal: FP_B, bRemote: FP_A },
    );
    const [ra, rb] = await Promise.all([a.result, b.result]);
    expect(ra.sessionKey).toBe(rb.sessionKey);
    expect(ra.sessionKey.length).toBeGreaterThan(0);
  });

  it('rejects a fingerprint-substitution MITM (each side observes the relay fingerprint)', async () => {
    const secret = generatePairingSecret().secret;
    const { a, b } = pair(
      { a: secret, b: secret },
      { aLocal: FP_A, aRemote: FP_M, bLocal: FP_B, bRemote: FP_M },
    );
    await expect(a.result).rejects.toThrow(/channel-confirmation mismatch/);
    await expect(b.result).rejects.toThrow(/channel-confirmation mismatch/);
  });

  it('rejects a reflection relay that echoes each peer its own frames (no secret)', async () => {
    const secret = generatePairingSecret().secret;
    // Relay reflects every frame back to its sender instead of forwarding to the counterpart.
    const { a, b } = pair(
      { a: secret, b: secret },
      { aLocal: FP_A, aRemote: FP_B, bLocal: FP_B, bRemote: FP_A },
      (from, frame) => ({ to: from, frame }),
    );
    await expect(a.result).rejects.toThrow();
    await expect(b.result).rejects.toThrow();
  });

  it('rejects when the peers hold different secrets', async () => {
    const { a, b } = pair(
      { a: generatePairingSecret().secret, b: generatePairingSecret().secret },
      { aLocal: FP_A, aRemote: FP_B, bLocal: FP_B, bRemote: FP_A },
    );
    await expect(a.result).rejects.toThrow(/mismatch/);
    await expect(b.result).rejects.toThrow(/mismatch/);
  });

  it('times out (fail closed) when the counterpart never responds', async () => {
    const secret = generatePairingSecret().secret;
    const a = startPairingHandshake({
      secret,
      role: 'initiator',
      localFingerprint: FP_A,
      remoteFingerprint: FP_B,
      send: () => {}, // drop everything → no counterpart
      timeoutMs: 100,
    });
    await expect(a.result).rejects.toThrow(/timed out/);
  });
});
