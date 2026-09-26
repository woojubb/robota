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
      relay: { serve: false, port: 3478 },
      turnServers: [],
      relayOnly: false,
    });
    // The organisation's name: the label before the public suffix (pubky.app and pubky.org are one).
    const operators = (urls: readonly string[]) =>
      new Set(urls.map((u) => new URL(u).hostname.split('.').slice(-2)[0]));
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
    ).toEqual(
      expect.objectContaining({
        dht: false,
        pkarrRelays: ['https://pkarr.example.org'],
        nostrRelays: [],
      }),
    );
  });

  it('name the embedded relay this device runs, the TURN servers to fall back on, and relay-only', () => {
    expect(
      parseMeshInternetSettings({
        relay: {
          serve: true,
          port: 3479,
          host: '0.0.0.0',
          publicAddress: '203.0.113.5',
          relayPorts: { min: 49160, max: 49200 },
        },
        turnServers: [{ urls: 'turn:turn.example.org:3478', username: 'u', credential: 'c' }],
        relayOnly: true,
      }),
    ).toEqual(
      expect.objectContaining({
        relay: {
          serve: true,
          port: 3479,
          host: '0.0.0.0',
          publicAddress: '203.0.113.5',
          relayPorts: { min: 49160, max: 49200 },
        },
        turnServers: [{ urls: 'turn:turn.example.org:3478', username: 'u', credential: 'c' }],
        relayOnly: true,
      }),
    );
  });

  it('fail closed on a malformed relay setting', () => {
    expect(() => parseMeshInternetSettings({ relay: true })).toThrow(/`relay` must be an object/);
    expect(() => parseMeshInternetSettings({ relay: { serve: 'yes' } })).toThrow(/relay.serve/);
    expect(() => parseMeshInternetSettings({ relay: { port: 70_000 } })).toThrow(/relay.port/);
    expect(() => parseMeshInternetSettings({ relay: { publicAddress: 'example.org' } })).toThrow(
      /relay.publicAddress/,
    );
    expect(() => parseMeshInternetSettings({ relay: { host: 'lan' } })).toThrow(/relay.host/);
    // The relay serves IPv4 only.
    expect(() => parseMeshInternetSettings({ relay: { host: '::' } })).toThrow(/IPv4/);
    expect(() => parseMeshInternetSettings({ relay: { publicAddress: '2001:db8::5' } })).toThrow(
      /relay.publicAddress/,
    );
    expect(() =>
      parseMeshInternetSettings({ relay: { relayPorts: { min: 50_000, max: 49_000 } } }),
    ).toThrow(/relay.relayPorts/);
    expect(() => parseMeshInternetSettings({ relay: { relayPorts: [49_000, 50_000] } })).toThrow(
      /relay.relayPorts/,
    );
    // A fallback relay is a TURN server; a STUN server relays nothing.
    expect(() =>
      parseMeshInternetSettings({ turnServers: [{ urls: 'stun:stun.example.org' }] }),
    ).toThrow(/turnServers\[0\]/);
    expect(() =>
      parseMeshInternetSettings({ turnServers: [{ urls: 'turn:turn.example.org' }] }),
    ).toThrow(/username and credential/);
    expect(() => parseMeshInternetSettings({ turnServers: 'turn:a' })).toThrow(/turnServers/);
    expect(() => parseMeshInternetSettings({ relayOnly: 1 })).toThrow(/`relayOnly`/);
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
