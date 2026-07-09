import { describe, expect, it } from 'vitest';

import { loadWerift } from '../werift-loader.js';

describe('loadWerift (REMOTE-002 Stage A — throw-on-absence lazy-load, TC-05)', () => {
  it('resolves the real werift module (RTCPeerConnection present) when installed', () => {
    const mod = loadWerift();
    expect(typeof mod.RTCPeerConnection).toBe('function');
  });

  it('throws an explicit "WebRTC transport unavailable" error when werift cannot be resolved — never a silent no-op', () => {
    expect(() =>
      loadWerift(() => {
        throw new Error('Cannot find module "werift"');
      }),
    ).toThrow(/WebRTC transport unavailable — install the optional peer dependency "werift"/);
  });
});
