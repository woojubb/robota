import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { checkpointEvidenceContractState } from '../checkpoint-evidence-git-contract.mjs';
import { makeTemp } from './make-temp.mjs';

const root = makeTemp('checkpoint-git-contract-');
afterAll(() => rmSync(root, { recursive: true, force: true }));

function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
}

describe('checkpoint evidence Git contract', () => {
  it('finds the unique v1 compatibility cutover', () => {
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

    expect(checkpointEvidenceContractState(root)).toMatchObject({ valid: true });
    expect(checkpointEvidenceContractState(root).cutovers).toHaveLength(1);
  });
});
