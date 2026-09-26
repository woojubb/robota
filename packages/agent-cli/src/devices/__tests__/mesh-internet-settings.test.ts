import { DEFAULT_NOSTR_RELAYS, DEFAULT_PKARR_RELAYS } from '@robota-sdk/agent-transport-webrtc';
import { describe, expect, it } from 'vitest';

import { parseMeshInternetSettings } from '../mesh-internet-settings.js';

describe('mesh public-infrastructure settings', () => {
  it('default to the DHT and to relays of several operators', () => {
    const settings = parseMeshInternetSettings(undefined);
    expect(settings).toEqual({
      dht: true,
      pkarrRelays: DEFAULT_PKARR_RELAYS,
      nostrRelays: DEFAULT_NOSTR_RELAYS,
    });
    const operators = (urls: readonly string[]) =>
      new Set(urls.map((u) => new URL(u).hostname.split('.').slice(-2).join('.')));
    expect(operators(settings.nostrRelays).size).toBeGreaterThanOrEqual(2);
    expect(operators(settings.pkarrRelays).size).toBeGreaterThanOrEqual(2);
  });

  it('are replaceable, and an empty list turns a way off', () => {
    expect(
      parseMeshInternetSettings({
        dht: false,
        pkarrRelays: ['https://pkarr.example.org'],
        nostrRelays: [],
      }),
    ).toEqual({ dht: false, pkarrRelays: ['https://pkarr.example.org'], nostrRelays: [] });
  });

  it('fail closed on a malformed value', () => {
    expect(() => parseMeshInternetSettings('yes')).toThrow(/must be an object/);
    expect(() => parseMeshInternetSettings({ dht: 'on' })).toThrow(/`dht`/);
    expect(() => parseMeshInternetSettings({ nostrRelays: 'wss://a' })).toThrow(/nostrRelays/);
    expect(() => parseMeshInternetSettings({ nostrRelays: ['https://a.example'] })).toThrow(
      /nostrRelays\[0\]/,
    );
    expect(() => parseMeshInternetSettings({ pkarrRelays: ['http://a.example'] })).toThrow(
      /pkarrRelays\[0\]/,
    );
    expect(() => parseMeshInternetSettings({ pkarrRelays: ['https://user:pw@a.example'] })).toThrow(
      /without credentials/,
    );
    expect(() => parseMeshInternetSettings({ nostrRelays: ['not a url'] })).toThrow(/not a URL/);
  });
});
