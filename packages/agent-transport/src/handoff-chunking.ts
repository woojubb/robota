/**
 * HANDOFF-001 (#1811): moving a session record that does not fit in one frame.
 *
 * A data channel has a maximum message size; a session record is a whole conversation. So the
 * payload travels in pieces, and this owns the two halves of that: cutting it up, and putting it
 * back together in the face of retries, reordering and a peer that says something inconsistent.
 *
 * ## Why the cut is made on BYTES rather than on the string
 *
 * The channel's limit is in bytes, and the serialized record is a JavaScript string — UTF-16 code
 * units, where one character can be one byte or four. Slicing by characters and hoping the pieces
 * fit means either measuring each slice's encoded length anyway, or shipping frames that overflow
 * the channel for anyone whose conversation contains an emoji or a non-Latin script.
 *
 * Cutting the encoded bytes makes the budget exact. It costs base64's third: a byte slice is not a
 * valid string on its own — it can end mid-character — so it cannot ride in a JSON frame as text.
 * That cost is deliberate and is the smaller risk. The alternative works only because
 * `JSON.stringify` has escaped lone surrogates since ES2019; a transfer whose correctness rests on
 * that, and which fails as silent corruption when something in the chain does not, is not a trade
 * worth a third of the bandwidth.
 *
 * ## What this does NOT decide
 *
 * It does not verify the digest. `verifyHandoffPayload` owns that, and asking the same question in
 * two places is how the two answers drift. This reports that all the pieces arrived; whether they
 * are the RIGHT pieces is the next check, and it deliberately runs on the whole reassembled payload
 * rather than per chunk — a per-chunk digest would say each piece is intact while the set is not the
 * set that was sent.
 */

import type { IHandoffIntegrity } from '@robota-sdk/agent-interface-session-mobility';

/**
 * One piece of a payload in flight.
 *
 * `total` travels on every chunk rather than in a separate header frame: a header can be the frame
 * that gets lost, and a receiver that learned the count from a message it never got would wait
 * forever for a number it cannot ask for again.
 */
export interface IHandoffChunk {
  readonly handoffId: string;
  /** 0-based position in the sequence. */
  readonly index: number;
  /** How many chunks make up the whole payload. */
  readonly total: number;
  /** base64 of this slice of the UTF-8 encoded payload. */
  readonly data: string;
}

/**
 * Default frame budget, in bytes of encoded chunk data.
 *
 * 16 KiB because that is the size every SCTP implementation carries without negotiation. Larger
 * works between two peers that both support it and fails between two that do not — and it fails at
 * transfer time, on the user's session, not in a test.
 */
export const DEFAULT_MAX_CHUNK_BYTES = 16 * 1024;

/**
 * Cut a sealed payload into chunks.
 *
 * Takes the serialized string the seal produced, not the record — the digest is over those exact
 * bytes, and re-serializing here would let a chunked payload differ from the one the manifest
 * describes.
 */
export function chunkHandoffPayload(
  handoffId: string,
  serialized: string,
  maxChunkBytes: number = DEFAULT_MAX_CHUNK_BYTES,
): readonly IHandoffChunk[] {
  if (!Number.isInteger(maxChunkBytes) || maxChunkBytes < 1) {
    throw new Error(
      `handoff chunking: maxChunkBytes must be a positive integer, got ${maxChunkBytes}. ` +
        'A zero or negative budget produces an infinite sequence of empty chunks, which presents ' +
        'as a hang rather than as the configuration error it is.',
    );
  }
  const bytes = Buffer.from(serialized, 'utf8');
  // An empty payload is still one chunk. Zero chunks would leave the receiver unable to tell a
  // completed empty transfer from one that never started.
  const total = Math.max(1, Math.ceil(bytes.byteLength / maxChunkBytes));
  const chunks: IHandoffChunk[] = [];
  for (let index = 0; index < total; index += 1) {
    const slice = bytes.subarray(index * maxChunkBytes, (index + 1) * maxChunkBytes);
    chunks.push({ handoffId, index, total, data: slice.toString('base64') });
  }
  return chunks;
}

/** Why a chunk was not accepted. */
export type TChunkRejection =
  /** Belongs to a different transfer. */
  | 'wrong-handoff'
  /** `index` is negative, or beyond the declared `total`. */
  | 'out-of-range'
  /** Its `total` disagrees with what earlier chunks declared. */
  | 'inconsistent-total'
  /** Its `data` is not decodable base64. */
  | 'undecodable';

export type TChunkOutcome =
  /** Stored; more are still needed. */
  | 'accepted'
  /** Already had this index, and it matched. A retry, not a problem. */
  | 'duplicate'
  /** Stored, and that was the last one missing. */
  | 'complete'
  | 'refused';

export interface IChunkResult {
  readonly outcome: TChunkOutcome;
  readonly rejection?: TChunkRejection;
  /** Present when complete: the reassembled payload, ready for the integrity check. */
  readonly serialized?: string;
  /** How many distinct chunks are held. */
  readonly received: number;
  /** How many are expected, once anything has declared it. */
  readonly expected?: number;
}

/**
 * Collects the chunks of ONE transfer.
 *
 * One assembler per `handoffId`, because a shared one would have to key everything by transfer and
 * would then be a place where two transfers can be confused for each other. A chunk naming a
 * different transfer is refused rather than routed — routing is the caller's job and doing it here
 * would make this a dispatcher as well as a buffer.
 */
export class HandoffChunkAssembler {
  private readonly chunks = new Map<number, Buffer>();
  private declaredTotal: number | undefined;

  constructor(private readonly handoffId: string) {}

  get received(): number {
    return this.chunks.size;
  }

  get expected(): number | undefined {
    return this.declaredTotal;
  }

  /** Take one chunk. Reordering and retries are normal; inconsistency is not. */
  accept(chunk: IHandoffChunk): IChunkResult {
    const refuse = (rejection: TChunkRejection): IChunkResult => ({
      outcome: 'refused',
      rejection,
      received: this.chunks.size,
      ...(this.declaredTotal !== undefined ? { expected: this.declaredTotal } : {}),
    });

    if (chunk.handoffId !== this.handoffId) return refuse('wrong-handoff');
    if (!Number.isInteger(chunk.total) || chunk.total < 1) return refuse('inconsistent-total');
    if (this.declaredTotal !== undefined && chunk.total !== this.declaredTotal) {
      // A peer that changes its mind about the size has either restarted the transfer under the
      // same id or is not the peer we started with. Either way the pieces held so far can no longer
      // be assumed to belong together.
      return refuse('inconsistent-total');
    }
    if (!Number.isInteger(chunk.index) || chunk.index < 0 || chunk.index >= chunk.total) {
      return refuse('out-of-range');
    }

    const decoded = Buffer.from(chunk.data, 'base64');
    // Buffer.from is lenient — it drops what it cannot parse rather than throwing, so a mangled
    // chunk would silently become a shorter one and corrupt the payload in a way only the final
    // digest would catch, after the whole transfer completed. Re-encoding is how the leniency is
    // detected here instead.
    if (decoded.toString('base64') !== chunk.data) return refuse('undecodable');

    this.declaredTotal = chunk.total;
    const held = this.chunks.get(chunk.index);
    if (held !== undefined) {
      // A retry re-sending the same bytes is normal. Different bytes for the same index is the
      // inconsistent case again, and the same reasoning applies.
      if (held.equals(decoded)) {
        return { outcome: 'duplicate', received: this.chunks.size, expected: chunk.total };
      }
      return refuse('inconsistent-total');
    }

    this.chunks.set(chunk.index, decoded);
    if (this.chunks.size < chunk.total) {
      return { outcome: 'accepted', received: this.chunks.size, expected: chunk.total };
    }
    return {
      outcome: 'complete',
      serialized: this.reassemble(chunk.total),
      received: this.chunks.size,
      expected: chunk.total,
    };
  }

  /** Which indices are still missing, so a caller can ask for them rather than restarting. */
  missing(): readonly number[] {
    if (this.declaredTotal === undefined) return [];
    const gaps: number[] = [];
    for (let i = 0; i < this.declaredTotal; i += 1) if (!this.chunks.has(i)) gaps.push(i);
    return gaps;
  }

  /** Drop everything held. The transfer was abandoned, or its integrity check failed. */
  discard(): void {
    this.chunks.clear();
    this.declaredTotal = undefined;
  }

  private reassemble(total: number): string {
    const ordered: Buffer[] = [];
    for (let i = 0; i < total; i += 1) {
      const part = this.chunks.get(i);
      if (part === undefined) {
        // Unreachable: size equalled total and every index was range-checked on the way in. Stated
        // as an error rather than a non-null assertion, because the assertion would be the thing
        // that hid it if the invariant ever broke.
        throw new Error(`handoff chunking: chunk ${i} of ${total} is missing at reassembly.`);
      }
      ordered.push(part);
    }
    return Buffer.concat(ordered).toString('utf8');
  }
}

/**
 * How many chunks a payload of this size will take, without building them.
 *
 * For a progress indicator at the sending end, and for a receiver deciding whether it is willing to
 * hold that much before the first chunk arrives.
 */
export function chunkCountFor(
  integrity: IHandoffIntegrity,
  maxChunkBytes: number = DEFAULT_MAX_CHUNK_BYTES,
): number {
  return Math.max(1, Math.ceil(integrity.byteLength / maxChunkBytes));
}
