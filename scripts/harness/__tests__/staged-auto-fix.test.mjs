import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');

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
  if (!stagedFix.includes('with-repo-lock.sh') || !stagedFix.includes('lint-staged')) {
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
});
