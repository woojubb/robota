import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { findDoneEvidenceFindings } from '../check-done-evidence.mjs';

async function createFixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'robota-done-evidence-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(root, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, 'utf8');
  }
  return root;
}

describe('findDoneEvidenceFindings', () => {
  it('TC-01: an existing referenced path passes', async () => {
    const root = await createFixture({
      'packages/agent-cli/src/__tests__/feature.test.ts': '// test\n',
      '.agents/backlog/completed/ITEM-1.md': [
        '# ITEM-1',
        '## Evidence',
        '- CI test: `packages/agent-cli/src/__tests__/feature.test.ts` (5/5)',
      ].join('\n'),
    });

    const { findings, exemptions } = await findDoneEvidenceFindings(root);
    expect(findings).toEqual([]);
    expect(exemptions).toEqual([]);
  });

  it('TC-02: a missing referenced path fails naming the backlog file and the path', async () => {
    const root = await createFixture({
      '.agents/backlog/completed/ITEM-2.md': [
        '# ITEM-2',
        '## Evidence',
        '- CI test: `packages/agent-cli/src/__tests__/deleted.test.ts` (10/10)',
      ].join('\n'),
    });

    const { findings } = await findDoneEvidenceFindings(root);
    expect(findings).toEqual([
      {
        backlogFile: '.agents/backlog/completed/ITEM-2.md',
        path: 'packages/agent-cli/src/__tests__/deleted.test.ts',
        line: 3,
      },
    ]);
  });

  it('TC-03: prose without repo paths (and non-evidence prose with paths) is skipped', async () => {
    const root = await createFixture({
      '.agents/backlog/completed/ITEM-3.md': [
        '# ITEM-3',
        '## Problem',
        'The old `packages/agent-cli/src/legacy/removed-long-ago.ts` was refactored away.',
        '## Evidence',
        'Verified manually in the terminal; no file references here.',
      ].join('\n'),
    });

    const { findings, exemptions } = await findDoneEvidenceFindings(root);
    expect(findings).toEqual([]);
    expect(exemptions).toEqual([]);
  });

  it('TC-04: an evidence-superseded annotation exempts a missing path and is reported', async () => {
    const root = await createFixture({
      '.agents/backlog/completed/ITEM-4.md': [
        '# ITEM-4',
        '## Evidence',
        '<!-- evidence-superseded: replaced by the v2 suite -->',
        '- CI test: `packages/agent-cli/src/__tests__/old-suite.test.ts`',
      ].join('\n'),
    });

    const { findings, exemptions } = await findDoneEvidenceFindings(root);
    expect(findings).toEqual([]);
    expect(exemptions).toEqual([
      {
        backlogFile: '.agents/backlog/completed/ITEM-4.md',
        path: 'packages/agent-cli/src/__tests__/old-suite.test.ts',
        reason: 'replaced by the v2 suite',
      },
    ]);
  });

  it('closes the evidence region at the next non-evidence heading', async () => {
    const root = await createFixture({
      '.agents/backlog/completed/ITEM-5.md': [
        '# ITEM-5',
        '## Evidence',
        '- `packages/agent-cli/src/__tests__/gone.test.ts`',
        '## Notes',
        'Historical mention: `packages/agent-cli/src/also-gone.ts`',
      ].join('\n'),
    });

    const { findings } = await findDoneEvidenceFindings(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('packages/agent-cli/src/__tests__/gone.test.ts');
  });
});
