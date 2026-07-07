import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { findGhostPackageRefFindings } from '../check-ghost-package-refs.mjs';

async function createFixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'robota-ghost-refs-'));
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

  it('passes on the live repository (exit 0, no findings)', async () => {
    expect(await findGhostPackageRefFindings()).toHaveLength(0);
  });
});
