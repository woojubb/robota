import { describe, expect, it, vi } from 'vitest';

const git = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawnSync: git }));

import { validatePostMergePrelude } from '../scan-user-execution-plan-order.mjs';

describe('post-merge ledger reads across HEAD movement without Git fixtures', () => {
  it('reads the new HEAD ledger after a failed history capture is committed', () => {
    const base = 'a'.repeat(40);
    const ledger = '.agents/loop-runs/post-merge-cycle.jsonl';
    const record = (runId, terminal, findings) =>
      JSON.stringify({
        runId,
        opened: '2026-08-25T00:00:00.000Z',
        closed: '2026-08-25T00:01:00.000Z',
        roundFindings: findings,
        terminal,
        ref: `PR #1 MERGE VERIFIED PASS ${base}`,
      }) + '\n';
    const failed = record('r20260825000000', 'halted-for-user', [1]);
    const success = record('r20260825000001', 'converged', [0]);
    let head = '';
    let index = failed;
    git.mockImplementation((command, args) => {
      if (command !== 'git') throw new Error(`unexpected command: ${command}`);
      let stdout;
      if (args[0] === 'show' && args[1] === `HEAD:${ledger}`) stdout = head;
      else if (args[0] === 'show' && args[1] === `:${ledger}`) stdout = index;
      else if (args[0] === 'rev-parse') stdout = base;
      else if (args[0] === 'merge-base') stdout = '';
      else if (args[0] === 'show' && args[1] === '-s') stdout = 'delivered archived pair (#1)';
      else if (args[0] === 'ls-files') stdout = `100644 ${base} 0\t${ledger}\n`;
      else throw new Error(`unexpected Git arguments: ${JSON.stringify(args)}`);
      return { status: 0, stdout, stderr: '' };
    });

    expect(validatePostMergePrelude('/memory-only-ledger', 'HEAD', null, [ledger], base)).toBe(
      false,
    );
    head = failed;
    index = failed + success;
    expect(validatePostMergePrelude('/memory-only-ledger', 'HEAD', null, [ledger], base)).toBe(
      true,
    );
  });
});
