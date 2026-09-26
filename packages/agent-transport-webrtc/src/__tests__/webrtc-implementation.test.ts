/**
 * The Node transport runs on `node-datachannel` (libdatachannel, DTLS by OpenSSL) and nothing else:
 * where it cannot load, the transport is unavailable, never backed by another implementation.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { loadDataChannel } from '../datachannel-loader.js';
import { RtcPeer } from '../rtc-peer.js';
import { createInMemorySignalingPair } from '../signaling.js';
import { WebRtcTransport } from '../webrtc-transport.js';

import type { IProtocolSession } from '@robota-sdk/agent-transport';

const UNAVAILABLE = /WebRTC transport unavailable/;

describe('the WebRTC implementation', () => {
  it('is node-datachannel: the loader asks for that module only and returns it', () => {
    const requested: string[] = [];
    const real = createRequire(import.meta.url)('node-datachannel') as unknown;
    const loaded = loadDataChannel((id) => {
      requested.push(id);
      return real;
    });
    expect(requested).toEqual(['node-datachannel']);
    expect(loaded).toBe(real);
    expect(loadDataChannel()).toBe(real);
  });

  it('is the only WebRTC implementation the package declares', () => {
    const manifest = JSON.parse(
      readFileSync(join(import.meta.dirname, '..', '..', 'package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    expect(Object.keys(manifest.peerDependencies ?? {})).toEqual(['node-datachannel']);
    expect(Object.keys(manifest.dependencies ?? {})).not.toContain('node-datachannel');
  });

  it('backs a real connection', () => {
    const peer = new RtcPeer();
    expect(peer.state).toBe('new');
    peer.close();
  });
});

describe('when node-datachannel cannot load', () => {
  const missing = (): never => {
    throw new Error("Cannot find module 'node-datachannel'");
  };

  it('the loader refuses, whether the module is absent or has no binding for this platform', () => {
    expect(() => loadDataChannel(missing)).toThrow(UNAVAILABLE);
    expect(() => loadDataChannel(() => ({}))).toThrow(UNAVAILABLE);
  });

  it('a connection refuses instead of being built on anything else', () => {
    expect(() => new RtcPeer({ loadDataChannel: () => loadDataChannel(missing) })).toThrow(
      UNAVAILABLE,
    );
  });

  it('the transport start refuses and sends nothing', async () => {
    const [signaling] = createInMemorySignalingPair();
    const send = vi.spyOn(signaling, 'send');
    const transport = new WebRtcTransport({
      signaling,
      open: true,
      openReason: 'implementation availability test',
      loadDataChannel: () => loadDataChannel(missing),
    });
    transport.attach({} as IProtocolSession);
    await expect(transport.start()).rejects.toThrow(UNAVAILABLE);
    expect(send).not.toHaveBeenCalled();
    await transport.stop();
  });
});
