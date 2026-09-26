import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  FILE_CREDIT_WINDOW,
  receiveFileOverChannel,
  sendFileOverChannel,
  type IFileSink,
  type IFileSource,
  type TFileAdmission,
} from '../node/file-transfer.js';

import type { IFileFrameChannel, IFileOffer } from '@robota-sdk/agent-interface-session-mobility';

/** Two ends of an in-memory channel. Frames arrive asynchronously, in order; `sent` records one side. */
function channelPair(): { a: IFileFrameChannel & { sent: string[] }; b: IFileFrameChannel } {
  type TEnd = IFileFrameChannel & {
    sent: string[];
    frames: Set<(frame: string) => void>;
    closes: Set<() => void>;
    closed: boolean;
    other?: TEnd;
  };
  const make = (): TEnd => {
    const end: TEnd = {
      sent: [],
      frames: new Set(),
      closes: new Set(),
      closed: false,
      send(frame) {
        if (end.closed) throw new Error('closed');
        end.sent.push(frame);
        const other = end.other!;
        setImmediate(() => {
          if (!other.closed) for (const handler of other.frames) handler(frame);
        });
      },
      onFrame(handler) {
        end.frames.add(handler);
        return () => end.frames.delete(handler);
      },
      onClose(handler) {
        end.closes.add(handler);
        return () => end.closes.delete(handler);
      },
      close() {
        for (const side of [end, end.other!]) {
          if (side.closed) continue;
          side.closed = true;
          setImmediate(() => {
            for (const handler of side.closes) handler();
          });
        }
      },
    };
    return end;
  };
  const a = make();
  const b = make();
  a.other = b;
  b.other = a;
  return { a, b };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function sourceOf(bytes: Buffer, pieces = 7_000): IFileSource {
  return {
    size: bytes.length,
    async *read() {
      for (let at = 0; at < bytes.length; at += pieces) yield bytes.subarray(at, at + pieces);
    },
  };
}

function memorySink(): IFileSink & { written: Buffer[]; state: 'open' | 'kept' | 'discarded' } {
  const sink = {
    written: [] as Buffer[],
    state: 'open' as 'open' | 'kept' | 'discarded',
    write: async (chunk: Uint8Array) => {
      sink.written.push(Buffer.from(chunk));
    },
    commit: async () => {
      sink.state = 'kept';
      return '/quarantine/file';
    },
    discard: async () => {
      sink.state = 'discarded';
    },
  };
  return sink;
}

function offerFor(bytes: Buffer, over: Partial<IFileOffer> = {}): IFileOffer {
  return { transferId: 't1', name: 'data.bin', size: bytes.length, sha256: sha256(bytes), ...over };
}

describe('file carrier', () => {
  it('moves a file the receiver admits, verified whole', async () => {
    const bytes = Buffer.from(Array.from({ length: 100_000 }, (_, i) => i % 251));
    const { a, b } = channelPair();
    const sink = memorySink();
    const offers: IFileOffer[] = [];
    const [sent, received] = await Promise.all([
      sendFileOverChannel({ channel: a, offer: offerFor(bytes), source: sourceOf(bytes) }),
      receiveFileOverChannel({
        channel: b,
        admit: async (offer) => {
          offers.push(offer);
          return { sink };
        },
      }),
    ]);
    expect(sent).toEqual({ ok: true });
    expect(received).toMatchObject({ ok: true, location: '/quarantine/file' });
    expect(Buffer.concat(sink.written).equals(bytes)).toBe(true);
    expect(sink.state).toBe('kept');
    expect(offers).toEqual([offerFor(bytes)]);
  });

  it('sends no content before the receiver answers, and nothing at all when it refuses', async () => {
    const bytes = Buffer.from('secret-ish');
    const { a, b } = channelPair();
    const [sent, received] = await Promise.all([
      sendFileOverChannel({ channel: a, offer: offerFor(bytes), source: sourceOf(bytes) }),
      receiveFileOverChannel({
        channel: b,
        admit: async (): Promise<TFileAdmission> => ({ refused: 'declined' }),
      }),
    ]);
    expect(sent).toMatchObject({ ok: false, reason: 'declined' });
    expect(received).toMatchObject({ ok: false, reason: 'declined' });
    expect(a.sent.map((frame) => (JSON.parse(frame) as { t: string }).t)).toEqual(['file-offer']);
  });

  it('refuses an offer over the size limit without asking anyone', async () => {
    const bytes = Buffer.alloc(2_000);
    const { a, b } = channelPair();
    let asked = false;
    const [sent, received] = await Promise.all([
      sendFileOverChannel({ channel: a, offer: offerFor(bytes), source: sourceOf(bytes) }),
      receiveFileOverChannel({
        channel: b,
        maxBytes: 1_000,
        admit: async () => {
          asked = true;
          return { sink: memorySink() };
        },
      }),
    ]);
    expect(asked).toBe(false);
    expect(sent).toMatchObject({ ok: false, reason: 'too-large' });
    expect(received).toMatchObject({ ok: false, reason: 'too-large' });
  });

  it('discards content that does not match the offered hash', async () => {
    const bytes = Buffer.from('the real content');
    const { a, b } = channelPair();
    const sink = memorySink();
    const [sent, received] = await Promise.all([
      sendFileOverChannel({
        channel: a,
        offer: offerFor(bytes, { sha256: sha256(Buffer.from('something else')) }),
        source: sourceOf(bytes),
      }),
      receiveFileOverChannel({ channel: b, admit: async () => ({ sink }) }),
    ]);
    expect(received).toMatchObject({ ok: false, reason: 'integrity' });
    expect(sent).toMatchObject({ ok: false, reason: 'integrity' });
    expect(sink.state).toBe('discarded');
  });

  it('discards a transfer the sender abandons midway', async () => {
    const bytes = Buffer.alloc(200_000, 1);
    const { a, b } = channelPair();
    const sink = memorySink();
    const source: IFileSource = {
      size: bytes.length,
      async *read() {
        yield bytes.subarray(0, 50_000);
        throw new Error('disk went away');
      },
    };
    const [sent, received] = await Promise.all([
      sendFileOverChannel({ channel: a, offer: offerFor(bytes), source }),
      receiveFileOverChannel({ channel: b, admit: async () => ({ sink }) }),
    ]);
    expect(sent.ok).toBe(false);
    expect(received).toMatchObject({ ok: false, reason: 'closed' });
    expect(sink.state).toBe('discarded');
  });

  it('keeps no more than the credit window in flight', async () => {
    const bytes = Buffer.alloc(40 * 1024 * 16, 7);
    const { a, b } = channelPair();
    let release: () => void = () => undefined;
    const stalled = new Promise<void>((resolve) => {
      release = resolve;
    });
    let writes = 0;
    const sink: IFileSink = {
      write: async () => {
        writes += 1;
        // The receiver's disk stalls on the first write.
        if (writes === 1) await stalled;
      },
      commit: async () => '/q',
      discard: async () => undefined,
    };
    const sending = sendFileOverChannel({
      channel: a,
      offer: offerFor(bytes),
      source: sourceOf(bytes),
    });
    const receiving = receiveFileOverChannel({ channel: b, admit: async () => ({ sink }) });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const chunks = a.sent.filter((frame) => frame.includes('"file-chunk"')).length;
    expect(chunks).toBe(FILE_CREDIT_WINDOW);
    release();
    await expect(sending).resolves.toEqual({ ok: true });
    await expect(receiving).resolves.toMatchObject({ ok: true });
  });

  it('ends a transfer whose sender ignores its credit', async () => {
    const { a, b } = channelPair();
    const bytes = Buffer.alloc(10);
    const receiving = receiveFileOverChannel({
      channel: b,
      admit: async () => ({
        sink: {
          write: () => new Promise<void>((resolve) => setTimeout(resolve, 50)),
          commit: async () => '',
          discard: async () => undefined,
        },
      }),
    });
    a.onFrame(() => undefined);
    a.send(JSON.stringify({ t: 'file-offer', ...offerFor(bytes, { size: 10 * 1024 * 1024 }) }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    for (let seq = 0; seq < FILE_CREDIT_WINDOW + 5; seq += 1) {
      a.send(JSON.stringify({ t: 'file-chunk', seq, data: Buffer.alloc(16).toString('base64') }));
    }
    await expect(receiving).resolves.toMatchObject({ ok: false, reason: 'protocol' });
  });

  it('passes on a refusal detail only as printable text', async () => {
    const bytes = Buffer.from('x');
    const { a, b } = channelPair();
    b.onFrame(() => {
      b.send(
        JSON.stringify({ t: 'file-refuse', reason: 'declined', detail: 'no\u001b[2J‮thanks' }),
      );
    });
    const sent = await sendFileOverChannel({
      channel: a,
      offer: offerFor(bytes),
      source: sourceOf(bytes),
    });
    expect(sent).toMatchObject({ ok: false, reason: 'declined' });
    const detail = sent.ok ? '' : (sent.detail ?? '');
    expect(detail).toContain('thanks');
    expect([...detail].some((char) => (char.codePointAt(0) ?? 0) < 0x20)).toBe(false);
    expect(detail).not.toContain('‮');
  });

  it('ends a transfer that sends an empty chunk', async () => {
    const { a, b } = channelPair();
    const bytes = Buffer.alloc(10);
    const sink = memorySink();
    const receiving = receiveFileOverChannel({ channel: b, admit: async () => ({ sink }) });
    a.onFrame(() => undefined);
    a.send(JSON.stringify({ t: 'file-offer', ...offerFor(bytes) }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    a.send(JSON.stringify({ t: 'file-chunk', seq: 0, data: '' }));
    await expect(receiving).resolves.toMatchObject({ ok: false, reason: 'protocol' });
    expect(sink.state).toBe('discarded');
  });
});
