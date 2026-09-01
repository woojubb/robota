import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { userExecutionPlanContractState } from '../user-execution-plan-git-contract.mjs';
import { makeTemp } from './make-temp.mjs';

const root = makeTemp('user-plan-git-contract-');
afterAll(() => rmSync(root, { recursive: true, force: true }));

function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
}

describe('user-execution PLAN Git contract', () => {
  it('finds the unique valid introduction commit', () => {
    const rule = readFileSync(
      path.resolve(import.meta.dirname, '../../../.agents/rules/backlog-execution.md'),
      'utf8',
    );
    mkdirSync(path.join(root, '.agents/rules'), { recursive: true });
    writeFileSync(path.join(root, '.agents/rules/backlog-execution.md'), rule);
    git(['init', '-q']);
    git(['config', 'user.email', 'fixture@example.com']);
    git(['config', 'user.name', 'Fixture']);
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'introduce contract']);

    expect(userExecutionPlanContractState(root)).toMatchObject({ valid: true });
    expect(userExecutionPlanContractState(root).cutovers).toHaveLength(1);
  });
});
