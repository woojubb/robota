import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { findSpecDocFrontmatterFindings } from '../check-spec-doc-frontmatter.mjs';

const SCAN_SCRIPT = fileURLToPath(new URL('../check-spec-doc-frontmatter.mjs', import.meta.url));

const GREEN_SPEC = `---
status: draft
type: RULE
tags: [harness, gate]
---

# RULE-001: fixture spec
`;

async function createFixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'robota-spec-frontmatter-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(root, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, 'utf8');
  }
  return root;
}

describe('findSpecDocFrontmatterFindings', () => {
  it('passes a spec-doc with valid status, type, and tags', async () => {
    const root = await createFixture({ 'draft/RULE-001-fixture.md': GREEN_SPEC });
    const { blocking, warnings } = findSpecDocFrontmatterFindings(root);
    expect(blocking).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('flags a spec-doc with no frontmatter block (RED)', async () => {
    const root = await createFixture({
      'draft/RULE-002-nofm.md': '# RULE-002: no frontmatter\n',
    });

    const { blocking } = findSpecDocFrontmatterFindings(root);
    expect(blocking).toHaveLength(1);
    expect(blocking[0].detail).toBe('missing frontmatter block');
  });

  it('flags an invalid status (RED)', async () => {
    const root = await createFixture({
      'draft/RULE-003-badstatus.md': GREEN_SPEC.replace('status: draft', 'status: cooking'),
    });

    const { blocking } = findSpecDocFrontmatterFindings(root);
    expect(blocking).toHaveLength(1);
    expect(blocking[0].detail).toContain('status "cooking" not in {');
  });

  it('flags an invalid type (RED)', async () => {
    const root = await createFixture({
      'draft/RULE-004-badtype.md': GREEN_SPEC.replace('type: RULE', 'type: FEATURE'),
    });

    const { blocking } = findSpecDocFrontmatterFindings(root);
    expect(blocking).toHaveLength(1);
    expect(blocking[0].detail).toContain('type "FEATURE" not one of the 11 SDLC prefixes');
  });

  it('flags missing/empty tags (RED)', async () => {
    const root = await createFixture({
      'draft/RULE-005-notags.md': GREEN_SPEC.replace('tags: [harness, gate]', 'tags: []'),
    });

    const { blocking } = findSpecDocFrontmatterFindings(root);
    expect(blocking).toHaveLength(1);
    expect(blocking[0].detail).toBe('tags missing or empty');
  });

  it('warns (non-blocking) on duplicate spec-doc IDs across stages', async () => {
    const root = await createFixture({
      'draft/RULE-006-dup.md': GREEN_SPEC,
      'done/RULE-006-dup-copy.md': GREEN_SPEC.replace('status: draft', 'status: done'),
    });

    const { blocking, warnings } = findSpecDocFrontmatterFindings(root);
    expect(blocking).toEqual([]);
    expect(warnings).toEqual([{ file: 'RULE-006', detail: 'duplicate spec-doc ID (2 files)' }]);
  });

  it('skips README.md files', async () => {
    const root = await createFixture({
      'draft/README.md': '# Stage README (no frontmatter, allowed)\n',
      'draft/RULE-007-ok.md': GREEN_SPEC,
    });

    const { blocking } = findSpecDocFrontmatterFindings(root);
    expect(blocking).toEqual([]);
  });
});

describe('check-spec-doc-frontmatter CLI', () => {
  function runScan(args) {
    try {
      const stdout = execFileSync(process.execPath, [SCAN_SCRIPT, ...args], { encoding: 'utf8' });
      return { status: 0, stdout };
    } catch (error) {
      return { status: error.status, stdout: `${error.stdout ?? ''}` };
    }
  }

  it('exits 0 with a pass message on a green fixture dir', async () => {
    const root = await createFixture({ 'draft/RULE-001-fixture.md': GREEN_SPEC });
    const result = runScan([root]);
    expect(result.stdout).toContain('spec-doc frontmatter scan passed.');
    expect(result.status).toBe(0);
  });

  it('exits 1 and lists blocking findings on a violating fixture dir (RED)', async () => {
    const root = await createFixture({
      'draft/RULE-002-nofm.md': '# RULE-002: no frontmatter\n',
    });

    const result = runScan([root]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('spec-doc frontmatter scan failed:');
    expect(result.stdout).toContain('missing frontmatter block');
  });

  it('exits 0 when the only findings are duplicate-ID warnings', async () => {
    const root = await createFixture({
      'draft/RULE-006-dup.md': GREEN_SPEC,
      'done/RULE-006-dup-copy.md': GREEN_SPEC.replace('status: draft', 'status: done'),
    });

    const result = runScan([root]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('[warn] RULE-006: duplicate spec-doc ID (2 files)');
    expect(result.stdout).toContain('spec-doc frontmatter scan passed.');
  });
});
