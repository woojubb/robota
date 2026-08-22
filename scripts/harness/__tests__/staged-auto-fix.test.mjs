import { readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const LOCKED_STAGED_FIX_COMMAND = 'scripts/harness/with-repo-lock.sh pnpm exec lint-staged';

function repositoryContract() {
  return {
    hook: readFileSync(path.join(WORKSPACE_ROOT, '.husky/pre-commit'), 'utf8'),
    lintStaged: JSON.parse(readFileSync(path.join(WORKSPACE_ROOT, '.lintstagedrc.json'), 'utf8')),
    packageJson: JSON.parse(readFileSync(path.join(WORKSPACE_ROOT, 'package.json'), 'utf8')),
    workflow: readFileSync(
      path.join(WORKSPACE_ROOT, '.agents/skills/post-implementation-checklist/SKILL.md'),
      'utf8',
    ),
  };
}

function contractProblems({ hook, lintStaged, packageJson, workflow }) {
  const problems = [];
  const scripts = packageJson.scripts ?? {};
  const fullFix = scripts['lint:fix'] ?? '';
  const stagedFix = scripts['lint:fix:staged'] ?? '';
  const sourceTasks = lintStaged['*.{ts,tsx}'] ?? [];

  if (!fullFix.includes('eslint packages apps --ext .ts,.tsx --cache --fix')) {
    problems.push('lint:fix must preserve the canonical ESLint scope');
  }
  if (!fullFix.includes('prettier --write .')) {
    problems.push('lint:fix must finish with repository-root Prettier');
  }
  if (stagedFix !== LOCKED_STAGED_FIX_COMMAND) {
    problems.push('lint:fix:staged must own the locked lint-staged invocation');
  }
  if (!hook.includes('pnpm lint:fix:staged')) {
    problems.push('pre-commit must delegate to lint:fix:staged');
  }
  if (hook.includes('pnpm lint:fix\n') || hook.includes('pnpm run lint:fix\n')) {
    problems.push('pre-commit must never run the whole-repository fixer');
  }
  if (hook.includes('with-repo-lock.sh')) {
    problems.push('pre-commit must not acquire a second repository lock');
  }
  if (
    sourceTasks.indexOf('eslint --fix') === -1 ||
    sourceTasks.indexOf('prettier --write') === -1 ||
    sourceTasks.indexOf('eslint --fix') > sourceTasks.indexOf('prettier --write')
  ) {
    problems.push('lint-staged must run ESLint before Prettier');
  }
  if (!workflow.includes('pnpm lint:fix:staged') || !workflow.includes('pnpm lint:fix')) {
    problems.push('the completion workflow must name staged and full fix modes');
  }
  if (!workflow.includes('post-fix')) {
    problems.push('the completion workflow must verify the post-fix tree');
  }
  return problems;
}

describe('INFRA-089 staged and full auto-fix contract', () => {
  it('the live repository has one staged fixer, one optional full fixer, and post-fix verification', () => {
    expect(contractProblems(repositoryContract())).toEqual([]);
  });

  it.each([
    ['missing staged command', ({ packageJson }) => delete packageJson.scripts['lint:fix:staged']],
    [
      'missing single lock owner',
      ({ packageJson }) => {
        packageJson.scripts['lint:fix:staged'] = 'lint-staged';
      },
    ],
    [
      'lint-staged escapes the repository lock',
      ({ packageJson }) => {
        packageJson.scripts['lint:fix:staged'] =
          'scripts/harness/with-repo-lock.sh true && pnpm exec lint-staged';
      },
    ],
    ['whole-tree fixer wired to commit', ({ hook }) => ({ hook: `${hook}\npnpm lint:fix\n` })],
    [
      'second lock in hook',
      ({ hook }) => ({ hook: `${hook}\nwith-repo-lock.sh pnpm lint:fix:staged\n` }),
    ],
    [
      'formatter before linter',
      ({ lintStaged }) => {
        lintStaged['*.{ts,tsx}'] = ['prettier --write', 'eslint --fix'];
      },
    ],
  ])('rejects %s', (_name, mutate) => {
    const fixture = repositoryContract();
    const replacement = mutate(fixture);
    const changed = replacement === undefined ? fixture : { ...fixture, ...replacement };

    expect(contractProblems(changed)).not.toEqual([]);
  });

  it('fixes only staged source and documentation files and automatically re-stages them', async () => {
    const fixtureRoot = makeTemp('robota-staged-auto-fix-');
    const sourcePath = path.join(fixtureRoot, 'fixture.ts');
    const markdownPath = path.join(fixtureRoot, 'fixture.md');
    const unrelatedPath = path.join(fixtureRoot, 'unrelated.md');
    const unrelatedBefore = '#Unrelated\n';

    try {
      symlinkSync(
        path.join(WORKSPACE_ROOT, 'node_modules'),
        path.join(fixtureRoot, 'node_modules'),
      );
      writeFileSync(
        path.join(fixtureRoot, '.eslintrc.json'),
        readFileSync(path.join(WORKSPACE_ROOT, '.eslintrc.json'), 'utf8'),
      );
      writeFileSync(
        path.join(fixtureRoot, '.prettierrc.json'),
        readFileSync(path.join(WORKSPACE_ROOT, '.prettierrc.json'), 'utf8'),
      );
      writeFileSync(sourcePath, 'const answer={value:"ok"}\n');
      writeFileSync(markdownPath, '# Title\n\n-   item\n');
      writeFileSync(unrelatedPath, unrelatedBefore);

      const git = (...args) =>
        spawnSync('git', args, { cwd: fixtureRoot, encoding: 'utf8', stdio: 'pipe' });
      expect(git('init').status).toBe(0);
      expect(git('config', 'user.email', 'fixture@example.test').status).toBe(0);
      expect(git('config', 'user.name', 'Fixture').status).toBe(0);
      expect(git('add', 'fixture.ts', 'fixture.md').status).toBe(0);

      const result = spawnSync(
        'pnpm',
        [
          '--dir',
          WORKSPACE_ROOT,
          'run',
          'lint:fix:staged',
          '--cwd',
          fixtureRoot,
          '--config',
          path.join(WORKSPACE_ROOT, '.lintstagedrc.json'),
        ],
        // Spawn from the WORKSPACE, not the fixture. `pnpm` is version-pinned by the workspace's
        // `packageManager` field, and corepack resolves that from the process CWD — so launching it
        // from a bare temp directory picked up whatever pnpm happens to be installed globally and
        // aborted on the version mismatch, failing this test for a reason that has nothing to do
        // with what it asserts. The fixture is addressed by `--cwd`, which is what lint-staged reads.
        { cwd: WORKSPACE_ROOT, encoding: 'utf8', stdio: 'pipe' },
      );

      expect(`${result.stdout}${result.stderr}`).not.toContain('FAILED');
      expect(result.status).toBe(0);
      expect(readFileSync(sourcePath, 'utf8')).toBe("const answer = { value: 'ok' };\n");
      expect(readFileSync(markdownPath, 'utf8')).toBe('# Title\n\n- item\n');
      expect(readFileSync(unrelatedPath, 'utf8')).toBe(unrelatedBefore);
      expect(git('diff', '--cached', '--name-only').stdout.trim().split('\n').sort()).toEqual([
        'fixture.md',
        'fixture.ts',
      ]);
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });
});
