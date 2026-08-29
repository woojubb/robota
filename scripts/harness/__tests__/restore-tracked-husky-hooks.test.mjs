import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { makeTemp } from './make-temp.mjs';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const script = join(root, 'scripts/harness/restore-tracked-husky-hooks.mjs');

describe('restore-tracked-husky-hooks', () => {
  it('restores the tracked fallback contents and executable mode', () => {
    const fixture = makeTemp('robota-husky-');
    mkdirSync(join(fixture, '.husky/_'), { recursive: true });
    const target = join(fixture, '.husky/_/pre-push');
    const fallback = join(fixture, '.husky/_/pre-push.fallback');
    cpSync(join(root, '.husky/_/pre-push.fallback'), fallback);
    const expected = readFileSync(fallback, 'utf8');

    writeFileSync(target, 'stale dispatcher\n');
    chmodSync(target, 0o644);
    execFileSync(process.execPath, [
      '--input-type=module',
      '--eval',
      `
      import { restoreTrackedHuskyHooks } from ${JSON.stringify(script)};
      restoreTrackedHuskyHooks(${JSON.stringify(fixture)});
    `,
    ]);

    expect(readFileSync(target, 'utf8')).toBe(expected);
  });
});
