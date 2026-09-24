import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ slowReadStarted: false, slowReadAborted: false }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: (file: string, options?: { signal?: AbortSignal }) => {
      if (!file.endsWith('slow.txt')) return actual.readFile(file, options);
      state.slowReadStarted = true;
      return new Promise<Buffer>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => {
          state.slowReadAborted = true;
          reject(new Error('read aborted'));
        }, { once: true });
      });
    },
  };
});

const { createGrepTool } = await import('../builtins/grep-tool.js');

it('aborts and joins an in-flight read before returning cancellation', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'grep-join-')));
  try {
    writeFileSync(join(root, 'bad.txt'), 'x');
    writeFileSync(join(root, 'slow.txt'), 'x');
    const controller = new AbortController();
    const tool = createGrepTool({ cwd: root, signal: controller.signal });
    const execution = tool.execute({ pattern: 'x', path: root, outputMode: 'count' });
    await vi.waitFor(() => expect(state.slowReadStarted).toBe(true));
    controller.abort();
    const outcome = await Promise.race([
      execution.then(
        () => 'unexpected success',
        (error: unknown) => error instanceof Error ? error.message : String(error),
      ),
      new Promise<string>((resolve) => setTimeout(() => resolve('not joined'), 1000)),
    ]);
    expect(outcome).toContain('Grep search cancelled');
    expect(state.slowReadAborted).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
