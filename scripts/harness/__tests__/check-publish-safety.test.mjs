import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { findPublishClaimFindings } from '../check-publish-safety.mjs';

async function createFixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'robota-publish-safety-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(root, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, 'utf8');
  }
  return root;
}

function pkgJson(name, { isPrivate }) {
  return JSON.stringify({ name, ...(isPrivate ? { private: true } : { version: '1.0.0' }) });
}

describe('findPublishClaimFindings (absorbed check-spec-publish-claims — Guard G4 / AF-15)', () => {
  it('catches the original incident shape: a private package whose SPEC claims npm publication', async () => {
    const root = await createFixture({
      'packages/agent-tool-mcp/package.json': pkgJson('@robota-sdk/agent-tool-mcp', {
        isPrivate: true,
      }),
      'packages/agent-tool-mcp/docs/SPEC.md':
        '# agent-tool-mcp\n\nThis package is published to npm as @robota-sdk/agent-tool-mcp.\n',
    });

    const findings = findPublishClaimFindings(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe('spec-false-publish-claim');
    expect(findings[0].file).toBe(path.join('packages/agent-tool-mcp/docs', 'SPEC.md'));
    expect(findings[0].detail).toContain('line 3');
  });

  it('covers nested package-group members (INFRA-021 nesting-aware)', async () => {
    const root = await createFixture({
      'packages/dag-nodes/dag-node-foo/package.json': pkgJson('@robota-sdk/dag-node-foo', {
        isPrivate: true,
      }),
      'packages/dag-nodes/dag-node-foo/docs/SPEC.md': '# foo\n\nPublished to npm.\n',
    });

    const findings = findPublishClaimFindings(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].file).toContain('dag-node-foo');
  });

  it('does NOT flag a negated publication statement in a private package', async () => {
    const root = await createFixture({
      'packages/internal-tool/package.json': pkgJson('@robota-sdk/internal-tool', {
        isPrivate: true,
      }),
      'packages/internal-tool/docs/SPEC.md':
        '# internal-tool\n\nThis package is NOT published to npm (internal only).\n',
    });

    expect(findPublishClaimFindings(root)).toEqual([]);
  });

  it('does NOT flag a public package that claims npm publication', async () => {
    const root = await createFixture({
      'packages/agent-core/package.json': pkgJson('@robota-sdk/agent-core', { isPrivate: false }),
      'packages/agent-core/docs/SPEC.md': '# agent-core\n\nPublished to npm.\n',
    });

    expect(findPublishClaimFindings(root)).toEqual([]);
  });
});
