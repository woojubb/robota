import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  findDtsExtensionFindings,
  findDistFileFindings,
  findBinPathFindings,
  findExportPathFindings,
} from '../check-build-output-contracts.mjs';

const PKG = '@test/pkg';

// ── findDtsExtensionFindings ────────────────────────────────────────────────

describe('findDtsExtensionFindings', () => {
  it('passes when types ends with .d.ts', () => {
    const pkg = { types: 'dist/node/index.d.ts' };
    expect(findDtsExtensionFindings(PKG, pkg)).toEqual([]);
  });

  it('flags .d.mts in top-level types field', () => {
    const pkg = { types: 'dist/node/index.d.mts' };
    const findings = findDtsExtensionFindings(PKG, pkg);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('.d.mts');
    expect(findings[0]).toContain('must end with .d.ts');
  });

  it('flags .d.cts in top-level types field', () => {
    const pkg = { types: 'dist/node/index.d.cts' };
    const findings = findDtsExtensionFindings(PKG, pkg);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('.d.cts');
  });

  it('flags .d.mts in exports types', () => {
    const pkg = {
      exports: {
        '.': { types: './dist/node/index.d.mts', import: './dist/node/index.js' },
      },
    };
    const findings = findDtsExtensionFindings(PKG, pkg);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('./dist/node/index.d.mts');
  });

  it('passes when exports types ends with .d.ts', () => {
    const pkg = {
      exports: {
        '.': { types: './dist/node/index.d.ts', import: './dist/node/index.js' },
      },
    };
    expect(findDtsExtensionFindings(PKG, pkg)).toEqual([]);
  });

  it('ignores types not in dist/', () => {
    const pkg = { types: 'src/index.d.mts' };
    expect(findDtsExtensionFindings(PKG, pkg)).toEqual([]);
  });
});

// ── findDistFileFindings ────────────────────────────────────────────────────

async function createFixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'robota-build-contracts-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(root, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content ?? '', 'utf8');
  }
  return root;
}

describe('findDistFileFindings', () => {
  it('skips check when dist/ does not exist (build not run)', async () => {
    const root = await createFixture({});
    const pkg = { main: 'dist/node/index.js', types: 'dist/node/index.d.ts' };
    expect(findDistFileFindings(PKG, pkg, root)).toEqual([]);
  });

  it('passes when all declared dist files exist', async () => {
    const root = await createFixture({
      'dist/node/index.js': '',
      'dist/node/index.d.ts': '',
    });
    const pkg = { main: 'dist/node/index.js', types: 'dist/node/index.d.ts' };
    expect(findDistFileFindings(PKG, pkg, root)).toEqual([]);
  });

  it('flags missing main file', async () => {
    const root = await createFixture({ 'dist/node/index.d.ts': '' });
    const pkg = { main: 'dist/node/index.js', types: 'dist/node/index.d.ts' };
    const findings = findDistFileFindings(PKG, pkg, root);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('main="dist/node/index.js"');
    expect(findings[0]).toContain('file not found');
  });

  it('flags missing types file', async () => {
    const root = await createFixture({ 'dist/node/index.js': '' });
    const pkg = { main: 'dist/node/index.js', types: 'dist/node/index.d.ts' };
    const findings = findDistFileFindings(PKG, pkg, root);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('types="dist/node/index.d.ts"');
  });

  it('flags missing exports subpath file', async () => {
    const root = await createFixture({ 'dist/node/index.js': '' });
    const pkg = {
      exports: {
        '.': { import: './dist/node/index.js' },
        './loggers/file': { import: './dist/loggers/file.js' },
      },
    };
    const findings = findDistFileFindings(PKG, pkg, root);
    expect(findings.some((f) => f.includes('./dist/loggers/file.js'))).toBe(true);
  });
});

// ── findExportPathFindings ──────────────────────────────────────────────────

describe('findExportPathFindings', () => {
  it('passes on known extensions', () => {
    const pkg = {
      exports: {
        '.': {
          types: './dist/node/index.d.ts',
          import: './dist/node/index.js',
          require: './dist/node/index.cjs',
        },
      },
    };
    expect(findExportPathFindings(PKG, pkg)).toEqual([]);
  });

  it('flags unknown dist extension', () => {
    const pkg = { exports: { '.': { import: './dist/node/index.ts' } } };
    const findings = findExportPathFindings(PKG, pkg);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('unsupported dist output extension');
  });
});

// ── findBinPathFindings ─────────────────────────────────────────────────────

describe('findBinPathFindings', () => {
  it('passes on valid bin paths', () => {
    const pkg = { bin: { robota: 'dist/bin/robota.js' } };
    expect(findBinPathFindings(PKG, pkg)).toEqual([]);
  });

  it('flags bin pointing at non-JS file in dist', () => {
    const pkg = { bin: { robota: 'dist/bin/robota.ts' } };
    const findings = findBinPathFindings(PKG, pkg);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('must point at JavaScript output');
  });
});
