/**
 * Issue #2875 — Edit must refuse a file that exceeds its per-operation input ceiling
 * before materializing the whole content, including a source with no stable size
 * (a growing regular file, or a named pipe). A refusal must leave the file unmodified.
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { IToolInvocationResult } from '../types/tool-result.js';

const { createEditTool } = await import('../builtins/edit-tool.js');

async function run(
  tool: ReturnType<typeof createEditTool>,
  params: Record<string, unknown>,
): Promise<IToolInvocationResult> {
  const raw = await tool.execute(params as never);
  return JSON.parse((raw as { data: string }).data) as IToolInvocationResult;
}

describe('Edit bounds its file input before materializing content', () => {
  it('refuses an oversized regular file and leaves it unmodified', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edit-bounded-input-'));
    try {
      const filePath = join(root, 'big.txt');
      const oversized = 'x'.repeat(4 * 1024 * 1024 + 1);
      await writeFile(filePath, oversized, 'utf8');

      const tool = createEditTool({ cwd: root });
      const result = await run(tool, { filePath, oldString: 'x', newString: 'y' });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/limit/i);

      const after = await readFile(filePath, 'utf8');
      expect(after).toBe(oversized);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== 'darwin' && process.platform !== 'linux')(
    'refuses a stale-size input stream before it ends (named pipe)',
    async () => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), 'edit-bounded-pipe-')));
      const pipe = join(root, 'growing.txt');
      const created = spawnSync('mkfifo', [pipe], { encoding: 'utf8' });
      expect(created.error).toBeUndefined();
      expect(created.status, created.stderr).toBe(0);

      // The writer sends more than the file budget and holds the stream open. A
      // whole-file read cannot complete until EOF; a bounded read can reject as
      // soon as it sees the first byte beyond its limit.
      const writer = spawn(
        process.execPath,
        [
          '--input-type=commonjs',
          '-e',
          `const fs = require('node:fs');
           const fd = fs.openSync(process.argv[1], 'w');
           const chunk = Buffer.alloc(64 * 1024, 120);
           for (let i = 0; i < 65; i++) {
             let sent = 0;
             while (sent < chunk.length) sent += fs.writeSync(fd, chunk, sent);
           }
           setInterval(() => {}, 1000);`,
          pipe,
        ],
        { stdio: ['ignore', 'ignore', 'pipe'] },
      );
      let writerError = '';
      writer.on('error', (error) => { writerError = error.message; });
      writer.stderr?.on('data', (chunk: Buffer) => { writerError += chunk.toString(); });

      let watchdog: ReturnType<typeof setTimeout> | undefined;
      try {
        const tool = createEditTool({ cwd: root });
        const execution = run(tool, { filePath: pipe, oldString: 'x', newString: 'y' });
        const outcome = await Promise.race([
          execution.then((result) => (result.success ? 'unexpected success' : result.error ?? '')),
          new Promise<string>((resolve) => {
            watchdog = setTimeout(() => resolve('read waited for EOF'), 5000);
          }),
        ]);
        expect(outcome, writerError).toMatch(/limit/i);
      } finally {
        if (watchdog) clearTimeout(watchdog);
        writer.kill('SIGKILL');
        if (writer.exitCode === null && writer.signalCode === null) {
          await new Promise<void>((resolve) => writer.once('exit', () => resolve()));
        }
        rmSync(root, { recursive: true, force: true });
      }
    },
    10000,
  );

  it('refuses a replaceAll whose output would exceed the ceiling and leaves the file unmodified', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edit-bounded-output-'));
    try {
      const filePath = join(root, 'amplify.txt');
      // Small input, but replaceAll with a much larger newString across many
      // occurrences would produce an output file over the ceiling.
      const original = 'a'.repeat(100_000);
      writeFileSync(filePath, original, 'utf8');

      const tool = createEditTool({ cwd: root });
      const result = await run(tool, {
        filePath,
        oldString: 'a',
        newString: 'y'.repeat(100),
        replaceAll: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/limit/i);

      const after = readFileSync(filePath, 'utf8');
      expect(after).toBe(original);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
