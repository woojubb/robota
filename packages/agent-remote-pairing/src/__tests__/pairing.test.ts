import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  computeConfirmations,
  deriveSessionKey,
  extractDtlsFingerprint,
  generateNonce,
  generatePairingSecret,
  parsePairingUrl,
  toPairingUrl,
  verifyPeerConfirmation,
  type IConfirmationInput,
} from '../pairing.js';

const FP_A = 'AA:AA:AA:AA:AA:AA:AA:AA';
const FP_B = 'BB:BB:BB:BB:BB:BB:BB:BB';
const FP_M = 'CC:CC:CC:CC:CC:CC:CC:CC'; // a MITM relay's fingerprint

/** Run the two-sided confirmation exchange and return whether each honest peer accepts the other's confirmation. */
async function exchange(
  a: IConfirmationInput,
  b: IConfirmationInput,
): Promise<{ aAccepts: boolean; bAccepts: boolean }> {
  const aOut = await computeConfirmations(a);
  const bOut = await computeConfirmations(b);
  return {
    aAccepts: await verifyPeerConfirmation(aOut.expectPeer, bOut.send),
    bAccepts: await verifyPeerConfirmation(bOut.expectPeer, aOut.send),
  };
}

describe('pairing crypto (REMOTE-005 B3)', () => {
  it('TC-01: generatePairingSecret yields distinct high-entropy secret + rendezvous', () => {
    const p1 = generatePairingSecret();
    const p2 = generatePairingSecret();
    expect(p1.secret).not.toBe(p2.secret);
    expect(p1.rendezvous).not.toBe(p1.secret);
    // 256-bit base64url ≈ 43 chars; assert comfortably ≥128-bit of material.
    expect(p1.secret.length).toBeGreaterThanOrEqual(40);
  });

  it('TC-02: pairing URL round-trips with the secret in the fragment (never in path/query)', () => {
    const pairing = generatePairingSecret();
    const url = toPairingUrl('https://remote.example/app', pairing);
    const parsed = new URL(url);
    expect(parsed.hash).toContain(pairing.secret);
    expect(parsed.pathname + parsed.search).not.toContain(pairing.secret); // never sent to the server
    expect(parsePairingUrl(url)).toEqual(pairing);
  });

  it('TC-03: extractDtlsFingerprint reads a=fingerprint from a real werift SDP fixture', () => {
    const sdp = readFileSync(join(__dirname, 'fixtures', 'werift-offer.sdp'), 'utf8');
    const fp = extractDtlsFingerprint(sdp);
    expect(fp).toMatch(/^[0-9A-F:]+$/);
    expect(fp.length).toBeGreaterThan(40);
  });

  it('TC-04: no-MITM — matching fingerprints → both peers accept the counter-direction confirmation', async () => {
    const secret = generatePairingSecret().secret;
    const nI = generateNonce();
    const nR = generateNonce();
    const { aAccepts, bAccepts } = await exchange(
      {
        secret,
        role: 'initiator',
        nonceInitiator: nI,
        nonceResponder: nR,
        localFingerprint: FP_A,
        remoteFingerprint: FP_B,
      },
      {
        secret,
        role: 'responder',
        nonceInitiator: nI,
        nonceResponder: nR,
        localFingerprint: FP_B,
        remoteFingerprint: FP_A,
      },
    );
    expect(aAccepts).toBe(true);
    expect(bAccepts).toBe(true);
  });

  it('TC-05: fingerprint-substitution MITM — each side sees the relay fingerprint → reject', async () => {
    const secret = generatePairingSecret().secret;
    const nI = generateNonce();
    const nR = generateNonce();
    const { aAccepts, bAccepts } = await exchange(
      {
        secret,
        role: 'initiator',
        nonceInitiator: nI,
        nonceResponder: nR,
        localFingerprint: FP_A,
        remoteFingerprint: FP_M,
      },
      {
        secret,
        role: 'responder',
        nonceInitiator: nI,
        nonceResponder: nR,
        localFingerprint: FP_B,
        remoteFingerprint: FP_M,
      },
    );
    expect(aAccepts).toBe(false);
    expect(bAccepts).toBe(false);
  });

  it('TC-06: reflection adversary — echoing a peer its OWN confirmation is rejected (directional labels)', async () => {
    const secret = generatePairingSecret().secret;
    const nI = generateNonce();
    const nR = generateNonce();
    const a = await computeConfirmations({
      secret,
      role: 'initiator',
      nonceInitiator: nI,
      nonceResponder: nR,
      localFingerprint: FP_A,
      remoteFingerprint: FP_B,
    });
    // A secretless relay reflects A's own confirmation back to A. A expects the RESPONDER-labelled value.
    expect(await verifyPeerConfirmation(a.expectPeer, a.send)).toBe(false);
  });

  it('TC-07: wrong secret → different key → reject', async () => {
    const nI = generateNonce();
    const nR = generateNonce();
    const { aAccepts } = await exchange(
      {
        secret: generatePairingSecret().secret,
        role: 'initiator',
        nonceInitiator: nI,
        nonceResponder: nR,
        localFingerprint: FP_A,
        remoteFingerprint: FP_B,
      },
      {
        secret: generatePairingSecret().secret,
        role: 'responder',
        nonceInitiator: nI,
        nonceResponder: nR,
        localFingerprint: FP_B,
        remoteFingerprint: FP_A,
      },
    );
    expect(aAccepts).toBe(false);
  });

  it('TC-08: replay — a confirmation from one handshake fails under a fresh nonce set', async () => {
    const secret = generatePairingSecret().secret;
    const b1 = await computeConfirmations({
      secret,
      role: 'responder',
      nonceInitiator: generateNonce(),
      nonceResponder: generateNonce(),
      localFingerprint: FP_B,
      remoteFingerprint: FP_A,
    });
    // Fresh handshake with different nonces; A expects a value bound to the NEW nonces.
    const a2 = await computeConfirmations({
      secret,
      role: 'initiator',
      nonceInitiator: generateNonce(),
      nonceResponder: generateNonce(),
      localFingerprint: FP_A,
      remoteFingerprint: FP_B,
    });
    expect(await verifyPeerConfirmation(a2.expectPeer, b1.send)).toBe(false);
  });

  it('TC-13: session key is domain-separated (byte-distinct from the confirmation key material)', async () => {
    const secret = generatePairingSecret().secret;
    const sessionKey = await deriveSessionKey(secret);
    // Reproduce the confirmation-key bits with the SAME salt but the "confirm" info; must differ from "session".
    const enc = new TextEncoder();
    const base = await crypto.subtle.importKey(
      'raw',
      Uint8Array.from(atob(secret.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
      'HKDF',
      false,
      ['deriveBits'],
    );
    const confirmBits = new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: 'HKDF',
          hash: 'SHA-256',
          salt: enc.encode('robota-remote-pairing/v1'),
          info: enc.encode('confirm'),
        },
        base,
        256,
      ),
    );
    const confirmB64 = btoa(String.fromCharCode(...confirmBits))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(sessionKey).not.toBe(confirmB64);
  });
});
