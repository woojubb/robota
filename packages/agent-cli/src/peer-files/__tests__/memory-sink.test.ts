/**
 * The sink a hand-off receiver whose session stores seal keeps the received session in: memory alone,
 * never a file, so no plaintext copy of the session lands beside the sealed one.
 */
import { describe, expect, it } from 'vitest';

import { createMemoryFileSink } from '../quarantine.js';

describe('the memory sink', () => {
  it('keeps committed content in memory, names no file, and hands it over once', async () => {
    const sink = createMemoryFileSink();
    await sink.write(Buffer.from('first chunk'));
    await sink.write(Buffer.from(', second'));

    expect(await sink.commit()).toBe('memory:');
    expect(sink.take().toString('utf8')).toBe('first chunk, second');
    expect(() => sink.take()).toThrow('The memory sink holds no committed content.');
  });

  it('keeps its own copy of each chunk, so a caller reusing its buffer changes nothing kept', async () => {
    const sink = createMemoryFileSink();
    const chunk = Buffer.from('first chunk');
    await sink.write(chunk);
    chunk.fill(0x21);
    await sink.write(Buffer.from(', second'));
    await sink.commit();

    expect(sink.take().toString('utf8')).toBe('first chunk, second');
  });

  it('refuses content past its bound, and holds nothing once discarded', async () => {
    const sink = createMemoryFileSink(8);
    await sink.write(Buffer.from('12345678'));

    await expect(sink.write(Buffer.from('9'))).rejects.toThrow(
      'The content is larger than the memory sink holds.',
    );
    await sink.discard();
    await expect(sink.commit()).rejects.toThrow('The memory sink is no longer open.');
    expect(() => sink.take()).toThrow('The memory sink holds no committed content.');
  });

  it('holds nothing once discarded after its commit', async () => {
    const sink = createMemoryFileSink();
    await sink.write(Buffer.from('the session'));
    await sink.commit();

    await sink.discard();

    expect(() => sink.take()).toThrow('The memory sink holds no committed content.');
  });
});
