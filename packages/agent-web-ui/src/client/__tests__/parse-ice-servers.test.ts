import { describe, expect, it } from 'vitest';

import { iceHasTurn, parseIceServersParam } from '../parse-ice-servers.js';

/**
 * REMOTE-010 Step 2 — the browser `ice`-param decoder. The param is attacker-influenceable, so a malformed
 * value must FAIL CLOSED (throw), never a loose cast into RTCConfiguration.
 */

/** Encode an RTCIceServer[] the way the operator's clientUrl would (base64url JSON). */
function encode(servers: unknown): string {
  return btoa(JSON.stringify(servers)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('parseIceServersParam (REMOTE-010 browser decoder)', () => {
  it('decodes + validates a STUN server', () => {
    expect(parseIceServersParam(encode([{ urls: 'stun:stun.l.google.com:19302' }]))).toEqual([
      { urls: 'stun:stun.l.google.com:19302' },
    ]);
  });

  it('decodes a TURN server with credentials + array urls', () => {
    const servers = [
      {
        urls: ['turn:turn.example:3478', 'turns:turn.example:5349'],
        username: 'u',
        credential: 'p',
      },
    ];
    expect(parseIceServersParam(encode(servers))).toEqual(servers);
  });

  it('fail-closed: not base64url', () => {
    expect(() => parseIceServersParam('@@@not-base64@@@')).toThrow();
  });

  it('fail-closed: decodes to non-JSON / non-array', () => {
    expect(() => parseIceServersParam(btoa('not json'))).toThrow(/JSON/);
    expect(() => parseIceServersParam(encode({ urls: 'stun:x' }))).toThrow(/array/);
  });

  it('fail-closed: bad/unsupported URL scheme (attacker-influenced)', () => {
    expect(() => parseIceServersParam(encode([{ urls: 'http://evil.example' }]))).toThrow(/scheme/);
    expect(() => parseIceServersParam(encode([{ urls: 'javascript:alert(1)' }]))).toThrow(/scheme/);
  });

  it('fail-closed: non-string credential', () => {
    expect(() => parseIceServersParam(encode([{ urls: 'turn:x', credential: 9 }]))).toThrow(
      /credential/,
    );
  });
});

describe('iceHasTurn', () => {
  it('detects TURN vs STUN-only', () => {
    expect(iceHasTurn([{ urls: 'stun:x' }])).toBe(false);
    expect(iceHasTurn([{ urls: 'turns:y' }])).toBe(true);
    expect(iceHasTurn(undefined)).toBe(false);
  });
});
