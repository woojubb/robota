import { describe, expect, it } from 'vitest';

import { ResumeBuffer } from '../resume-buffer.js';
import type { TServerMessage } from '../ws-protocol.js';

/**
 * REMOTE-013 E4 TC-01 — the bounded un-acked resume buffer: monotonic seq, ack-drop, tail replay, overrun
 * marker (never a silent gap), and drop-oldest bound enforcement.
 */

function msg(delta: string): TServerMessage {
  return { type: 'text_delta', delta };
}

describe('ResumeBuffer (REMOTE-013 TC-01)', () => {
  it('append assigns a monotonic seq starting at 1 and tracks lastSeq', () => {
    const b = new ResumeBuffer();
    expect(b.append(msg('a'))).toBe(1);
    expect(b.append(msg('b'))).toBe(2);
    expect(b.append(msg('c'))).toBe(3);
    expect(b.lastSeq).toBe(3);
  });

  it('tailAfter returns the ordered frames after lastSeq', () => {
    const b = new ResumeBuffer();
    b.append(msg('a'));
    b.append(msg('b'));
    b.append(msg('c'));
    const tail = b.tailAfter(1);
    expect(tail.kind).toBe('tail');
    if (tail.kind === 'tail') {
      expect(tail.frames.map((f) => f.seq)).toEqual([2, 3]);
      expect(tail.frames.map((f) => (f.message as { delta: string }).delta)).toEqual(['b', 'c']);
    }
  });

  it('tailAfter at/after the newest seq is an empty tail (caught up, not overrun)', () => {
    const b = new ResumeBuffer();
    b.append(msg('a'));
    b.append(msg('b'));
    expect(b.tailAfter(2)).toEqual({ kind: 'tail', frames: [] });
    expect(b.tailAfter(5)).toEqual({ kind: 'tail', frames: [] });
  });

  it('ackThrough drops frames <= seq; the tail then starts after the ack', () => {
    const b = new ResumeBuffer();
    b.append(msg('a')); // 1
    b.append(msg('b')); // 2
    b.append(msg('c')); // 3
    b.ackThrough(2);
    expect(b.size).toBe(1);
    const tail = b.tailAfter(2);
    expect(tail.kind === 'tail' && tail.frames.map((f) => f.seq)).toEqual([3]);
  });

  it('tailAfter returns overrun only when the client MISSED an evicted frame', () => {
    const b = new ResumeBuffer({ maxFrames: 2 });
    b.append(msg('a')); // 1 (evicted)
    b.append(msg('b')); // 2
    b.append(msg('c')); // 3 → buffer now holds [2,3]
    expect(b.size).toBe(2);
    // client saw NOTHING (lastSeq 0): it needs frame 1, which is evicted → overrun.
    expect(b.tailAfter(0)).toEqual({ kind: 'overrun' });
    // client already saw seq 1: it needs 2,3 — both retained → clean tail (no gap).
    const t1 = b.tailAfter(1);
    expect(t1.kind === 'tail' && t1.frames.map((f) => f.seq)).toEqual([2, 3]);
    // client saw seq 2 → only 3 remains.
    const t2 = b.tailAfter(2);
    expect(t2.kind === 'tail' && t2.frames.map((f) => f.seq)).toEqual([3]);
  });

  it('enforces the frame bound (drop-oldest) — never exceeds maxFrames', () => {
    const b = new ResumeBuffer({ maxFrames: 3 });
    for (let i = 0; i < 100; i += 1) b.append(msg(`m${i}`));
    expect(b.size).toBe(3);
    expect(b.lastSeq).toBe(100); // seq keeps advancing even as old frames drop
  });

  it('enforces the byte bound (drop-oldest) with an injected sizeOf', () => {
    const b = new ResumeBuffer({ maxBytes: 30, sizeOf: () => 10 }); // ~3 frames fit
    for (let i = 0; i < 10; i += 1) b.append(msg(`m${i}`));
    expect(b.size).toBeLessThanOrEqual(3);
    // A fresh client can still resume the retained tail.
    const tail = b.tailAfter(b.lastSeq - 1);
    expect(tail.kind).toBe('tail');
  });

  it('overrun after eviction triggers the full-refresh path for a far-behind client', () => {
    const b = new ResumeBuffer({ maxFrames: 2 });
    for (let i = 0; i < 10; i += 1) b.append(msg(`m${i}`)); // seqs 1..10, retains [9,10]
    expect(b.tailAfter(0)).toEqual({ kind: 'overrun' }); // brand-new / far-behind client
  });
});
