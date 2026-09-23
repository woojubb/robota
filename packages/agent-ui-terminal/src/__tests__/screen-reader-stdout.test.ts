/**
 * SCREEN-2670 TC-02 / TC-03 / TC-04 / TC-06 / TC-11 — the owned write path.
 *
 * The unit under test is a COMMIT: what Ink writes in one synchronous run must leave the proxy
 * contiguously, with the interval BEFORE the batch and none inside it. The echo flag is consumed
 * when a batch opens and expires on `setImmediate`; the surplus-token case (an arm with no commit
 * behind it) is asserted, not assumed. Dropped batches settle their callbacks; the barrier is never
 * dropped; control-only batches add no park; the first batch of a session is never parked.
 */

import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createParkedStdout } from '../screen-reader-stdout.js';

import type { TParkedStdoutSource } from '../screen-reader-stdout.js';

interface IWritten {
  text: string;
  at: number;
}

class FakeStdout extends EventEmitter {
  readonly isTTY = true;
  readonly columns = 100;
  readonly rows = 32;
  readonly destroyed = false;
  readonly writable = true;
  readonly writableEnded = false;
  writableLength = 0;
  writableNeedDrain = false;
  readonly written: IWritten[] = [];
  failNext: Error | undefined;
  write = (
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
    maybeCallback?: (error?: Error | null) => void,
  ): boolean => {
    const callback = typeof encodingOrCallback === 'function' ? encodingOrCallback : maybeCallback;
    this.written.push({ text: String(chunk), at: Date.now() });
    const error = this.failNext;
    this.failNext = undefined;
    callback?.(error ?? null);
    return !this.writableNeedDrain;
  };
  asSource(): TParkedStdoutSource {
    return this as unknown as TParkedStdoutSource;
  }
}

/**
 * Run the nextTick queue (batch close), let a REAL setImmediate pass (the echo flag's expiry runs on
 * the real check phase, exactly as in production), then any due fake timers.
 */
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => process.nextTick(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
  await vi.advanceTimersByTimeAsync(0);
}

/** One screen-reader commit as ink.js:371-412 writes it: BSU, static erase, frame, ESU. */
const BSU = '\x1b[?2026h';
const ESU = '\x1b[?2026l';
const ERASE = '\x1b[1A\x1b[2K\x1b[G';

function commit(stdout: ReturnType<typeof createParkedStdout>, text: string): void {
  stdout.write(BSU);
  stdout.write(`${ERASE}${text}\n`);
  stdout.write(ESU);
}

let fake: FakeStdout;

beforeEach(() => {
  // Only the park's clock is faked; nextTick and setImmediate keep their real ordering.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  fake = new FakeStdout();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TC-11: the first batch of a session is released with no park; the second is parked', () => {
  it('writes the first commit immediately and parks the next one for the whole interval', async () => {
    const parked = createParkedStdout({ stdout: fake.asSource(), preparkMs: 250 });
    commit(parked, 'first');
    await settle();
    expect(fake.written.map((w) => w.text)).toEqual([BSU, `${ERASE}first\n`, ESU]);

    commit(parked, 'second');
    await settle();
    expect(fake.written).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(249);
    expect(fake.written).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(fake.written.map((w) => w.text).slice(3)).toEqual([BSU, `${ERASE}second\n`, ESU]);
  });
});

describe('TC-02: the unit is a COMMIT — chunks of one run leave contiguously', () => {
  it('parks once BEFORE the batch and puts no interval between its chunks', async () => {
    const parked = createParkedStdout({ stdout: fake.asSource(), preparkMs: 250 });
    commit(parked, 'prime');
    await settle();
    const primedAt = Date.now();

    commit(parked, 'reply');
    await settle();
    await vi.advanceTimersByTimeAsync(250);

    const released = fake.written.slice(3);
    expect(released.map((w) => w.text)).toEqual([BSU, `${ERASE}reply\n`, ESU]);
    // The interval sits in front of the batch …
    expect(released[0]?.at).toBe(primedAt + 250);
    // … and nowhere inside it: a synchronized-output pair and a <Static> erase are never split.
    expect(new Set(released.map((w) => w.at)).size).toBe(1);
  });
});

describe('TC-03: the echo release — scope is the handler`s, formation and expiry are the proxy`s', () => {
  it('releases a batch stamped while armed without a park, and parks the next one again', async () => {
    const parked = createParkedStdout({ stdout: fake.asSource(), preparkMs: 250 });
    commit(parked, 'prime');
    await settle();

    parked.armEchoRelease();
    commit(parked, 'echo: h');
    await settle();
    expect(fake.written.map((w) => w.text)).toContain(`${ERASE}echo: h\n`);

    commit(parked, 'assistant line');
    await settle();
    expect(fake.written.map((w) => w.text)).not.toContain(`${ERASE}assistant line\n`);
    await vi.advanceTimersByTimeAsync(250);
    expect(fake.written.map((w) => w.text)).toContain(`${ERASE}assistant line\n`);
  });

  it('keeps the exemption on a batch stamped at formation even when it waits behind a parked one', async () => {
    const parked = createParkedStdout({ stdout: fake.asSource(), preparkMs: 250 });
    commit(parked, 'prime');
    await settle();
    commit(parked, 'streaming token');
    await settle();
    // The reply batch is parked; a keystroke batch forms behind it while the flag is armed.
    parked.armEchoRelease();
    commit(parked, 'echo: h');
    await settle();
    // Both are still waiting: FIFO order is untouched, so the echo does not overtake the reply …
    expect(fake.written).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(250);
    // … and when the reply releases, the echo follows at once with no second park.
    const texts = fake.written.map((w) => w.text);
    expect(texts.indexOf(`${ERASE}streaming token\n`)).toBeLessThan(
      texts.indexOf(`${ERASE}echo: h\n`),
    );
    expect(texts).toContain(`${ERASE}echo: h\n`);
  });

  it('arms at most one batch per turn, and an arm with no batch behind it expires', async () => {
    const parked = createParkedStdout({ stdout: fake.asSource(), preparkMs: 250 });
    commit(parked, 'prime');
    await settle();

    // Three arms in one turn, then a commit: one exemption.
    parked.armEchoRelease();
    parked.armEchoRelease();
    parked.armEchoRelease();
    commit(parked, 'echo: a');
    await settle();
    expect(fake.written.map((w) => w.text)).toContain(`${ERASE}echo: a\n`);
    await vi.advanceTimersByTimeAsync(0);

    // An arm that commits nothing: the flag must be gone by the time the next turn's batch forms.
    parked.armEchoRelease();
    await new Promise<void>((resolve) => setImmediate(resolve));
    commit(parked, 'transcript line');
    await settle();
    expect(fake.written.map((w) => w.text)).not.toContain(`${ERASE}transcript line\n`);
    await vi.advanceTimersByTimeAsync(250);
    expect(fake.written.map((w) => w.text)).toContain(`${ERASE}transcript line\n`);
  });
});

describe('TC-04: ordering, callbacks, backpressure and early release', () => {
  it('fires every callback exactly once, after the underlying write, with its error', async () => {
    const parked = createParkedStdout({ stdout: fake.asSource(), preparkMs: 250 });
    const seen: Array<Error | null | undefined> = [];
    parked.write('first\n', (error) => seen.push(error));
    await settle();
    expect(seen).toEqual([null]);

    fake.failNext = new Error('EPIPE');
    parked.write('second\n', (error) => seen.push(error));
    await settle();
    expect(seen).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(250);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toBeInstanceOf(Error);
  });

  it('never drops a batch: a newer printable commit releases the older parked one at once, in order', async () => {
    const parked = createParkedStdout({ stdout: fake.asSource(), preparkMs: 250 });
    commit(parked, 'prime');
    await settle();

    const settledCallbacks: string[] = [];
    parked.write('redraw 1\n', () => settledCallbacks.push('redraw 1'));
    await settle();
    parked.write('', () => settledCallbacks.push('barrier'));
    await settle();
    // Nothing yet: redraw 1 is parked and the barrier waits behind it.
    expect(fake.written).toHaveLength(3);

    parked.write('redraw 2\n', () => settledCallbacks.push('redraw 2'));
    await settle();
    // redraw 1 and the barrier were released the moment redraw 2 closed — Ink's erase bookkeeping
    // and its once-only Static writes both assume redraw 1 reached the terminal.
    const texts = fake.written.map((w) => w.text);
    expect(texts.slice(3)).toEqual(['redraw 1\n', '']);
    expect(settledCallbacks).toEqual(['redraw 1', 'barrier']);
    // redraw 2 is the one that waits: at most one batch is ever parked.
    await vi.advanceTimersByTimeAsync(250);
    expect(fake.written.map((w) => w.text).at(-1)).toBe('redraw 2\n');
    expect(settledCallbacks).toEqual(['redraw 1', 'barrier', 'redraw 2']);
  });

  it('reads the underlying backpressure through, and delegates writableLength', () => {
    const parked = createParkedStdout({ stdout: fake.asSource(), preparkMs: 250 });
    expect(parked.write('x')).toBe(true);
    fake.writableNeedDrain = true;
    expect(parked.write('y')).toBe(false);
    fake.writableLength = 42;
    expect(parked.asInkStdout().writableLength).toBe(42);
  });

  it('releases a control-only batch without a park while keeping it behind a pending one', async () => {
    const parked = createParkedStdout({ stdout: fake.asSource(), preparkMs: 250 });
    commit(parked, 'prime');
    await settle();
    commit(parked, 'reply');
    await settle();
    parked.write('\x1b]133;A\x07');
    await settle();
    // Nothing yet: the mark waits behind the parked reply rather than overtaking it.
    expect(fake.written).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(250);
    const texts = fake.written.map((w) => w.text);
    expect(texts.indexOf(`${ERASE}reply\n`)).toBeLessThan(texts.indexOf('\x1b]133;A\x07'));
    // And it added no interval of its own: the mark left in the same tick as the reply.
    expect(fake.written.at(-1)?.at).toBe(fake.written.at(-2)?.at);
  });
});

describe('TC-06: dimensions, resize, identity and teardown', () => {
  it('reads columns/rows/isTTY through and forwards a resize listener to the real stream', () => {
    const parked = createParkedStdout({ stdout: fake.asSource(), preparkMs: 250 });
    const ink = parked.asInkStdout();
    expect(ink.columns).toBe(100);
    expect(ink.rows).toBe(32);
    expect(ink.isTTY).toBe(true);
    const onResize = vi.fn();
    ink.on('resize', onResize);
    fake.emit('resize');
    expect(onResize).toHaveBeenCalledTimes(1);
    ink.off('resize', onResize);
    fake.emit('resize');
    expect(onResize).toHaveBeenCalledTimes(1);
  });

  it('is one stable object for the session — Ink keys its instance map by it', () => {
    const parked = createParkedStdout({ stdout: fake.asSource(), preparkMs: 250 });
    expect(parked.asInkStdout()).toBe(parked.asInkStdout());
  });

  it('drain() releases what is parked for a terminal handoff and keeps parking afterwards', async () => {
    const parked = createParkedStdout({ stdout: fake.asSource(), preparkMs: 5000 });
    commit(parked, 'prime');
    await settle();
    commit(parked, 'before the handoff');
    await settle();
    expect(fake.written).toHaveLength(3);
    await parked.drain();
    expect(fake.written.map((w) => w.text)).toContain(`${ERASE}before the handoff\n`);
    // Not terminal: the next printable commit is parked again.
    commit(parked, 'after the handoff');
    await settle();
    expect(fake.written.map((w) => w.text)).not.toContain(`${ERASE}after the handoff\n`);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fake.written.map((w) => w.text)).toContain(`${ERASE}after the handoff\n`);
  });

  it('flush() releases what is still parked, in order, and resolves only after it is written', async () => {
    const parked = createParkedStdout({ stdout: fake.asSource(), preparkMs: 5000 });
    commit(parked, 'prime');
    await settle();
    commit(parked, 'last frame of the session');
    await settle();
    expect(fake.written).toHaveLength(3);
    await parked.flush();
    expect(fake.written.map((w) => w.text)).toContain(`${ERASE}last frame of the session\n`);
  });
});

describe('preparkMs 0 disables the park exactly', () => {
  it('releases every batch as it closes, in order', async () => {
    const parked = createParkedStdout({ stdout: fake.asSource(), preparkMs: 0 });
    commit(parked, 'one');
    await settle();
    commit(parked, 'two');
    await settle();
    expect(fake.written.map((w) => w.text)).toEqual([
      BSU,
      `${ERASE}one\n`,
      ESU,
      BSU,
      `${ERASE}two\n`,
      ESU,
    ]);
  });
});
