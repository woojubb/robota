import { mkdirSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { makeTemp } from './make-temp.mjs';
import { assembleGeneration } from '../../artifacts/generation.mjs';
import { createManifest } from '../../artifacts/manifest.mjs';
import {
  findDistFileFindings,
  findScriptPairFindings,
  hasDistContract,
} from '../check-build-output-contracts.mjs';
import { collectDistFreshnessResults, walkTree } from '../scan-dist-freshness.mjs';
import {
  checkTreePrerequisites,
  inspectTree,
  listBuildablePackageDirs,
} from '../tree-prerequisites.mjs';

const PKG = '@fixture/managed';
const manifest = {
  name: PKG,
  main: 'dist/index.js',
  scripts: { build: 'complete-build' },
  robota: { artifact: { builder: 'tsdown' } },
};

async function fixture(pkg = manifest) {
  const root = makeTemp('artifact-checkers-');
  const packageRoot = path.join(root, 'packages/managed');
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify(pkg));
  const generation = await assembleGeneration(packageRoot, ({ outputRoot }) => {
    writeFileSync(path.join(outputRoot, 'index.js'), 'export {};');
    return createManifest([{ path: 'index.js', contents: 'export {};' }]);
  });
  return { root, packageRoot, generation };
}

describe('managed artifact checkers', () => {
  it('rejects unmanifested outputs even when the declared entry exists', async () => {
    const { packageRoot, generation } = await fixture();
    writeFileSync(path.join(generation.root, 'extra.js'), 'extra');
    expect(findDistFileFindings(PKG, manifest, packageRoot).join('\n')).toContain(
      'unexpected file extra.js',
    );
  });

  it('keeps missing output optional for manifest-only scans but fails explicit generation requirements', async () => {
    const { packageRoot } = await fixture();
    unlinkSync(path.join(packageRoot, 'dist'));
    expect(findDistFileFindings(PKG, manifest, packageRoot)).toEqual([]);
    expect(
      findDistFileFindings(PKG, manifest, packageRoot, { requireVerifiedGeneration: true }).join(
        '\n',
      ),
    ).toContain('generation required');
  });

  it('includes private Vite capabilities in the aggregate contract check', async () => {
    const pkg = {
      name: PKG,
      private: true,
      scripts: { build: 'complete-build' },
      robota: { artifact: { builder: 'vite' } },
    };
    const { root, generation } = await fixture(pkg);
    writeFileSync(path.join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
    writeFileSync(path.join(generation.root, 'index.js'), 'changed');
    expect(hasDistContract(pkg)).toBe(true);
    const result = spawnSync(
      process.execPath,
      [path.resolve(import.meta.dirname, '../check-build-output-contracts.mjs')],
      { cwd: root, encoding: 'utf8' },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('content mismatch');
  });

  it('checks module and bin entries against the pinned manifest, not mere path existence', async () => {
    const { packageRoot } = await fixture();
    const findings = findDistFileFindings(
      PKG,
      { ...manifest, module: 'dist/missing.js', bin: { app: 'dist/bin.js' } },
      packageRoot,
    );
    expect(findings).toHaveLength(2);
    expect(findings.join('\n')).toContain('module=');
    expect(findings.join('\n')).toContain('bin.app=');
  });

  it('requires the complete build owner, not a mandatory two-pass pair', () => {
    expect(findScriptPairFindings(PKG, manifest)).toEqual([]);
    expect(findScriptPairFindings(PKG, { ...manifest, scripts: {} }).join('\n')).toContain(
      'missing build',
    );
    expect(
      findScriptPairFindings(PKG, {
        ...manifest,
        scripts: { build: 'complete-build', 'build:js': 'tsdown --no-dts' },
      }).join('\n'),
    ).toContain('alias');
  });

  it('measures private Vite freshness through the verified generation without build:js', async () => {
    const pkg = { ...manifest, private: true, robota: { artifact: { builder: 'vite' } } };
    const { root, packageRoot, generation } = await fixture(pkg);
    mkdirSync(path.join(packageRoot, 'src'));
    writeFileSync(path.join(packageRoot, 'src/main.tsx'), 'source');
    utimesSync(path.join(packageRoot, 'src/main.tsx'), 5000, 5000);
    utimesSync(path.join(generation.root, 'index.js'), 1000, 1000);
    const { results, freshness } = await collectDistFreshnessResults(root, [
      { relativeDir: 'packages/managed', workspaceName: PKG, scripts: pkg.scripts },
    ]);
    expect(freshness.stale).toBe(1);
    expect(results.some((result) => result.kind === 'ok')).toBe(true);
  });

  it('freshness rejects a corrupted managed generation instead of reporting fresh', async () => {
    const { root, generation } = await fixture();
    writeFileSync(path.join(generation.root, 'index.js'), 'changed');
    const { results } = await collectDistFreshnessResults(root, [
      { relativeDir: 'packages/managed', workspaceName: PKG, scripts: manifest.scripts },
    ]);
    expect(results.find((result) => result.kind === 'error')?.message).toContain(
      'content mismatch',
    );
  });

  it('freshness can explicitly require a generation even for a missing private output', async () => {
    const { root, packageRoot } = await fixture({ ...manifest, private: true });
    unlinkSync(path.join(packageRoot, 'dist'));
    const scopes = [
      { relativeDir: 'packages/managed', workspaceName: PKG, scripts: manifest.scripts },
    ];
    expect((await collectDistFreshnessResults(root, scopes)).results[0].kind).toBe('warn');
    expect(
      (await collectDistFreshnessResults(root, scopes, { requireVerifiedGeneration: true }))
        .results[0].kind,
    ).toBe('error');
  });

  it('walks only physical roots and does not follow nested links', async () => {
    const { packageRoot, generation } = await fixture();
    expect(walkTree(path.join(packageRoot, 'dist')).fileCount).toBe(0);
    const outside = makeTemp('artifact-checkers-outside-');
    writeFileSync(path.join(outside, 'escaped.js'), 'escaped');
    symlinkSync(outside, path.join(generation.root, 'linked'), 'junction');
    expect(walkTree(generation.root).fileCount).toBe(1);
  });

  it('includes private Vite build capability in prerequisites without legacy aliases', async () => {
    const { root, packageRoot } = await fixture({
      ...manifest,
      private: true,
      robota: { artifact: { builder: 'vite' } },
    });
    expect(listBuildablePackageDirs(root)).toEqual(['packages/managed']);
    expect(inspectTree(root, ['build-output']).missing).toEqual([]);
    unlinkSync(path.join(packageRoot, 'dist'));
    expect(inspectTree(root, ['build-output']).missing).toEqual(['build-output']);
  });

  it('names invalid generations as failed prerequisites, not missing directories', async () => {
    const { root, generation } = await fixture();
    writeFileSync(path.join(generation.root, 'index.js'), 'tampered');
    const result = checkTreePrerequisites('fixture verification', root, ['build-output']);
    expect(result.ok).toBe(false);
    expect(result.missingDist).toEqual([]);
    expect(result.message).toContain('content mismatch');
    expect(result.message).toContain('invalid managed generation');
  });

  it('keeps install-only prerequisites independent of product generations', async () => {
    const { root, generation } = await fixture();
    mkdirSync(path.join(root, 'node_modules'));
    writeFileSync(path.join(root, 'node_modules/.modules.yaml'), '');
    writeFileSync(path.join(generation.root, 'index.js'), 'tampered');
    expect(inspectTree(root, ['install']).missing).toEqual([]);
  });

  it('reports absent managed output as CLI advisory unless verified generation is requested', async () => {
    const { root, packageRoot } = await fixture();
    writeFileSync(path.join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
    unlinkSync(path.join(packageRoot, 'dist'));
    const script = path.resolve(import.meta.dirname, '../check-build-output-contracts.mjs');
    const optional = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
    expect(optional.status).toBe(0);
    expect(optional.stdout).toContain('dist/ read on 0');
    expect(optional.stdout).toContain('resolved NOTHING');
    const required = spawnSync(process.execPath, [script, '--require-verified-generation'], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(required.status).toBe(1);
    expect(required.stderr).toContain('generation required');
  });

  it('rejects a dangling pointer instead of treating it as a build-not-intended absence', async () => {
    const { packageRoot } = await fixture();
    unlinkSync(path.join(packageRoot, 'dist'));
    symlinkSync('missing-generation', path.join(packageRoot, 'dist'), 'junction');
    expect(findDistFileFindings(PKG, manifest, packageRoot).join('\n')).toContain(
      'invalid managed generation',
    );
  });
});
