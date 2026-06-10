import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { findStubMarkerFindings } from '../check-stub-markers.mjs';

async function createFixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'robota-stub-markers-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(root, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, 'utf8');
  }
  return root;
}

function pkg(name, extra = {}) {
  return JSON.stringify({ name, version: '0.0.0', ...extra });
}

describe('check-stub-markers', () => {
  it('reports stub markers in publishable package sources', async () => {
    const root = await createFixture({
      'packages/foo/package.json': pkg('@robota-sdk/foo'),
      'packages/foo/src/engine.ts':
        "// TODO: Implement actual logic\nthrow new Error('Not implemented: engine is unavailable');\n",
    });
    const findings = await findStubMarkerFindings(root);
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings[0].type).toBe('stub-marker');
    expect(findings[0].file).toContain('engine.ts');
  });

  it('exempts test files and private packages', async () => {
    const root = await createFixture({
      'packages/foo/package.json': pkg('@robota-sdk/foo'),
      'packages/foo/src/__tests__/engine.test.ts': "expect(msg).toBe('Not implemented');\n",
      'packages/foo/src/engine.spec.ts': '// TODO: Implement in spec helper\n',
      'packages/priv/package.json': pkg('@robota-sdk/priv', { private: true }),
      'packages/priv/src/wip.ts': "throw new Error('Not implemented');\n",
    });
    expect(await findStubMarkerFindings(root)).toHaveLength(0);
  });

  it('passes on clean sources', async () => {
    const root = await createFixture({
      'packages/foo/package.json': pkg('@robota-sdk/foo'),
      'packages/foo/src/engine.ts': 'export const run = () => 42;\n',
    });
    expect(await findStubMarkerFindings(root)).toHaveLength(0);
  });
});
