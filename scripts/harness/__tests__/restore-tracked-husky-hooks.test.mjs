import { execFileSync } from 'node:child_process';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const script = join(root, 'scripts/harness/restore-tracked-husky-hooks.mjs');

describe('restore-tracked-husky-hooks', () => {
  it('restores the tracked fallback contents and executable mode', () => {
    const target = join(root, '.husky/_/pre-push');
    const fallback = join(root, '.husky/_/pre-push.fallback');
    const expected = readFileSync(fallback, 'utf8');

    writeFileSync(target, 'stale dispatcher\n');
    chmodSync(target, 0o644);
    execFileSync(process.execPath, [script], { cwd: root });

    expect(readFileSync(target, 'utf8')).toBe(expected);
  });
});
