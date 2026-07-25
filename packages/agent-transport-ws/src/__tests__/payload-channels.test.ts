import {
  decodeChannelFrame,
  encodeBinaryFrame,
  encodeChannelEventFrame,
} from '@robota-sdk/agent-transport-protocol';
import { describe, it, expect, vi } from 'vitest';

import { PayloadChannelRegistry } from '../payload-channels.js';

import type { IBinaryFrame } from '@robota-sdk/agent-interface-transport';

/**
 * TRANS-001 — consumer-declared channels on the payload-agnostic carrier.
 *
 * The registry is the transport-side half of `IPayloadChannelHost`: consumers declare a channel
 * (its name, its event types, whether it carries opaque bytes) and get a typed handle. Undeclared
 * traffic is an explicit protocol error in BOTH directions — never a silent pass-through.
 */

/** A remote peer's outbound binary frame, built through the shared codec (never re-implemented here). */
function peerBinary(channel: string, seq: number, payload: Uint8Array): Uint8Array {
  return encodeBinaryFrame({ kind: 'binary', channel, seq, payload });
}

/** A remote peer's outbound event frame — including event names the local channel never declared. */
function peerEvent(channel: string, seq: number, event: string, payload: unknown): Uint8Array {
  return encodeChannelEventFrame({
    kind: 'event',
    channel,
    seq,
    event,
    payload: payload as never,
  });
}

describe('PayloadChannelRegistry (TRANS-001)', () => {
  it('fans a declared event out to every attached sink as an encoded frame', () => {
    const registry = new PayloadChannelRegistry();
    const channel = registry.registerChannel<{ caption: { text: string } }>({
      name: 'captions',
      events: ['caption'],
    });

    const sinkA: Uint8Array[] = [];
    const sinkB: Uint8Array[] = [];
    registry.addSink((b) => sinkA.push(b));
    registry.addSink((b) => sinkB.push(b));

    channel.sendEvent('caption', { text: 'hi' });

    expect(sinkA).toHaveLength(1);
    expect(sinkB).toHaveLength(1);
    const decoded = decodeChannelFrame(sinkA[0]!);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.frame.kind).toBe('event');
    expect(decoded.frame.channel).toBe('captions');
  });

  it('assigns a monotonic per-channel seq across interleaved binary and event frames', () => {
    const registry = new PayloadChannelRegistry();
    const channel = registry.registerChannel<{ mark: { at: number } }>({
      name: 'mixed',
      events: ['mark'],
      binary: true,
    });
    const wire: Uint8Array[] = [];
    registry.addSink((b) => wire.push(b));

    channel.sendBinary(Uint8Array.from([1]));
    channel.sendEvent('mark', { at: 1 });
    channel.sendBinary(Uint8Array.from([2]));

    const seqs = wire.map((b) => {
      const d = decodeChannelFrame(b);
      return d.ok ? d.frame.seq : -1;
    });
    expect(seqs).toEqual([0, 1, 2]);
  });

  it('keeps each channel on its own independent seq counter', () => {
    const registry = new PayloadChannelRegistry();
    const a = registry.registerChannel({ name: 'a', events: [], binary: true });
    const b = registry.registerChannel({ name: 'b', events: [], binary: true });
    const wire: Uint8Array[] = [];
    registry.addSink((x) => wire.push(x));

    a.sendBinary(Uint8Array.from([1]));
    b.sendBinary(Uint8Array.from([1]));
    a.sendBinary(Uint8Array.from([2]));

    const pairs = wire.map((x) => {
      const d = decodeChannelFrame(x);
      return d.ok ? `${d.frame.channel}:${d.frame.seq}` : 'bad';
    });
    expect(pairs).toEqual(['a:0', 'b:0', 'a:1']);
  });

  it('dispatches an inbound binary frame to that channel only', () => {
    const registry = new PayloadChannelRegistry();
    const audio = registry.registerChannel({ name: 'audio', events: [], binary: true });
    const other = registry.registerChannel({ name: 'other', events: [], binary: true });

    const audioFrames: IBinaryFrame[] = [];
    const otherFrames: IBinaryFrame[] = [];
    audio.onBinary((f) => audioFrames.push(f));
    other.onBinary((f) => otherFrames.push(f));

    const result = registry.receive(peerBinary('audio', 4, Uint8Array.from([7, 8, 9])));

    expect(result.ok).toBe(true);
    expect(otherFrames).toHaveLength(0);
    expect(audioFrames).toHaveLength(1);
    expect(audioFrames[0]!.seq).toBe(4);
    expect(Array.from(audioFrames[0]!.payload)).toEqual([7, 8, 9]);
  });

  it('dispatches an inbound event only to handlers registered for that event name', () => {
    const registry = new PayloadChannelRegistry();
    const channel = registry.registerChannel<{
      caption: { text: string };
      speaker: { id: string };
    }>({ name: 'app', events: ['caption', 'speaker'] });
    const onCaption = vi.fn();
    const onSpeaker = vi.fn();
    channel.onEvent('caption', onCaption);
    channel.onEvent('speaker', onSpeaker);

    const result = registry.receive(peerEvent('app', 0, 'caption', { text: 'x' }));

    expect(result.ok).toBe(true);
    // The handler receives the payload plus the full frame (channel/seq envelope).
    expect(onCaption).toHaveBeenCalledWith(
      { text: 'x' },
      expect.objectContaining({ kind: 'event', channel: 'app', event: 'caption', seq: 0 }),
    );
    expect(onSpeaker).not.toHaveBeenCalled();
  });

  it('unsubscribes a handler through the returned disposer', () => {
    const registry = new PayloadChannelRegistry();
    const channel = registry.registerChannel({ name: 'c', events: [], binary: true });
    const handler = vi.fn();
    const off = channel.onBinary(handler);

    registry.receive(peerBinary('c', 0, Uint8Array.from([1])));
    off();
    registry.receive(peerBinary('c', 1, Uint8Array.from([2])));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('returns an error result for a frame addressed to an unregistered channel', () => {
    const registry = new PayloadChannelRegistry();
    const result = registry.receive(peerBinary('ghost', 0, Uint8Array.from([1])));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/ghost/);
  });

  it('returns an error result for an event the channel never declared', () => {
    const registry = new PayloadChannelRegistry();
    registry.registerChannel<{ caption: { text: string } }>({ name: 'app', events: ['caption'] });
    const result = registry.receive(peerEvent('app', 0, 'not-declared', { a: 1 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not-declared/);
  });

  it('returns an error result for binary traffic on a non-binary channel', () => {
    const registry = new PayloadChannelRegistry();
    registry.registerChannel({ name: 'text-only', events: [] });
    const result = registry.receive(peerBinary('text-only', 0, Uint8Array.from([1])));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/binary/i);
  });

  it('surfaces a malformed frame as an error result', () => {
    const registry = new PayloadChannelRegistry();
    const result = registry.receive(Uint8Array.from([1, 2, 3]));
    expect(result.ok).toBe(false);
  });

  it('rejects a duplicate channel registration', () => {
    const registry = new PayloadChannelRegistry();
    registry.registerChannel({ name: 'dup', events: [] });
    expect(() => registry.registerChannel({ name: 'dup', events: [] })).toThrow(/already/i);
  });

  it('rejects sending an undeclared event name', () => {
    const registry = new PayloadChannelRegistry();
    const channel = registry.registerChannel<{ known: { a: number } }>({
      name: 'app',
      events: ['known'],
    });
    // Cast: the compiler already rejects this call; the runtime guard is the wire-level contract.
    const untyped = channel as unknown as { sendEvent: (e: string, p: unknown) => void };
    expect(() => untyped.sendEvent('nope', {})).toThrow(/nope/);
  });

  it('rejects sending binary on a channel that did not opt into binary', () => {
    const registry = new PayloadChannelRegistry();
    const channel = registry.registerChannel({ name: 'text-only', events: [] });
    expect(() => channel.sendBinary(Uint8Array.from([1]))).toThrow(/binary/i);
  });

  it('stops delivering to a closed channel and frees the name', () => {
    const registry = new PayloadChannelRegistry();
    const channel = registry.registerChannel({ name: 'temp', events: [], binary: true });
    const handler = vi.fn();
    channel.onBinary(handler);
    channel.close();

    const result = registry.receive(peerBinary('temp', 0, Uint8Array.from([1])));
    expect(result.ok).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    expect(() => registry.registerChannel({ name: 'temp', events: [] })).not.toThrow();
  });

  it('drops a detached sink', () => {
    const registry = new PayloadChannelRegistry();
    const channel = registry.registerChannel({ name: 'c', events: [], binary: true });
    const seen: Uint8Array[] = [];
    const detach = registry.addSink((b) => seen.push(b));

    channel.sendBinary(Uint8Array.from([1]));
    detach();
    channel.sendBinary(Uint8Array.from([2]));

    expect(seen).toHaveLength(1);
  });
});
