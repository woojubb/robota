import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractDtlsFingerprint } from '../pairing.js';
import { describe, expect, it } from 'vitest';

/**
 * REMOTE-009 D6 — GATING security test: DTLS-fingerprint extraction PARITY across SDP dialects.
 *
 * The pairing channel binding only holds if the host (werift) and the browser (native `RTCPeerConnection`)
 * extract the SAME normalized fingerprint from the SAME `a=fingerprint` line. These fixtures carry media-level
 * fingerprints: uppercase in the werift offer and lowercase in the native answer. `extractDtlsFingerprint` must
 * normalize both to one canonical value — otherwise the directional-HMAC confirmation fails for honest peers.
 *
 * This test uses the owner-local werift host offer fixture and a
 * realistic native-browser data-channel answer fixture that carries the SAME fingerprint hex in the native
 * dialect (media-level, lowercase). Parity ⇒ both extractions yield the identical string.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Both dialect samples belong to this normalization contract; neither is a shared fixture API. */
const WERIFT_OFFER = join(__dirname, 'fixtures/werift-offer.sdp');
const NATIVE_ANSWER = join(__dirname, 'fixtures/native-browser-answer.sdp');

const EXPECTED =
  'E9:A0:10:9D:94:1C:0A:FC:FE:76:D3:0A:B8:FB:2C:7C:82:E0:A3:83:FF:22:78:62:9B:C3:82:1F:2C:CC:25:A3';

describe('DTLS fingerprint extraction parity (REMOTE-009 D6)', () => {
  it('extracts the werift host offer fingerprint (media-level, uppercase)', () => {
    expect(extractDtlsFingerprint(readFileSync(WERIFT_OFFER, 'utf8'))).toBe(EXPECTED);
  });

  it('extracts a native-browser answer fingerprint (media-level, LOWERCASE) to the same canonical form', () => {
    const fp = extractDtlsFingerprint(readFileSync(NATIVE_ANSWER, 'utf8'));
    expect(fp).toBe(EXPECTED); // normalized identically to the werift dialect → channel binding holds
    expect(fp).toBe(fp.toUpperCase()); // canonical uppercase
  });

  it('parity: the browser and host extract the SAME string from the two dialects', () => {
    const hostSide = extractDtlsFingerprint(readFileSync(WERIFT_OFFER, 'utf8'));
    const browserSide = extractDtlsFingerprint(readFileSync(NATIVE_ANSWER, 'utf8'));
    expect(browserSide).toBe(hostSide);
  });

  it('throws on an SDP with no a=fingerprint line (fail-closed, never a silent empty binding)', () => {
    expect(() => extractDtlsFingerprint('v=0\r\no=- 0 0 IN IP4 0.0.0.0\r\ns=-\r\n')).toThrow();
  });
});
