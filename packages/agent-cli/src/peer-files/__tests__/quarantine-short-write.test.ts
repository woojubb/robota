import { open } from 'node:fs/promises';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { openQuarantineSink } from '../quarantine.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn() };
});

const mockedOpen = vi.mocked(open);

afterEach(() => {
  vi.clearAllMocks();
});

describe('quarantine short writes', () => {
  it('persists the unwritten suffix before accepting the chunk', async () => {
    const stored: Buffer[] = [];
    const write = vi.fn(async (chunk: Buffer, offset: number, length: number) => {
      const written = Math.min(2, length);
      stored.push(Buffer.from(chunk.subarray(offset, offset + written)));
      return { bytesWritten: written, buffer: chunk };
    });
    mockedOpen.mockResolvedValue({
      write,
      sync: vi.fn(),
      close: vi.fn(),
    } as never);
    const sink = await openQuarantineSink({
      ok: true,
      directory: '/private/quarantine',
      name: 'received.txt',
      file: '/private/quarantine/received.txt',
    });

    await sink.write(Buffer.from('approved'));

    expect(Buffer.concat(stored).toString('utf8')).toBe('approved');
    expect(write).toHaveBeenCalledTimes(4);
  });

  it('refuses a zero-progress write instead of accepting truncated content', async () => {
    mockedOpen.mockResolvedValue({
      write: vi.fn(async (chunk: Buffer) => ({ bytesWritten: 0, buffer: chunk })),
      sync: vi.fn(),
      close: vi.fn(),
    } as never);
    const sink = await openQuarantineSink({
      ok: true,
      directory: '/private/quarantine',
      name: 'received.txt',
      file: '/private/quarantine/received.txt',
    });

    await expect(sink.write(Buffer.from('approved'))).rejects.toThrow(/write progress/);
  });
});
