import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

const observation = vi.hoisted(() => ({ file: '', peak: 0 }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const open = (async (...args: Parameters<typeof actual.open>) => {
    const handle = await actual.open(...args);
    if (args[0] === observation.file) {
      const read = handle.read.bind(handle);
      Object.defineProperty(handle, 'read', {
        configurable: true,
        value: async (buffer: Buffer, offset: number, length: number, position: number | null) => {
          const result = await read(buffer, offset, Math.min(length, 1), position);
          observation.peak = Math.max(observation.peak, process.memoryUsage().external);
          return result;
        },
      });
    }
    return handle;
  }) as typeof actual.open;
  return { ...actual, open };
});

import { createEditTool } from '../edit-tool.js';

it('bounds memory when the input arrives one byte at a time', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'edit-partial-'));
  const file = join(directory, 'note');
  try {
    writeFileSync(file, 'x'.repeat(4096));
    observation.file = file;
    const before = process.memoryUsage().external;
    observation.peak = before;
    const result = await createEditTool({ cwd: directory }).execute({
      filePath: file, oldString: 'x', newString: 'y', replaceAll: true,
    });
    expect(JSON.parse(String(result.data))).toMatchObject({ success: true });
    expect(readFileSync(file, 'utf8')).toBe('y'.repeat(4096));
    expect(observation.peak - before).toBeLessThan(32 * 1024 * 1024);
  } finally {
    observation.file = '';
    rmSync(directory, { recursive: true, force: true });
  }
}, 15_000);
