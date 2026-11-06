import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { isDeveloperDocument, selectScope } from '../ci.mjs';

describe('CI developer-document scope', () => {
  it('does not skip ARCHITECTURE.md, because pnpm lint checks the manifests against its lists', () => {
    expect(isDeveloperDocument('ARCHITECTURE.md')).toBe(false);
  });

  it.each(['README.md', 'AGENTS.md', '.changeset/x.md', 'packages/agent-core/docs/SPEC.md'])(
    'still skips the developer document %s',
    (file) => {
      expect(isDeveloperDocument(file)).toBe(true);
    },
  );
});

it('builds the product fixture package for unconditional script tests in a docs-only change', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'robota-ci-scope-'));
  const write = (name, content) => {
    mkdirSync(join(cwd, name, '..'), { recursive: true });
    writeFileSync(join(cwd, name), content);
  };
  const git = (...args) => execFileSync('git', args, { cwd, stdio: 'ignore' });
  try {
    const { packageManager } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    write('package.json', JSON.stringify({ name: 'root', private: true, packageManager }));
    write('pnpm-workspace.yaml', 'packages:\n  - apps/*\n  - packages/*\n');
    write('apps/docs/package.json', JSON.stringify({ name: 'docs', scripts: { build: 'true' } }));
    write('packages/fixture-helper/package.json', JSON.stringify({
      name: 'fixture-helper', scripts: { build: 'true' },
    }));
    write('packages/product-config/package.json', JSON.stringify({
      name: '@robota-sdk/product-config', scripts: { build: 'true' },
      dependencies: { 'fixture-helper': 'workspace:*' },
    }));
    write('content/guide.md', 'before\n');
    git('init');
    git('config', 'user.name', 'CI test');
    git('config', 'user.email', 'ci@example.invalid');
    git('add', '.');
    git('commit', '-m', 'base');
    git('branch', 'base');
    write('content/guide.md', 'after\n');
    git('add', '.');
    git('commit', '-m', 'docs');
    const plan = selectScope({ cwd, event: 'pull_request', base: 'base' });
    expect(plan.full).toBe(false);
    expect(plan.checks).toContain('apps/docs');
    expect(plan.build).toContain('packages/product-config');
    expect(plan.build).toContain('packages/fixture-helper');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
