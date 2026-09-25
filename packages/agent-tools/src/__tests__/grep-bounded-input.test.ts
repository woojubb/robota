import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ pipe: '' }));

// A pipe has no stable size. Present it as a regular file with stale size metadata
// to exercise the same read path as a regular file that grows after stat().
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    stat: async (path: string) => {
      const result = await actual.stat(path);
      if (path === fixture.pipe) Object.assign(result, { size: 0, isFile: () => true });
      return result;
    },
  };
});

const { createGrepTool } = await import('../builtins/grep-tool.js');

it.skipIf(process.platform !== 'darwin' && process.platform !== 'linux')(
  'rejects a stale-size input stream before it ends',
  async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'grep-bounded-input-')));
    const pipe = join(root, 'growing.txt');
    fixture.pipe = pipe;
    const created = spawnSync('mkfifo', [pipe], { encoding: 'utf8' });
    expect(created.error).toBeUndefined();
    expect(created.status, created.stderr).toBe(0);

    // The writer sends more than the file budget and deliberately holds the
    // stream open. A whole-file read cannot complete until EOF; a bounded read
    // can reject as soon as it sees the first byte beyond its limit.
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

    const controller = new AbortController();
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    try {
      const tool = createGrepTool({ cwd: root, signal: controller.signal });
      const execution = tool.execute({ pattern: 'x', path: pipe, outputMode: 'count' });
      const outcome = await Promise.race([
        execution.then(
          () => 'unexpected success',
          (error: unknown) => error instanceof Error ? error.message : String(error),
        ),
        new Promise<string>((resolve) => {
          watchdog = setTimeout(() => resolve('read waited for EOF'), 5000);
        }),
      ]);
      if (outcome === 'read waited for EOF') controller.abort();
      expect(outcome, writerError).toContain('Grep search exceeded its byte limit');
    } finally {
      if (watchdog) clearTimeout(watchdog);
      controller.abort();
      writer.kill('SIGKILL');
      if (writer.exitCode === null && writer.signalCode === null) {
        await new Promise<void>((resolve) => writer.once('exit', () => resolve()));
      }
      fixture.pipe = '';
      rmSync(root, { recursive: true, force: true });
    }
  },
  10000,
);
