import { describe, expect, it } from 'vitest';

import { hasTurnServer, parseIceServers } from '../ice-config.js';

/**
 * REMOTE-010 Step 1 — the host ICE validating reader. `transports.webrtc.options.iceServers` is an untyped bag
 * value; a malformed value must FAIL CLOSED (throw), never a silent partial/cast config.
 */

describe('parseIceServers (REMOTE-010 host validator)', () => {
  it('returns undefined for absent/empty', () => {
    expect(parseIceServers(undefined)).toBeUndefined();
    expect(parseIceServers(null)).toBeUndefined();
    expect(parseIceServers([])).toBeUndefined();
  });

  it('accepts a STUN server (string urls)', () => {
    expect(parseIceServers([{ urls: 'stun:stun.l.google.com:19302' }])).toEqual([
      { urls: 'stun:stun.l.google.com:19302' },
    ]);
  });

  it('accepts a TURN server with credentials + array urls', () => {
    const cfg = [
      {
        urls: ['turn:turn.example:3478', 'turns:turn.example:5349'],
        username: 'u',
        credential: 'p',
      },
    ];
    expect(parseIceServers(cfg)).toEqual(cfg);
  });

  it('fail-closed: not an array', () => {
    expect(() => parseIceServers({ urls: 'stun:x' })).toThrow(/must be an array/);
  });

  it('fail-closed: entry not an object', () => {
    expect(() => parseIceServers(['stun:x'])).toThrow(/must be an object/);
  });

  it('fail-closed: bad/unsupported URL scheme (attacker-influenced)', () => {
    expect(() => parseIceServers([{ urls: 'http://evil.example' }])).toThrow(/scheme/);
    expect(() => parseIceServers([{ urls: 'javascript:alert(1)' }])).toThrow(/scheme/);
  });

  it('fail-closed: non-string username/credential', () => {
    expect(() => parseIceServers([{ urls: 'turn:x', username: 42 }])).toThrow(/username/);
    expect(() => parseIceServers([{ urls: 'turn:x', credential: {} }])).toThrow(/credential/);
  });

  it('fail-closed: empty/non-string url', () => {
    expect(() => parseIceServers([{ urls: '' }])).toThrow(/url/);
    expect(() => parseIceServers([{ urls: 123 }])).toThrow(/url/);
  });
});

describe('hasTurnServer', () => {
  it('detects a TURN url (string or array), ignores STUN-only', () => {
    expect(hasTurnServer([{ urls: 'stun:x' }])).toBe(false);
    expect(hasTurnServer([{ urls: 'turn:x' }])).toBe(true);
    expect(hasTurnServer([{ urls: ['stun:x', 'turns:y'] }])).toBe(true);
    expect(hasTurnServer(undefined)).toBe(false);
  });
});
