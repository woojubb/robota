import { describe, it, expect } from 'vitest';

import {
  CHANNEL_FRAME_MAGIC,
  decodeChannelFrame,
  encodeBinaryFrame,
  encodeChannelEventFrame,
} from '../channel-frames.js';

import type { IBinaryFrame, IChannelEventFrame } from '@robota-sdk/agent-interface-transport';

/**
 * TRANS-001 — payload-agnostic frame codec.
 *
 * The codec is the ONLY thing that knows the carrier envelope; it never interprets the opaque body.
 * These tests pin round-trip integrity, ordering metadata (`seq`), and explicit malformed-input
 * results (a result union, never a swallowed default).
 */

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

describe('channel frame codec (TRANS-001)', () => {
  it('round-trips an opaque binary payload byte-identically', () => {
    // Deliberately includes bytes that are invalid UTF-8 and JSON-hostile — the carrier must not care.
    const payload = bytes(0x00, 0xff, 0xfe, 0x7b, 0x22, 0x80, 0x0a, 0xc3, 0x28);
    const encoded = encodeBinaryFrame({ kind: 'binary', channel: 'audio', seq: 7, payload });

    const decoded = decodeChannelFrame(encoded);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.frame.kind).toBe('binary');
    const frame = decoded.frame as IBinaryFrame;
    expect(frame.channel).toBe('audio');
    expect(frame.seq).toBe(7);
    expect(Array.from(frame.payload)).toEqual(Array.from(payload));
  });

  it('round-trips an empty binary payload', () => {
    const encoded = encodeBinaryFrame({
      kind: 'binary',
      channel: 'blob',
      seq: 0,
      payload: new Uint8Array(0),
    });
    const decoded = decodeChannelFrame(encoded);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect((decoded.frame as IBinaryFrame).payload.byteLength).toBe(0);
  });

  it('preserves per-channel ordering through seq on a chunked stream', () => {
    const source = new Uint8Array(1024);
    for (let i = 0; i < source.length; i += 1) source[i] = (i * 31) % 256;

    const chunkSize = 100;
    const wire: Uint8Array[] = [];
    for (let offset = 0, seq = 0; offset < source.length; offset += chunkSize, seq += 1) {
      wire.push(
        encodeBinaryFrame({
          kind: 'binary',
          channel: 'file',
          seq,
          payload: source.subarray(offset, Math.min(offset + chunkSize, source.length)),
        }),
      );
    }

    // Deliver out of order; the receiver reassembles by `seq`, not by arrival order.
    const shuffled = [...wire].reverse();
    const received: IBinaryFrame[] = [];
    for (const w of shuffled) {
      const d = decodeChannelFrame(w);
      expect(d.ok).toBe(true);
      if (d.ok && d.frame.kind === 'binary') received.push(d.frame);
    }

    received.sort((a, b) => a.seq - b.seq);
    const reassembled = new Uint8Array(source.length);
    let cursor = 0;
    for (const frame of received) {
      reassembled.set(frame.payload, cursor);
      cursor += frame.payload.byteLength;
    }
    expect(cursor).toBe(source.length);
    expect(Array.from(reassembled)).toEqual(Array.from(source));
  });

  it('round-trips a consumer-declared structured event frame', () => {
    const encoded = encodeChannelEventFrame({
      kind: 'event',
      channel: 'captions',
      seq: 3,
      event: 'caption',
      payload: { text: 'hello', final: true },
    });

    const decoded = decodeChannelFrame(encoded);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.frame.kind).toBe('event');
    const frame = decoded.frame as IChannelEventFrame;
    expect(frame.channel).toBe('captions');
    expect(frame.seq).toBe(3);
    expect(frame.event).toBe('caption');
    expect(frame.payload).toEqual({ text: 'hello', final: true });
  });

  it('supports multi-byte UTF-8 channel names', () => {
    const encoded = encodeBinaryFrame({
      kind: 'binary',
      channel: '음성-채널',
      seq: 1,
      payload: bytes(1, 2, 3),
    });
    const decoded = decodeChannelFrame(encoded);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.frame.channel).toBe('음성-채널');
  });

  it('rejects a channel name that does not fit the 255-byte header field', () => {
    expect(() =>
      encodeBinaryFrame({
        kind: 'binary',
        channel: 'x'.repeat(256),
        seq: 0,
        payload: new Uint8Array(0),
      }),
    ).toThrow(/channel name/i);
  });

  it('rejects an empty channel name', () => {
    expect(() =>
      encodeBinaryFrame({ kind: 'binary', channel: '', seq: 0, payload: new Uint8Array(0) }),
    ).toThrow(/channel name/i);
  });

  it('rejects a seq outside the uint32 range', () => {
    expect(() =>
      encodeBinaryFrame({
        kind: 'binary',
        channel: 'c',
        seq: 2 ** 32,
        payload: new Uint8Array(0),
      }),
    ).toThrow(/seq/i);
  });

  it('reports a non-channel frame as a typed error result rather than throwing', () => {
    const decoded = decodeChannelFrame(bytes(0x01, 0x02, 0x03, 0x04, 0x05));
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.error).toMatch(/magic|channel frame/i);
  });

  it('reports a truncated frame as a typed error result', () => {
    const full = encodeBinaryFrame({
      kind: 'binary',
      channel: 'audio',
      seq: 1,
      payload: bytes(9, 9, 9),
    });
    const decoded = decodeChannelFrame(full.subarray(0, 6));
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.error).toMatch(/truncated/i);
  });

  it('reports an unknown frame kind as a typed error result', () => {
    const full = encodeBinaryFrame({
      kind: 'binary',
      channel: 'audio',
      seq: 1,
      payload: bytes(9),
    });
    const tampered = Uint8Array.from(full);
    tampered[4] = 0x7f; // unknown kind byte
    const decoded = decodeChannelFrame(tampered);
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.error).toMatch(/kind/i);
  });

  it('reports a malformed event body as a typed error result', () => {
    const good = encodeChannelEventFrame({
      kind: 'event',
      channel: 'c',
      seq: 0,
      event: 'e',
      payload: null,
    });
    const tampered = Uint8Array.from(good);
    // Corrupt the JSON body (everything after the 10 + channelNameLength header bytes).
    tampered[tampered.length - 1] = 0x7b; // '{'
    const decoded = decodeChannelFrame(tampered);
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.error).toMatch(/body|json/i);
  });

  it('stamps the shared magic so a carrier can route frames without parsing them', () => {
    const encoded = encodeBinaryFrame({
      kind: 'binary',
      channel: 'c',
      seq: 0,
      payload: new Uint8Array(0),
    });
    expect(Array.from(encoded.subarray(0, CHANNEL_FRAME_MAGIC.length))).toEqual(
      Array.from(CHANNEL_FRAME_MAGIC),
    );
  });
});
