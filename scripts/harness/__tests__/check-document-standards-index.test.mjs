import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { findDocumentStandardsFindings } from '../check-document-standards-index.mjs';

const SCAN_SCRIPT = fileURLToPath(
  new URL('../check-document-standards-index.mjs', import.meta.url),
);

const GREEN_INDEX = `# Document Standards Index

See the [architecture map](./linked-doc.md) for structure docs.

| Document type | Status  | Follow-on |
| ------------- | ------- | --------- |
| SPEC.md       | defined | —         |
| design/LLD    | partial | RULE-009  |
`;

async function createFixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'robota-doc-standards-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(root, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, 'utf8');
  }
  return root;
}

const INDEX_REL = 'index.md';

describe('findDocumentStandardsFindings', () => {
  it('passes an index with resolving links and a legal taxonomy table', async () => {
    const root = await createFixture({
      [INDEX_REL]: GREEN_INDEX,
      'linked-doc.md': '# Linked\n',
    });

    expect(findDocumentStandardsFindings(path.join(root, INDEX_REL))).toEqual([]);
  });

  it('flags a missing index file (RED)', async () => {
    const root = await createFixture({});
    const findings = findDocumentStandardsFindings(path.join(root, INDEX_REL));
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe('index-missing');
  });

  it('flags a ghost link target (RED)', async () => {
    const root = await createFixture({ [INDEX_REL]: GREEN_INDEX });

    const findings = findDocumentStandardsFindings(path.join(root, INDEX_REL));
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe('ghost-pointer');
    expect(findings[0].detail).toContain('"./linked-doc.md" does not resolve');
  });

  it('flags a missing taxonomy table (RED)', async () => {
    const root = await createFixture({
      [INDEX_REL]: '# Index\n\nNo table here.\n',
    });

    const findings = findDocumentStandardsFindings(path.join(root, INDEX_REL));
    expect(findings).toEqual([
      { type: 'taxonomy-missing', detail: 'no artifact-taxonomy table found.' },
    ]);
  });

  it('flags a status outside defined/partial/gap (RED)', async () => {
    const root = await createFixture({
      [INDEX_REL]: GREEN_INDEX.replace(
        '| SPEC.md       | defined |',
        '| SPEC.md       | golden  |',
      ),
      'linked-doc.md': '# Linked\n',
    });

    const findings = findDocumentStandardsFindings(path.join(root, INDEX_REL));
    expect(findings).toEqual([
      {
        type: 'bad-status',
        detail: '"SPEC.md": status "golden" is not one of defined/partial/gap.',
      },
    ]);
  });

  it('flags a partial/gap row without a follow-on (RED)', async () => {
    const root = await createFixture({
      [INDEX_REL]: GREEN_INDEX.replace(
        '| design/LLD    | partial | RULE-009  |',
        '| design/LLD    | partial | —         |',
      ),
      'linked-doc.md': '# Linked\n',
    });

    const findings = findDocumentStandardsFindings(path.join(root, INDEX_REL));
    expect(findings).toEqual([
      { type: 'missing-follow-on', detail: '"design/LLD": status partial but no follow-on named.' },
    ]);
  });

  it('ignores external links and pure anchors', async () => {
    const root = await createFixture({
      [INDEX_REL]:
        GREEN_INDEX.replace('(./linked-doc.md)', '(https://example.com/doc)') +
        '\nJump to [the table](#taxonomy).\n',
    });

    expect(findDocumentStandardsFindings(path.join(root, INDEX_REL))).toEqual([]);
  });
});

describe('check-document-standards-index CLI', () => {
  function runScan(args) {
    try {
      const stdout = execFileSync(process.execPath, [SCAN_SCRIPT, ...args], { encoding: 'utf8' });
      return { status: 0, stdout };
    } catch (error) {
      return { status: error.status, stdout: `${error.stdout ?? ''}` };
    }
  }

  it('exits 0 with a pass message on a green fixture index', async () => {
    const root = await createFixture({
      [INDEX_REL]: GREEN_INDEX,
      'linked-doc.md': '# Linked\n',
    });

    const result = runScan([path.join(root, INDEX_REL)]);
    expect(result.stdout).toContain('document-standards index scan passed.');
    expect(result.status).toBe(0);
  });

  it('exits 1 and lists findings on a violating fixture index (RED)', async () => {
    const root = await createFixture({ [INDEX_REL]: GREEN_INDEX });

    const result = runScan([path.join(root, INDEX_REL)]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('document-standards index scan failed:');
    expect(result.stdout).toContain('[ghost-pointer]');
  });
});
