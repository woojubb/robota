import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

import { GOAL_CASSETTE_PATH } from '../../src/testing/__fixtures__/goal-cassette-fixture.js';

it('runs the public SDK replay example without changing the committed cassette', () => {
  const before = readFileSync(GOAL_CASSETTE_PATH);
  const output = execFileSync('pnpm', ['exec', 'tsx', 'examples/verify-goal-cassette-replay.mts'], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    encoding: 'utf8',
    timeout: 20_000,
  });
  expect(output).toContain('status: satisfied');
  expect(output).toContain('stopReason: satisfied');
  expect(output).toContain('GOAL.txt: done');
  expect(output).toContain('Bash');
  expect(output).toContain('report_goal_status');
  expect(readFileSync(GOAL_CASSETTE_PATH)).toEqual(before);
}, 25_000);
