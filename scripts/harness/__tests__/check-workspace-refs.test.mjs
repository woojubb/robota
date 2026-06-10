import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { findWorkspaceRefFindings } from '../check-workspace-refs.mjs';

async function createFixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'robota-workspace-refs-'));
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
