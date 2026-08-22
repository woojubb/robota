import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { examinedSourceFileCount, findStubMarkerFindings } from '../check-stub-markers.mjs';

async function createFixture(files) {
  const root = makeTemp('robota-stub-markers-');
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

  it('covers nested package-group members (e.g. packages/dag-nodes/<name>)', async () => {
    const root = await createFixture({
      // The group container itself has no package.json — only its members do.
      'packages/group/member/package.json': pkg('@robota-sdk/member'),
      'packages/group/member/src/wip.ts':
        "// TODO: Implement actual logic\nthrow new Error('Not implemented: member is unavailable');\n",
    });
    const findings = await findStubMarkerFindings(root);
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings[0].file).toContain(path.join('group', 'member', 'src', 'wip.ts'));
  });
});

describe('the examined-size counter measures the walk, and only this run (HARNESS-057)', () => {
  /**
   * The counter is what the `::examined::` line reports, so an unverified counter is a scan that
   * claims a size nothing checked — the very defect this migration exists to prevent, one level up.
   * It is not hypothetical: the first version of the sibling counter in `scan-conflict-markers`
   * reported one of its two walks as the whole subject, and only review caught it. (#1684 review)
   */
  it('counts the source files the walk actually read', async () => {
    const root = await createFixture({
      'packages/foo/package.json': pkg('@robota-sdk/foo'),
      'packages/foo/src/a.ts': 'export const a = 1;\n',
      'packages/foo/src/b.ts': 'export const b = 2;\n',
      'packages/foo/src/nested/c.ts': 'export const c = 3;\n',
      // Excluded from the walk, so excluded from the count: a test file and a private package.
      'packages/foo/src/__tests__/a.test.ts': 'it("x", () => {});\n',
      'packages/priv/package.json': pkg('@robota-sdk/priv', { private: true }),
      'packages/priv/src/d.ts': 'export const d = 4;\n',
    });

    await findStubMarkerFindings(root);

    expect(examinedSourceFileCount(), 'the count must be the files the walk read').toBe(3);
  });

  it('RESETS between runs, so a later run cannot inherit an earlier tree size', async () => {
    // A holder that is not reset reports the largest run it ever saw — and the run that examined
    // NOTHING is exactly where an inflated number would be believed.
    const big = await createFixture({
      'packages/foo/package.json': pkg('@robota-sdk/foo'),
      'packages/foo/src/a.ts': 'export const a = 1;\n',
      'packages/foo/src/b.ts': 'export const b = 2;\n',
    });
    const empty = await createFixture({
      'packages/foo/package.json': pkg('@robota-sdk/foo'),
    });

    await findStubMarkerFindings(big);
    expect(examinedSourceFileCount()).toBe(2);

    await findStubMarkerFindings(empty);

    expect(examinedSourceFileCount(), "the empty run reported the previous run's size").toBe(0);
  });
});
