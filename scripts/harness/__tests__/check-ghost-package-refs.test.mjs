import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { findGhostPackageRefFindings } from '../check-ghost-package-refs.mjs';

async function createFixture(files) {
  const root = makeTemp('robota-ghost-refs-');
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(root, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, 'utf8');
  }
  return root;
}

function pkg(name) {
  return JSON.stringify({ name, version: '0.0.0' });
}

describe('check-ghost-package-refs', () => {
  it('flags a doc referencing an unknown @robota-sdk/<name> npm token', async () => {
    const root = await createFixture({
      'packages/foo/package.json': pkg('@robota-sdk/foo'),
      'docs/overview.md': 'The `@robota-sdk/foo` package builds on @robota-sdk/ghost internals.\n',
    });
    const findings = await findGhostPackageRefFindings(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe('ghost-package-ref');
    expect(findings[0].detail).toContain('@robota-sdk/ghost');
  });

  it('flags a non-SPEC doc referencing an unknown packages/<name> directory', async () => {
    const root = await createFixture({
      'packages/foo/package.json': pkg('@robota-sdk/foo'),
      'docs/layout.md': 'Runtime lives in packages/foo; legacy code moved to packages/ghostpkg.\n',
    });
    const findings = await findGhostPackageRefFindings(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe('ghost-package-path');
    expect(findings[0].detail).toContain('packages/ghostpkg');
  });

  /**
   * HARNESS-068: a package name in backticks is how the front door writes one.
   *
   * The stale `packages/agent-provider` in `CONTRIBUTING.md` sat in an inline code span, and this
   * scan strips those — so it read the file, found nothing, and passed. Review round 13 measured it:
   * un-backtick that one line at the merge-base and the scan fires. The blind spot was the
   * exemption, not the file list, so the exemption is lifted for the four documents a newcomer reads
   * as the CURRENT description of the repository, and kept everywhere else.
   */
  it('(RED) scans inline code spans in a front-door document', async () => {
    const root = await createFixture({
      'packages/foo/package.json': pkg('@robota-sdk/foo'),
      'CONTRIBUTING.md': '- `packages/ghostpkg` — the runtime\n',
    });
    const findings = await findGhostPackageRefFindings(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toContain('packages/ghostpkg');
  });

  it('a placeholder in a command template is not a package name', async () => {
    // Needed only because the span exemption is lifted at the front door: `--scope <packages/foo>` is
    // a usage string. Reporting it would be a false accusation about correct prose, and a check that
    // cries wolf on the four most-read documents gets suppressed rather than obeyed.
    const root = await createFixture({
      'packages/foo2/package.json': pkg('@robota-sdk/foo2'),
      'AGENTS.md': '- `--scope <packages/foo|apps/bar>` selects a scope; `packages/baz` too\n',
    });
    expect(await findGhostPackageRefFindings(root)).toHaveLength(0);
  });

  it('still exempts inline code spans everywhere else', async () => {
    // The other direction, and the reason the exemption exists: an ordinary document quoting a
    // command or a defunct name in backticks is not asserting that the package exists.
    const root = await createFixture({
      'packages/foo/package.json': pkg('@robota-sdk/foo'),
      'docs/guide.md': 'Run `pnpm --filter packages/ghostpkg build` for the old layout.\n',
    });
    expect(await findGhostPackageRefFindings(root)).toHaveLength(0);
  });

  it('a front-door FENCE is still exempt — a transcript is not a claim', async () => {
    const root = await createFixture({
      'packages/foo/package.json': pkg('@robota-sdk/foo'),
      'README.md': '```sh\ncd packages/ghostpkg\n```\n',
    });
    expect(await findGhostPackageRefFindings(root)).toHaveLength(0);
  });

  it('does not double-cover packages/<name> tokens inside docs/SPEC.md', async () => {
    const root = await createFixture({
      'packages/foo/package.json': pkg('@robota-sdk/foo'),
      'packages/foo/docs/SPEC.md': 'Source under packages/ghostpkg is out of scope here.\n',
    });
    // The bare-path edge is skipped for SPEC.md (check-spec-paths owns it) — no ghost-package-path.
    const findings = await findGhostPackageRefFindings(root);
    expect(findings.filter((f) => f.type === 'ghost-package-path')).toHaveLength(0);
  });

  it('exempts tokens in code fences, on absence-vocab lines, and in the allowlist', async () => {
    const root = await createFixture({
      'packages/foo/package.json': pkg('@robota-sdk/foo'),
      'docs/exempt.md': [
        '```ts',
        "import x from '@robota-sdk/ghost'; // packages/ghostpkg",
        '```',
        'The `@robota-sdk/ghost` inline span and `packages/ghostpkg` are exempt.',
        '@robota-sdk/ghost was renamed (removed) — see packages/ghostpkg (removed).',
        // @robota-sdk/dag-nodes is a documented GHOST_PACKAGE_ALLOWLIST entry.
        'The @robota-sdk/dag-nodes group container is intentional.',
      ].join('\n'),
    });
    expect(await findGhostPackageRefFindings(root)).toHaveLength(0);
  });

  it('reuses check-workspace-refs SSOT (TOKEN_PATTERN + listWorkspacePackageNames), not a fork', async () => {
    const source = readFileSync(
      new URL('../check-ghost-package-refs.mjs', import.meta.url),
      'utf8',
    );
    expect(source).toMatch(
      /import\s*\{[^}]*\bTOKEN_PATTERN\b[^}]*\blistWorkspacePackageNames\b[^}]*\}\s*from\s*'\.\/check-workspace-refs\.mjs'/s,
    );
    // No forked @robota-sdk regex literal of its own.
    expect(source).not.toMatch(/@robota-sdk\\\//);
  });

  /**
   * HARNESS-052. The allowlist called `@robota-sdk/agent-provider-bytedance` "not a workspace
   * package"; it was one. Falsified before the removal: a doc referencing that token in a workspace
   * WITHOUT the package returned ZERO findings — the guard reporting clean over the exact shape it
   * exists to catch. An entry that resolves is stale by construction, so it is now a finding.
   *
   * The rule is matched per SHAPE — a name token against the manifest names, a `packages/<dir>`
   * token against the directory names. Checking both flagged `@robota-sdk/dag-nodes`, whose
   * directory exists as a group container shipping no package: a false positive caught by running
   * the rule rather than by reasoning about it.
   */
  it('reports an allowlist entry that resolves to a real workspace package', async () => {
    const root = await createFixture({
      'package.json': pkg('root'),
      'packages/dag-nodes/leaf/package.json': pkg('@robota-sdk/dag-nodes'),
    });
    const findings = await findGhostPackageRefFindings(root);
    expect(findings.map((f) => f.type)).toContain('stale-allowlist-entry');
  });

  it('does not flag a group-container path whose directory ships no package', async () => {
    const root = await createFixture({
      'package.json': pkg('root'),
      'packages/dag-nodes/leaf/package.json': pkg('@robota-sdk/dag-node-leaf'),
    });
    const findings = await findGhostPackageRefFindings(root);
    expect(findings.filter((f) => f.type === 'stale-allowlist-entry')).toHaveLength(0);
  });

  it('passes on the live repository (exit 0, no findings)', async () => {
    expect(await findGhostPackageRefFindings()).toHaveLength(0);
  });
});
