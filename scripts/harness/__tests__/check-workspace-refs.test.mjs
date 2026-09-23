import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  examinedHelperScriptCount,
  examinedManifestCount,
  examinedReferenceFileCount,
  examinedSourceFileCount,
  examinedReleaseFileCount,
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
  it('refuses a stale command through the real CLI and accepts its corrected name', async () => {
    const root = await createFixture({
      'packages/current/package.json': pkg('@robota-sdk/current'),
      'scripts/fixture.mjs': 'export const value = 1;\n',
      'docs/guide.md': 'Run `pnpm --filter @robota-sdk/renamed-away test`.\n',
    });
    const invoke = () =>
      spawnSync(
        process.execPath,
        [path.resolve(import.meta.dirname, '../check-workspace-refs.mjs'), '--root', root],
        { encoding: 'utf8' },
      );
    const stale = invoke();
    expect(stale.status, stale.stderr).toBe(1);
    expect(stale.stdout).toContain('docs/guide.md');
    expect(stale.stdout).toContain('@robota-sdk/renamed-away');
    writeFileSync(
      path.join(root, 'docs/guide.md'),
      'Run `pnpm --filter @robota-sdk/current test`.\n',
    );
    const corrected = invoke();
    expect(corrected.status, corrected.stderr).toBe(0);
    expect(corrected.stdout).toContain('workspace ref scan passed.');
  });

  it('owns unresolved names across live commands, diagrams and release inputs', async () => {
    const root = await createFixture({
      'packages/current/package.json': pkg('@robota-sdk/current'),
      'docs/guide.md': 'Run `pnpm --filter @robota-sdk/renamed-away run test`.\n',
      'diagrams/current.mmd': 'graph TD\n a["@robota-sdk/renamed-away"]\n',
      '.changeset/pending.md':
        '---\n"@robota-sdk/renamed-away": patch\n---\nOld @robota-sdk/historical prose.\n',
      '.changeset/pre.json': JSON.stringify({
        mode: 'pre',
        tag: 'next',
        initialVersions: { '@robota-sdk/renamed-away': '1.0.0' },
        changesets: [],
      }),
      'packages/current/CHANGELOG.md': '@robota-sdk/historical\n',
      '.agents/tasks/completed/old.md': 'pnpm --filter @robota-sdk/historical test\n',
    });
    const findings = await findWorkspaceRefFindings(root);
    expect(findings.map((finding) => finding.file).sort()).toEqual([
      '.changeset/pending.md',
      '.changeset/pre.json',
      'diagrams/current.mmd',
      'docs/guide.md',
    ]);
    expect(findings.every((finding) => finding.detail.includes('@robota-sdk/renamed-away'))).toBe(
      true,
    );
  });

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

  it('checks fenced and source-comment commands without mistaking selectors for names', async () => {
    const root = await createFixture({
      'packages/current/package.json': pkg('@robota-sdk/current', { test: 'vitest run' }),
      'docs/guide.md': [
        '```sh',
        'pnpm -F @robota-sdk/renamed-away test',
        'pnpm --filter @robota-sdk/missing-* test',
        'pnpm --filter ./packages/** test',
        'pnpm --filter !@robota-sdk/absent test',
        'pnpm --filter @robota-sdk/current... test',
        'pnpm --filter <pkg> test',
        '```',
      ].join('\n'),
      'vitest.config.ts': '// Run pnpm --filter=@robota-sdk/renamed-away exec vitest\n',
    });
    const findings = await findWorkspaceRefFindings(root);
    expect(findings.map((finding) => finding.file).sort()).toEqual([
      'docs/guide.md',
      'vitest.config.ts',
    ]);
    expect(findings.every((finding) => finding.detail.includes('@robota-sdk/renamed-away'))).toBe(
      true,
    );
  });

  it('checks script references in nested workspace package manifests', async () => {
    const root = await createFixture({
      'packages/nodes/current/package.json': pkg('@robota-sdk/current', {
        test: 'pnpm --filter @robota-sdk/renamed-away test',
      }),
    });
    expect(await findWorkspaceRefFindings(root)).toEqual([
      expect.objectContaining({
        file: 'packages/nodes/current/package.json',
        detail: expect.stringContaining('@robota-sdk/renamed-away'),
      }),
    ]);
  });

  it('accepts valid release names while leaving changeset prose and archived records historical', async () => {
    const root = await createFixture({
      'packages/current/package.json': pkg('@robota-sdk/current'),
      '.changeset/pending.md':
        '---\n"@robota-sdk/current": patch\n---\nReplaces @robota-sdk/renamed-away. Run `pnpm --filter @robota-sdk/renamed-away test` in the old version.\n',
      '.changeset/pre.json': JSON.stringify({
        mode: 'pre',
        tag: 'next',
        initialVersions: { '@robota-sdk/current': '1.0.0' },
        changesets: ['renamed-away'],
      }),
      '.agents/archive/old.md': 'pnpm --filter @robota-sdk/renamed-away test\n',
      'packages/current/CHANGELOG.md': '@robota-sdk/renamed-away\n',
    });
    expect(await findWorkspaceRefFindings(root)).toHaveLength(0);
  });

  it('does not silently accept unreadable prerelease state', async () => {
    const root = await createFixture({
      'packages/current/package.json': pkg('@robota-sdk/current'),
      '.changeset/pre.json': '{broken',
    });
    await expect(findWorkspaceRefFindings(root)).rejects.toThrow();
  });

  it('never treats literal release package keys as documentation placeholders', async () => {
    const root = await createFixture({
      'packages/current/package.json': pkg('@robota-sdk/current'),
      '.changeset/pending.md': '---\n"@robota-sdk/dag-nodes": patch\n---\nRelease a package.\n',
      '.changeset/pre.json': JSON.stringify({ initialVersions: { '@robota-sdk/foo': '1.0.0' } }),
    });
    expect((await findWorkspaceRefFindings(root)).map((finding) => finding.file).sort()).toEqual([
      '.changeset/pending.md',
      '.changeset/pre.json',
    ]);
  });

  it('resolves single-quoted literal filters without judging command arguments as packages', async () => {
    const root = await createFixture({
      'packages/current/package.json': pkg('@robota-sdk/current'),
      'docs/guide.md':
        "Run `pnpm --filter '@robota-sdk/renamed-away' test`.\nRun `pnpm --filter @robota-sdk/current exec echo @robota-sdk/example-data`.\n",
    });
    const findings = await findWorkspaceRefFindings(root);
    expect(findings).toHaveLength(1);
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
      'docs/guide.md': 'Current instructions.\n',
      'diagram.mmd': 'graph TD\n',
      'config.ts': '// Current source comment.\n',
      '.changeset/current.md': '---\n---\nHistorical release prose.\n',
    });

    await findWorkspaceRefFindings(root);

    expect(examinedManifestCount(), 'the manifest walk was miscounted').toBe(3);
    expect(examinedHelperScriptCount(), 'the helper-script walk was miscounted').toBe(2);
    expect(examinedReferenceFileCount()).toBe(2);
    expect(examinedSourceFileCount()).toBe(1);
    expect(examinedReleaseFileCount()).toBe(1);
  });

  it('RESETS between runs, so a later run cannot inherit an earlier tree size', async () => {
    const big = await createFixture({
      'package.json': JSON.stringify({ name: 'root', scripts: {} }),
      'packages/foo/package.json': JSON.stringify({ name: '@x/foo', scripts: {} }),
      'apps/bar/package.json': JSON.stringify({ name: '@x/bar', scripts: {} }),
      'scripts/one.mjs': 'export const a = 1;\n',
      'scripts/two.mjs': 'export const b = 2;\n',
      'docs/guide.md': 'Current instructions.\n',
      'config.ts': '// Current source comment.\n',
      '.changeset/current.md': '---\n---\nHistorical release prose.\n',
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
    expect(examinedReferenceFileCount()).toBe(1);
    expect(examinedSourceFileCount()).toBe(1);
    expect(examinedReleaseFileCount()).toBe(1);

    await findWorkspaceRefFindings(small);

    // BOTH counters, symmetrically with the sibling reset cases in this PR. The smaller fixture has
    // FEWER manifests rather than none, so an accumulating counter would read 5 here — a bug a
    // same-size fixture could not have distinguished from a correct reset. (#1684 review)
    expect(examinedManifestCount(), 'the manifest count carried over').toBe(2);
    expect(examinedHelperScriptCount(), 'the helper-script count carried over').toBe(0);
    expect(examinedReferenceFileCount()).toBe(0);
    expect(examinedSourceFileCount()).toBe(0);
    expect(examinedReleaseFileCount()).toBe(0);
  });
});
