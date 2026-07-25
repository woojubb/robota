/**
 * SEC-003 alert 46 — `extractDtlsFingerprint` must be linear, and must not bind SDP free text.
 *
 * This is the one alert in the class with a genuinely **remote** source rather than a library one: the SDP is
 * delivered by the (untrusted, content-blind) signaling relay, and `extractDtlsFingerprint` runs on it BEFORE the
 * pairing confirmation — it produces the very value that confirmation binds. See the SEC-003 backlog for the
 * cited call path on both peers.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { extractDtlsFingerprint } from '../pairing.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** Larger than the other SEC-003 pumps: this regex is quadratic in the SDP length, and an SDP is a whole frame. */
const PUMP_CHARS = 400_000;
const BUDGET_MS = 250;
const RED_TIMEOUT_MS = 120_000;

function elapsedMs(run: () => void): number {
  const started = performance.now();
  run();
  return performance.now() - started;
}

describe('extractDtlsFingerprint — linearity', () => {
  it(
    'rejects an SDP pumped with `a=fingerprint:` on one line in under 250 ms',
    () => {
      const sdp = 'a=fingerprint:'.repeat(Math.floor(PUMP_CHARS / 14));
      const ms = elapsedMs(() => {
        expect(() => extractDtlsFingerprint(sdp)).toThrow(/no DTLS fingerprint/);
      });
      expect(ms).toBeLessThan(BUDGET_MS);
    },
    RED_TIMEOUT_MS,
  );

  it(
    'rejects an SDP whose pump sits in another line’s free text in under 250 ms',
    () => {
      // The realistic shape: a relay stuffs the session-name line, which is free-form and which no DTLS stack
      // reads. Unanchored, every `a=fingerprint:` inside it started a fresh scan to end of input.
      const sdp = `s=${'a=fingerprint:'.repeat(Math.floor(PUMP_CHARS / 14))}`;
      const ms = elapsedMs(() => {
        expect(() => extractDtlsFingerprint(sdp)).toThrow(/no DTLS fingerprint/);
      });
      expect(ms).toBeLessThan(BUDGET_MS);
    },
    RED_TIMEOUT_MS,
  );
});

describe('extractDtlsFingerprint — result is pinned', () => {
  const EXPECTED =
    'E9:A0:10:9D:94:1C:0A:FC:FE:76:D3:0A:B8:FB:2C:7C:82:E0:A3:83:FF:22:78:62:9B:C3:82:1F:2C:CC:25:A3';

  it('still reads the werift offer fixture (CRLF, session-level line)', () => {
    expect(extractDtlsFingerprint(readFileSync(join(FIXTURES, 'werift-offer.sdp'), 'utf8'))).toBe(
      EXPECTED,
    );
  });

  it('still reads a minimal LF-only SDP', () => {
    const sdp =
      'v=0\no=- 1 1 IN IP4 0.0.0.0\ns=-\na=fingerprint:sha-256 ab:cd:ef\nm=application 9\n';
    expect(extractDtlsFingerprint(sdp)).toBe('AB:CD:EF');
  });

  it('still fails closed when no fingerprint attribute is present', () => {
    expect(() => extractDtlsFingerprint('v=0\r\no=- 0 0 IN IP4 0.0.0.0\r\ns=-\r\n')).toThrow(
      /no DTLS fingerprint/,
    );
  });
});

describe('extractDtlsFingerprint — free text is not an attribute', () => {
  it('ignores `a=fingerprint:` smuggled into another line and takes the real attribute', () => {
    // A signaling relay controls the SDP text. `s=` is free-form and no DTLS stack reads it, so a value placed
    // there must never become the one the channel binding confirms.
    const sdp =
      's=room a=fingerprint:sha-256 DE:AD:BE:EF\r\na=fingerprint:sha-256 AB:CD:EF\r\nm=application 9\r\n';
    expect(extractDtlsFingerprint(sdp)).toBe('AB:CD:EF');
  });

  it('fails closed when the only occurrence is mid-line free text', () => {
    expect(() => extractDtlsFingerprint('s=room a=fingerprint:sha-256 DE:AD\r\n')).toThrow(
      /no DTLS fingerprint/,
    );
  });
});
