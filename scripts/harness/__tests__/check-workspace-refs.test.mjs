import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  examinedHelperScriptCount,
  examinedManifestCount,
  findWorkspaceRefFindings,
} from '../check-workspace-refs.mjs';

async function createFixture(files) {
  const root = makeTemp('robota-workspace-refs-');
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(root, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, 'utf8');
  }
  return root;
}

function pkg(name, scripts = {}) {
  return JSON.stringify({ name, version: '0.0.0', scripts });
}

describe('check-workspace-refs', () => {
  it('reports a script filter referencing a non-existent workspace package', async () => {
    const root = await createFixture({
      'package.json': pkg('root'),
      'packages/foo/package.json': pkg('@robota-sdk/foo', {
        build: 'pnpm --filter @robota-sdk/renamed-away build && tsdown',
      }),
    });
    const findings = await findWorkspaceRefFindings(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe('unresolved-workspace-ref');
    expect(findings[0].detail).toContain('@robota-sdk/renamed-away');
  });

  it('passes when the referenced package exists', async () => {
    const root = await createFixture({
      'package.json': pkg('root'),
      'packages/foo/package.json': pkg('@robota-sdk/foo', {
        build: 'pnpm --filter @robota-sdk/bar build && tsdown',
      }),
      'packages/bar/package.json': pkg('@robota-sdk/bar'),
    });
    expect(await findWorkspaceRefFindings(root)).toHaveLength(0);
  });

  /**
   * HARNESS-052. `@robota-sdk/agent-provider-bytedance` was allowlisted here as a non-workspace
   * example token while `packages/agent-provider-bytedance` shipped a manifest under that exact
   * name. Inert today, and the day that package is deleted it exempts a genuine dangling reference —
   * which is how a suppression outlives its reason. An entry that RESOLVES is stale by construction.
   */
  it('reports an allowlist entry that resolves to a real workspace package', async () => {
    const root = await createFixture({
      'package.json': pkg('root'),
      'packages/other/package.json': pkg('@robota-sdk/other'),
    });
    const findings = await findWorkspaceRefFindings(root);
    expect(findings.map((f) => f.type)).toContain('stale-allowlist-entry');
    expect(findings.find((f) => f.type === 'stale-allowlist-entry').detail).toContain(
      '@robota-sdk/other',
    );
  });

  it('reports unresolved tokens inside scripts/*.mjs helper files', async () => {
    const root = await createFixture({
      'package.json': pkg('root'),
      'packages/foo/package.json': pkg('@robota-sdk/foo'),
      'packages/foo/scripts/copy-assets.mjs':
        "console.error('Run: pnpm --filter @robota-sdk/ghost build');\n",
    });
    const findings = await findWorkspaceRefFindings(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toContain('@robota-sdk/ghost');
  });
});

describe('the examined-size counters measure both walks, and only this run (HARNESS-057)', () => {
  /**
   * An unverified counter is a scan claiming a size nothing checked — the defect this migration
   * exists to prevent, one level up. Both halves are covered because a single number would have to
   * misreport one subject, which is how the sibling `conflict-markers` line first shipped wrong.
   */
  it('counts each walk against its own subject', async () => {
    const root = await createFixture({
      'package.json': JSON.stringify({ name: 'root', scripts: { build: 'echo ok' } }),
      'packages/foo/package.json': JSON.stringify({ name: '@x/foo', scripts: { t: 'echo ok' } }),
      'apps/bar/package.json': JSON.stringify({ name: '@x/bar', scripts: {} }),
      'scripts/one.mjs': 'export const a = 1;\n',
      'scripts/nested/two.mjs': 'export const b = 2;\n',
    });

    await findWorkspaceRefFindings(root);

    expect(examinedManifestCount(), 'the manifest walk was miscounted').toBe(3);
    expect(examinedHelperScriptCount(), 'the helper-script walk was miscounted').toBe(2);
  });

  it('RESETS between runs, so a later run cannot inherit an earlier tree size', async () => {
    const big = await createFixture({
      'package.json': JSON.stringify({ name: 'root', scripts: {} }),
      'packages/foo/package.json': JSON.stringify({ name: '@x/foo', scripts: {} }),
      'apps/bar/package.json': JSON.stringify({ name: '@x/bar', scripts: {} }),
      'scripts/one.mjs': 'export const a = 1;\n',
      'scripts/two.mjs': 'export const b = 2;\n',
    });
    // `packages/` must exist: this scan fails CLOSED without it, because resolution is relative to
    // the workspace package set and "nothing was examined" is not a pass (HARNESS-052). The first
    // version of this fixture omitted it and the guard said so — correctly.
    const small = await createFixture({
      'package.json': JSON.stringify({ name: 'root', scripts: {} }),
      'packages/only/package.json': JSON.stringify({ name: '@x/only', scripts: {} }),
    });

    await findWorkspaceRefFindings(big);
    expect(examinedManifestCount()).toBe(3);
    expect(examinedHelperScriptCount()).toBe(2);

    await findWorkspaceRefFindings(small);

    // BOTH counters, symmetrically with the sibling reset cases in this PR. The smaller fixture has
    // FEWER manifests rather than none, so an accumulating counter would read 5 here — a bug a
    // same-size fixture could not have distinguished from a correct reset. (#1684 review)
    expect(examinedManifestCount(), 'the manifest count carried over').toBe(2);
    expect(examinedHelperScriptCount(), 'the helper-script count carried over').toBe(0);
  });
});
