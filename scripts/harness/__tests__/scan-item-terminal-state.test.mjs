import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findTerminalStateFindings } from '../scan-item-terminal-state.mjs';

function fixture(status = 'in-progress') {
  const root = path.join(os.tmpdir(), `rule-025-${Date.now()}-${Math.random()}`);
  mkdirSync(path.join(root, '.agents/tasks'), { recursive: true });
  writeFileSync(
    path.join(root, '.agents/tasks/RULE-025-example.md'),
    `---\nstatus: ${status}\ncreated: 2020-01-01\n---\n`,
  );
  return root;
}

describe('item-terminal-state', () => {
  it('finds aged in-progress tasks with a merged delivery citation', () => {
    const root = fixture();
    const findings = findTerminalStateFindings(root, {
      ageDays: () => 10,
      commits: [{ sha: 'abc', subject: 'feat: RULE-025 delivery' }],
      changedPaths: () => ['scripts/harness/example.mjs'],
      ref: 'origin/develop',
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe('item-terminal-state');
  });

  it('does not flag terminal tasks', () => {
    const root = fixture('done');
    expect(
      findTerminalStateFindings(root, {
        ageDays: () => 10,
        commits: [{ sha: 'abc', subject: 'feat: RULE-025 delivery' }],
        changedPaths: () => ['scripts/harness/example.mjs'],
      }),
    ).toEqual([]);
  });
});
