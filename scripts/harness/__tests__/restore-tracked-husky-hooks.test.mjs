import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { restoreTrackedHuskyHooks } from '../restore-tracked-husky-hooks.mjs';
import { makeTemp } from './make-temp.mjs';

const root = fileURLToPath(new URL('../../..', import.meta.url));

describe('restore-tracked-husky-hooks', () => {
  it('tracks every fresh-worktree dispatcher and fallback as executable', () => {
    const files = [
      '.husky/_/post-checkout',
      '.husky/_/post-checkout.fallback',
      '.husky/_/prepare-commit-msg',
      '.husky/_/prepare-commit-msg.fallback',
    ];
    const entries = execFileSync('git', ['ls-files', '--stage', '--', ...files], {
      cwd: root,
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .filter(Boolean);

    expect(entries).toHaveLength(files.length);
    expect(entries.every((entry) => entry.startsWith('100755 '))).toBe(true);
  });

  it('restores the tracked fallback contents and executable mode', () => {
    const fixture = makeTemp('robota-husky-');
    mkdirSync(join(fixture, '.husky/_'), { recursive: true });
    const names = ['post-checkout', 'prepare-commit-msg', 'pre-push'];
    for (const name of names) {
      const target = join(fixture, `.husky/_/${name}`);
      const fallback = join(fixture, `.husky/_/${name}.fallback`);
      cpSync(join(root, `.husky/_/${name}.fallback`), fallback);
      writeFileSync(target, 'stale dispatcher\n');
      chmodSync(target, 0o644);
    }
    restoreTrackedHuskyHooks(fixture);

    for (const name of names) {
      const target = join(fixture, `.husky/_/${name}`);
      expect(readFileSync(target, 'utf8')).toBe(
        readFileSync(join(fixture, `.husky/_/${name}.fallback`), 'utf8'),
      );
      expect(statSync(target).mode & 0o777).toBe(0o755);
    }
  });
});
