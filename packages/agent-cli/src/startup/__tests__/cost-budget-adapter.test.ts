import {
  constants,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { COST_BUDGET_FILE, createFileCostBudgetAdapter } from '../cost-budget-adapter.js';

/**
 * CMD-007 (issue #2058): the file adapter owns this product's budget storage policy — the path, the
 * unconditional (no check-then-use) write, and the symlink refusal — moved here from the command.
 */
describe('createFileCostBudgetAdapter', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'robota-budget-adapter-'));
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('reads no budget from an absent, empty, malformed or non-numeric document', () => {
    const adapter = createFileCostBudgetAdapter(cwd);
    expect(adapter.read()).toBeUndefined();
    mkdirSync(join(cwd, '.robota'), { recursive: true });
    for (const contents of ['{}', 'not json', '[5]', '{"monthly":"5"}']) {
      writeFileSync(join(cwd, COST_BUDGET_FILE), contents);
      expect(adapter.read()).toBeUndefined();
    }
  });

  it('persists a budget across adapter instances (set, restart, read) and clears to an empty document', () => {
    createFileCostBudgetAdapter(cwd).write({ monthly: 5 });
    const restarted = createFileCostBudgetAdapter(cwd);
    expect(restarted.read()).toEqual({ monthly: 5 });
    restarted.clear();
    expect(readFileSync(join(cwd, COST_BUDGET_FILE), 'utf-8')).toBe('{}');
    expect(restarted.read()).toBeUndefined();
  });

  it('clears a project that never had the file without checking first (CodeQL js/file-system-race)', () => {
    expect(() => createFileCostBudgetAdapter(cwd).clear()).not.toThrow();
    expect(readFileSync(join(cwd, COST_BUDGET_FILE), 'utf-8')).toBe('{}');
  });

  it.skipIf(constants.O_NOFOLLOW === undefined)(
    'refuses to write through a symbolic link with a typed failure naming why',
    () => {
      const outside = join(cwd, 'outside.txt');
      writeFileSync(outside, 'ORIGINAL');
      mkdirSync(join(cwd, '.robota'), { recursive: true });
      symlinkSync(outside, join(cwd, COST_BUDGET_FILE));
      const adapter = createFileCostBudgetAdapter(cwd);
      expect(() => adapter.write({ monthly: 5 })).toThrow(/symbolic link/);
      expect(() => adapter.clear()).toThrow(/symbolic link/);
      expect(readFileSync(outside, 'utf-8')).toBe('ORIGINAL');
    },
  );
});
