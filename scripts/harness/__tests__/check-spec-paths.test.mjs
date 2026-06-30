import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { findSpecPathFindings } from '../check-spec-paths.mjs';

async function createFixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'robota-spec-paths-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(root, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, 'utf8');
  }
  return root;
}

describe('check-spec-paths', () => {
  it('reports a SPEC reference to a missing source file', async () => {
    const root = await createFixture({
      'packages/foo/docs/SPEC.md':
        'Module tree:\n- `src/real.ts` — exists\n- `src/ghost.ts` — deleted\n',
      'packages/foo/src/real.ts': 'export const x = 1;\n',
    });
    const findings = await findSpecPathFindings(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe('spec-ghost-path');
    expect(findings[0].detail).toContain('src/ghost.ts');
  });

  it('passes when every referenced path exists', async () => {
    const root = await createFixture({
      'packages/foo/docs/SPEC.md': 'See `src/real.ts` for details.\n',
      'packages/foo/src/real.ts': 'export const x = 1;\n',
    });
    expect(await findSpecPathFindings(root)).toHaveLength(0);
  });

  it('exempts lines annotated with (planned)', async () => {
    const root = await createFixture({
      'packages/foo/docs/SPEC.md': '- `src/future.ts` (planned)\n',
    });
    expect(await findSpecPathFindings(root)).toHaveLength(0);
  });

  it('does not resolve other-package absolute references against the local package', async () => {
    const root = await createFixture({
      'packages/foo/docs/SPEC.md': 'Consumes `packages/bar/src/lib.ts` contracts.\n',
      'packages/bar/src/lib.ts': 'export const y = 2;\n',
    });
    expect(await findSpecPathFindings(root)).toHaveLength(0);
  });

  it('reports repo-rooted references to missing files', async () => {
    const root = await createFixture({
      'packages/foo/docs/SPEC.md': 'Consumes `packages/bar/src/gone.ts`.\n',
    });
    const findings = await findSpecPathFindings(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toContain('packages/bar/src/gone.ts');
  });

  it('covers nested package-group members (e.g. packages/dag-nodes/<name>)', async () => {
    const root = await createFixture({
      // The group container itself owns no SPEC.md — only its members do.
      'packages/group/member/docs/SPEC.md': '- `src/ghost.ts` — deleted\n',
    });
    const findings = await findSpecPathFindings(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toContain('src/ghost.ts');
    expect(findings[0].file).toContain(path.join('group', 'member'));
  });
});
