import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../../..');
const gate = path.join(root, 'scripts/harness/gate.mjs');
const document = path.join(
  root,
  '.agents/spec-docs/draft/HARNESS-096-a-done-spec-doc-never-checks-that-its-task-agrees.md',
);

describe('gate.mjs compatibility facade', () => {
  it('keeps the judge subcommand and its gate-labelled stdout contract', () => {
    const result = spawnSync(
      process.execPath,
      [gate, 'judge', '--gate', 'GATE-WRITE', '--doc', document, '--dry-run'],
      { cwd: root, encoding: 'utf8' },
    );
    expect(result.status).not.toBeNull();
    expect(`${result.stdout}\n${result.stderr}`).toContain('gate GATE-WRITE');
  });

  it('does not execute the CLI when imported as a library', () => {
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', `await import(${JSON.stringify(gate)});`],
      { cwd: root, encoding: 'utf8' },
    );
    expect(result.status).toBe(0);
    expect(`${result.stdout}${result.stderr}`).toBe('');
  });
});
