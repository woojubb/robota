import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { findNestedGlobCoverageFindings } from '../check-nested-package-glob-coverage.mjs';

const SCAN_SCRIPT = fileURLToPath(
  new URL('../check-nested-package-glob-coverage.mjs', import.meta.url),
);

const NESTED_WORKSPACE_YAML = `packages:
  - 'packages/*'
  - 'packages/grp/*'
  - 'apps/*'
`;

const COVERED_WORKFLOW = `name: CI
jobs:
  build:
    steps:
      - run: tar -czf package-dist.tgz packages/*/dist packages/grp/*/dist
`;

const UNCOVERED_WORKFLOW = `name: CI
jobs:
  build:
    steps:
      - run: tar -czf package-dist.tgz packages/*/dist
`;

async function createFixture(files = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'robota-nested-glob-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(root, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, 'utf8');
  }
  return root;
}

describe('findNestedGlobCoverageFindings', () => {
  it('passes a workflow that globs both one-level and nested dist sets', async () => {
    const root = await createFixture({
      'pnpm-workspace.yaml': NESTED_WORKSPACE_YAML,
      '.github/workflows/ci.yml': COVERED_WORKFLOW,
    });

    expect(await findNestedGlobCoverageFindings(root)).toEqual([]);
  });

  it('flags a workflow that omits a nested package group dist glob (RED)', async () => {
    const root = await createFixture({
      'pnpm-workspace.yaml': NESTED_WORKSPACE_YAML,
      '.github/workflows/ci.yml': UNCOVERED_WORKFLOW,
    });

    const findings = await findNestedGlobCoverageFindings(root);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      file: '.github/workflows/ci.yml',
      type: 'nested-group-dist-glob-missing',
    });
    expect(findings[0].detail).toContain("omits the nested package group 'packages/grp/*/dist'");
  });

  it('passes when the workspace declares no nested package groups', async () => {
    const root = await createFixture({
      'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n",
      '.github/workflows/ci.yml': UNCOVERED_WORKFLOW,
    });

    expect(await findNestedGlobCoverageFindings(root)).toEqual([]);
  });

  it('ignores workflows that never glob the one-level dist set', async () => {
    const root = await createFixture({
      'pnpm-workspace.yaml': NESTED_WORKSPACE_YAML,
      '.github/workflows/ci.yml': 'name: CI\njobs: {}\n',
    });

    expect(await findNestedGlobCoverageFindings(root)).toEqual([]);
  });

  it('passes when there is no workflows directory', async () => {
    const root = await createFixture({
      'pnpm-workspace.yaml': NESTED_WORKSPACE_YAML,
    });

    expect(await findNestedGlobCoverageFindings(root)).toEqual([]);
  });
});

describe('check-nested-package-glob-coverage CLI', () => {
  function runScan(cwd) {
    try {
      const stdout = execFileSync(process.execPath, [SCAN_SCRIPT], { cwd, encoding: 'utf8' });
      return { status: 0, stdout };
    } catch (error) {
      return { status: error.status, stdout: `${error.stdout ?? ''}` };
    }
  }

  it('exits 0 with a pass message on a covered fixture', async () => {
    const root = await createFixture({
      'pnpm-workspace.yaml': NESTED_WORKSPACE_YAML,
      '.github/workflows/ci.yml': COVERED_WORKFLOW,
    });

    const result = runScan(root);
    expect(result.stdout).toContain('nested package-group glob coverage scan passed.');
    expect(result.status).toBe(0);
  });

  it('exits 1 and lists findings on an uncovered fixture (RED)', async () => {
    const root = await createFixture({
      'pnpm-workspace.yaml': NESTED_WORKSPACE_YAML,
      '.github/workflows/ci.yml': UNCOVERED_WORKFLOW,
    });

    const result = runScan(root);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('nested package-group glob coverage scan failed:');
    expect(result.stdout).toContain('[nested-group-dist-glob-missing] .github/workflows/ci.yml');
  });
});
