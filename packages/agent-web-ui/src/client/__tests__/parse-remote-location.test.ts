import { toPairingUrl } from '@robota-sdk/agent-remote-pairing';
import { describe, expect, it } from 'vitest';

import { parseRemoteClientLocation } from '../parse-remote-location.js';

/**
 * REMOTE-009 Step 3 — the Stage-D page reads relay ← query, rendezvous + secret ← fragment. Round-trips a
 * real `toPairingUrl` output (the fragment the host mints) to prove the browser reads back what the host wrote.
 */

describe('parseRemoteClientLocation (REMOTE-009)', () => {
  it('round-trips a toPairingUrl link: relay from query, r+s from the fragment', () => {
    const pairing = { rendezvous: 'rv-abc', secret: 'sec-xyz-256bit' };
    // The operator configures clientUrl with the relay query param; toPairingUrl preserves it + appends #r&s.
    const link = toPairingUrl('https://remote.example/?relay=wss%3A%2F%2Frelay.test', pairing);
    const loc = parseRemoteClientLocation(link);
    expect(loc).toEqual({
      relayUrl: 'wss://relay.test',
      rendezvous: 'rv-abc',
      secret: 'sec-xyz-256bit',
    });
  });

  it('keeps the secret in the fragment (never in the query the server would see)', () => {
    const link = toPairingUrl('https://remote.example/?relay=wss://r', {
      rendezvous: 'rv',
      secret: 'TOP-SECRET',
    });
    // The server-visible part (before #) must not contain the secret.
    const serverVisible = link.split('#')[0]!;
    expect(serverVisible).not.toContain('TOP-SECRET');
    expect(parseRemoteClientLocation(link).secret).toBe('TOP-SECRET');
  });

  it('throws when the relay query param is missing', () => {
    expect(() => parseRemoteClientLocation('https://remote.example/#r=rv&s=sec')).toThrow(/relay/);
  });

  it('throws when the pairing fragment is missing', () => {
    expect(() => parseRemoteClientLocation('https://remote.example/?relay=wss://r')).toThrow();
  });
});
