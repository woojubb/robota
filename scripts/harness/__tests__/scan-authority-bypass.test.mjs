import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { findAuthorityBypasses } from '../scan-authority-bypass.mjs';

/**
 * The scan exists because a rule only a careful reader enforces is a rule that recurs.
 *
 * Measured: in one change (DAG-001, PR #1600) a status literal written past the state machine
 * appeared FIVE times across eight review rounds. Each was found by a reader, fixed at that one
 * site, and reappeared at the next — the fourth round fixed a literal `'cancelled'`, and the fifth
 * found two literal `'failed'` writes in the same function, untouched.
 *
 * These cases are the reverse-direction ones the repo's own vacuity work asks for: a check that
 * cannot fail is worse than no check, so what matters most here is that the scan FAILS on the
 * defects it exists for.
 */
const RULE = {
  writer: 'updateTaskRunStatus',
  argumentIndex: 1,
  authority: 'StateMachine.transition(...)',
  reason: 'The table is the single place the legal transitions live.',
};

function scan(source, rules = [RULE]) {
  return findAuthorityBypasses(['f.ts'], rules, () => source);
}

describe('scan-authority-bypass', () => {
  it('reverse (RED): a literal in the governed argument FAILS', () => {
    const found = scan(`await storage.updateTaskRunStatus(id, 'failed', error);`);
    expect(found).toHaveLength(1);
    expect(found[0]?.literal).toBe("'failed'");
  });

  it('reverse (RED): catches the exact two shapes review found in DAG-001', () => {
    const source = [
      `await storage.updateTaskRunStatus(taskRun.taskRunId, 'failed', error);`,
      `await storage.updateTaskRunStatus(taskRun.taskRunId, 'cancelled', { code: 'X' });`,
    ].join('\n');
    expect(scan(source).map((f) => f.literal)).toEqual(["'failed'", "'cancelled'"]);
  });

  it('a value derived from the authority PASSES', () => {
    const source = `await storage.updateTaskRunStatus(id, transition.value.nextStatus, error);`;
    expect(scan(source)).toEqual([]);
  });

  it('a literal in an UNgoverned argument position is not a finding', () => {
    // The first argument is an id, not a status. A scan that fired on any literal anywhere would be
    // suppressed rather than obeyed.
    expect(scan(`await storage.updateTaskRunStatus('task-1', next, error);`)).toEqual([]);
  });

  it('an object literal containing a string is not a bare literal', () => {
    const source = `await storage.updateTaskRunStatus(id, next, { code: 'DAG_X', retryable: false });`;
    expect(scan(source)).toEqual([]);
  });

  it('does not match a longer identifier that merely ends with the writer name', () => {
    expect(scan(`await myUpdateTaskRunStatus(id, 'failed');`)).toEqual([]);
  });

  it('still matches when the call is a plain function rather than a method', () => {
    expect(scan(`await updateTaskRunStatus(id, 'failed');`)).toHaveLength(1);
  });

  it('reports the line, so the finding points at the site rather than the file', () => {
    const source = ['const a = 1;', 'const b = 2;', `updateTaskRunStatus(id, 'failed');`].join(
      '\n',
    );
    expect(scan(source)[0]?.line).toBe(3);
  });

  it('a nested call in an earlier argument does not shift the governed position', () => {
    // `splitArgs` must not split inside `resolveId(a, b)`, or argument 1 would be read as `b)`.
    expect(scan(`updateTaskRunStatus(resolveId(a, b), 'failed');`)).toHaveLength(1);
  });

  it('examines nothing, and says so, when no rules are configured', () => {
    expect(scan(`updateTaskRunStatus(id, 'failed');`, [])).toEqual([]);
  });

  /**
   * The registered path, not just the exported function. A scan that works when imported and is
   * never invoked is the declared-but-unreachable shape this repo's audit is about.
   */
  it('is registered in run-all-scans and passes on the live repository', () => {
    const root = path.resolve(import.meta.dirname, '../../..');
    const registry = execFileSync(
      'node',
      ['-e', "console.log(require('fs').readFileSync('scripts/harness/run-all-scans.mjs','utf8'))"],
      {
        cwd: root,
        encoding: 'utf8',
      },
    );
    expect(registry).toContain('scan-authority-bypass.mjs');

    const output = execFileSync('node', ['scripts/harness/scan-authority-bypass.mjs'], {
      cwd: root,
      encoding: 'utf8',
    });
    // A pass that examined nothing is not a pass — assert the count it reports.
    expect(output).toMatch(/authority-bypass scan passed \((\d+) file\(s\)/);
    const examined = Number(/passed \((\d+) file/.exec(output)?.[1] ?? '0');
    expect(examined).toBeGreaterThan(0);
  });
});
