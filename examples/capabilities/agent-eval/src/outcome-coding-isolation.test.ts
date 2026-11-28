import assert from 'node:assert/strict';
import type { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { runIsolationCanaries } from './outcome-coding-isolation.js';
import { CODING_TASKS } from './outcome-coding-tasks.js';

test('a canary container whose client timed out is removed by name', () => {
  const base = mkdtempSync(join(tmpdir(), 'canary-test-'));
  const calls: string[][] = [];
  // A docker client that never answers in time: the status is null and the error is a timeout.
  const timedOut = ((_command: string, args: string[]) => {
    calls.push(args);
    return {
      status: null,
      stdout: '',
      stderr: '',
      error: Object.assign(new Error('spawnSync docker ETIMEDOUT'), { code: 'ETIMEDOUT' }),
    };
  }) as unknown as typeof spawnSync;
  try {
    assert.throws(
      () =>
        runIsolationCanaries({
          image: 'img',
          baseDir: base,
          task: CODING_TASKS[0] as (typeof CODING_TASKS)[number],
          docker: timedOut,
        }),
      /reported nothing/,
    );
    const run = calls[0] as string[];
    const name = run[run.indexOf('--name') + 1] as string;
    assert.match(name, /^robota-eval-canary-/);
    assert.deepEqual(calls.at(-1), ['rm', '-f', name]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
