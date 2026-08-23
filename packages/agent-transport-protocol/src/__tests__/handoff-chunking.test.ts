import { describe, expect, it } from 'vitest';

import {
  chunkCountFor,
  chunkHandoffPayload,
  HandoffChunkAssembler,
  type IHandoffChunk,
} from '../handoff-chunking.js';
import { sealHandoffRecord, verifyHandoffPayload } from '../handoff-manifest.js';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

const ID = 'handoff_1';

function assemble(chunks: readonly IHandoffChunk[], assembler = new HandoffChunkAssembler(ID)) {
  let last;
  for (const chunk of chunks) last = assembler.accept(chunk);
  return { assembler, last };
}

describe('HANDOFF-001 — a payload larger than one frame travels in pieces', () => {
  it('every chunk fits the byte budget', () => {
    // The channel's limit is in bytes, so the budget has to be honoured in bytes. A payload of
    // multi-byte characters is where a character-based cut overflows the frame.
    const payload = '한글'.repeat(500);

    const chunks = chunkHandoffPayload(ID, payload, 64);

    for (const chunk of chunks) {
      expect(Buffer.from(chunk.data, 'base64').byteLength).toBeLessThanOrEqual(64);
    }
  });

  it('round-trips a payload whose characters do not align to the cut', () => {
    // The cut lands mid-character by construction here. Reassembly is on bytes, so the boundary
    // is invisible to the result — which is the property the byte-based design buys.
    const payload = `${'a'.repeat(30)}😀${'b'.repeat(30)}`;

    const { last } = assemble(chunkHandoffPayload(ID, payload, 16));

    expect(last?.outcome).toBe('complete');
    expect(last?.serialized).toBe(payload);
  });

  it('an empty payload is one chunk, not zero', () => {
    // Zero chunks would leave a receiver unable to tell a completed empty transfer from one that
    // never started.
    const chunks = chunkHandoffPayload(ID, '', 64);

    expect(chunks).toHaveLength(1);
    expect(assemble(chunks).last?.serialized).toBe('');
  });

  it('every chunk carries the total, so no single lost frame hides the count', () => {
    const chunks = chunkHandoffPayload(ID, 'x'.repeat(100), 10);

    expect(chunks.every((c) => c.total === chunks.length)).toBe(true);
  });

  it('refuses a budget that would produce an endless sequence of empty chunks', () => {
    expect(() => chunkHandoffPayload(ID, 'x', 0)).toThrow(/positive integer/);
  });

  it('predicts the chunk count from the manifest without building them', () => {
    const { serialized, integrity } = sealHandoffRecord({
      id: 's',
      cwd: '/w',
      createdAt: 'a',
      updatedAt: 'b',
      messages: [],
    } as IInteractiveSessionRecord);

    expect(chunkCountFor(integrity, 16)).toBe(chunkHandoffPayload(ID, serialized, 16).length);
  });
});

describe('HANDOFF-001 — reordering and retries are normal; inconsistency is not', () => {
  it('accepts chunks out of order', () => {
    const chunks = [...chunkHandoffPayload(ID, 'x'.repeat(100), 10)].reverse();

    const { last } = assemble(chunks);

    expect(last?.outcome).toBe('complete');
    expect(last?.serialized).toBe('x'.repeat(100));
  });

  it('a re-sent chunk is a duplicate, not a problem', () => {
    const chunks = chunkHandoffPayload(ID, 'x'.repeat(100), 10);
    const assembler = new HandoffChunkAssembler(ID);
    assembler.accept(chunks[0]);

    const again = assembler.accept(chunks[0]);

    expect(again.outcome).toBe('duplicate');
    expect(again.received).toBe(1);
  });

  it('different bytes for the same index is refused, not overwritten', () => {
    const chunks = chunkHandoffPayload(ID, 'x'.repeat(100), 10);
    const assembler = new HandoffChunkAssembler(ID);
    assembler.accept(chunks[0]);

    const conflicting = assembler.accept({
      ...chunks[0],
      data: Buffer.from('zz').toString('base64'),
    });

    expect(conflicting.outcome).toBe('refused');
  });

  it('a peer that changes its mind about the size is refused', () => {
    // Either it restarted the transfer under the same id, or it is not the peer we started with.
    // Both mean the pieces held so far can no longer be assumed to belong together.
    const chunks = chunkHandoffPayload(ID, 'x'.repeat(100), 10);
    const assembler = new HandoffChunkAssembler(ID);
    assembler.accept(chunks[0]);

    const result = assembler.accept({ ...chunks[1], total: 3 });

    expect(result.rejection).toBe('inconsistent-total');
  });

  it('refuses a chunk belonging to a different transfer rather than routing it', () => {
    const [chunk] = chunkHandoffPayload('other_handoff', 'x', 10);

    expect(new HandoffChunkAssembler(ID).accept(chunk).rejection).toBe('wrong-handoff');
  });

  it.each([
    ['a negative index', -1],
    ['an index beyond the total', 99],
  ])('refuses %s', (_label, index) => {
    const [chunk] = chunkHandoffPayload(ID, 'x'.repeat(30), 10);

    expect(new HandoffChunkAssembler(ID).accept({ ...chunk, index }).rejection).toBe(
      'out-of-range',
    );
  });

  it('reports which indices are still missing, so a caller can ask rather than restart', () => {
    const chunks = chunkHandoffPayload(ID, 'x'.repeat(100), 10);
    const assembler = new HandoffChunkAssembler(ID);
    assembler.accept(chunks[0]);
    assembler.accept(chunks[3]);

    expect(assembler.missing()).toEqual([1, 2, 4, 5, 6, 7, 8, 9]);
  });

  it('knows nothing is missing before anything has declared a total', () => {
    expect(new HandoffChunkAssembler(ID).missing()).toEqual([]);
  });

  it('discard drops what it held', () => {
    const chunks = chunkHandoffPayload(ID, 'x'.repeat(100), 10);
    const assembler = new HandoffChunkAssembler(ID);
    assembler.accept(chunks[0]);

    assembler.discard();

    expect(assembler.received).toBe(0);
    expect(assembler.expected).toBeUndefined();
  });
});

describe('HANDOFF-001 TC-06 — a mangled chunk is caught where it arrives', () => {
  it('refuses data that is not decodable base64', () => {
    // Buffer.from is lenient: it drops what it cannot parse rather than throwing, so a mangled
    // chunk would silently become a shorter one and corrupt the payload in a way only the final
    // digest catches — after the whole transfer completed.
    const [chunk] = chunkHandoffPayload(ID, 'x'.repeat(30), 10);

    const result = new HandoffChunkAssembler(ID).accept({ ...chunk, data: 'not!valid!base64!' });

    expect(result.rejection).toBe('undecodable');
  });

  it('a corrupt-but-decodable chunk survives here and is caught by the digest', () => {
    // The two checks are deliberately different questions. This one asks "did the pieces arrive";
    // the digest asks "are they the pieces that were sent". Asking the second one per chunk would
    // report each piece intact while the set is not the set that was sent.
    const record = {
      id: 's',
      cwd: '/w',
      createdAt: 'a',
      updatedAt: 'b',
      messages: [],
    } as IInteractiveSessionRecord;
    const { serialized, integrity } = sealHandoffRecord(record);
    const chunks = chunkHandoffPayload(ID, serialized, 16);
    const swapped = chunks.map((c, i) =>
      i === 0 ? { ...c, data: Buffer.from('0'.repeat(16)).toString('base64') } : c,
    );

    const { last } = assemble(swapped);

    expect(last?.outcome).toBe('complete');
    expect(verifyHandoffPayload(last?.serialized ?? '', integrity).intact).toBe(false);
  });

  it('the whole path holds: seal, chunk, reassemble, verify', () => {
    const record = {
      id: 'session_1',
      cwd: '/home/alice/project',
      createdAt: '2026-08-17T00:00:00.000Z',
      updatedAt: '2026-08-17T01:00:00.000Z',
      messages: [{ role: 'user', content: '안녕하세요 😀' }],
    } as unknown as IInteractiveSessionRecord;
    const { serialized, integrity } = sealHandoffRecord(record);

    const { last } = assemble(chunkHandoffPayload(ID, serialized, 24));

    expect(verifyHandoffPayload(last?.serialized ?? '', integrity).intact).toBe(true);
    expect(JSON.parse(last?.serialized ?? '{}')).toEqual(record);
  });
});
