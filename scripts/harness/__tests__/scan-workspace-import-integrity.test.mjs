import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { SCAN_COMMANDS } from '../run-all-scans.mjs';
import {
  examinedFileCount,
  examinedPackageCount,
  findWorkspaceImportIntegrityFindings,
  workspaceTarget,
} from '../scan-workspace-import-integrity.mjs';

function fixture(files) {
  const root = makeTemp('workspace-import-integrity-');
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content), 'utf8');
  }
  return root;
}

const pkgA = {
  'packages/a/package.json': {
    name: '@x/a',
    exports: { '.': './dist/index.js', './testing': { import: './dist/testing.js' } },
  },
  'packages/a/src/index.ts': 'export function fromA(): void {}\nexport interface IRecord {}\n',
  'packages/a/src/testing.ts': 'export const kit = 1;\n',
};
const pkgS = {
  'packages/s/package.json': { name: '@x/s' },
  'packages/s/src/index.ts': 'export interface IMoved {}\n',
};

describe('workspace-import-integrity (issue #2230)', () => {
  it('is registered in the aggregate harness', () => {
    expect(SCAN_COMMANDS.some((scan) => scan.name === 'workspace-import-integrity')).toBe(true);
  });

  it('resolves a specifier to the workspace package it names, longest name first', () => {
    const names = ['@x/a-b', '@x/a'];
    expect(workspaceTarget('@x/a', names)).toEqual({ name: '@x/a', subpath: '.' });
    expect(workspaceTarget('@x/a/testing', names)).toEqual({ name: '@x/a', subpath: './testing' });
    expect(workspaceTarget('@x/a-b', names)).toEqual({ name: '@x/a-b', subpath: '.' });
    expect(workspaceTarget('lodash', names)).toBe(null);
  });

  it('RED: an undeclared workspace import fails, including the `import type` form in a test file', () => {
    const root = fixture({
      ...pkgA,
      'packages/b/package.json': { name: '@x/b' },
      'packages/b/src/__tests__/b.test.ts': "import type { IRecord } from '@x/a';\n",
    });
    const findings = findWorkspaceImportIntegrityFindings(root);
    expect(findings.map((f) => f.type)).toEqual(['workspace-import-undeclared']);
    expect(findings[0].file).toBe('packages/b/src/__tests__/b.test.ts');
    expect(findings[0].detail).toContain('`@x/a`');
    expect(examinedFileCount()).toBe(3);
    expect(examinedPackageCount()).toBe(2);
  });

  it('RED: a symbol the named package does not export fails, naming the package that does', () => {
    const root = fixture({
      ...pkgA,
      ...pkgS,
      'packages/b/package.json': { name: '@x/b', dependencies: { '@x/a': 'workspace:*' } },
      'packages/b/src/b.ts': "import { fromA, type IMoved } from '@x/a';\n",
    });
    const findings = findWorkspaceImportIntegrityFindings(root);
    expect(findings.map((f) => f.type)).toEqual(['workspace-import-missing-export']);
    expect(findings[0].detail).toContain('`IMoved`');
    expect(findings[0].detail).toContain('exported by @x/s');
  });

  it('a devDependency used only in tests, a subpath entry, a relative import and a builtin all pass', () => {
    const root = fixture({
      ...pkgA,
      'packages/b/package.json': { name: '@x/b', devDependencies: { '@x/a': 'workspace:*' } },
      'packages/b/src/b.ts':
        "import { readFileSync } from 'node:fs';\nimport { local } from './local.js';\nexport { readFileSync, local };\n",
      'packages/b/src/local.ts': 'export const local = 1;\n',
      // A generator's template about an import is not an import (agent-playground, measured).
      'packages/b/src/gen.ts': "export const code = `import { fromA } from '@x/undeclared';`;\n",
      'packages/b/src/__tests__/b.test.ts':
        "import { kit } from '@x/a/testing';\nimport { fromA } from '@x/a';\nexport { kit, fromA };\n",
    });
    expect(findWorkspaceImportIntegrityFindings(root)).toEqual([]);
  });
});
