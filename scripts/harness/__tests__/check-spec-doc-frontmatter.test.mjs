import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeTemp } from './make-temp.mjs';

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

/**
 * Byte-exact prettier output for a `tags` flow array past printWidth: the key stands alone
 * and every item is exploded onto its own indented line. Verified by running the repo's
 * prettier over the single-line source (HARNESS-044).
 */
const WRAPPED_TAGS_SPEC = `---
status: draft
type: RULE
tags:
  [
    architecture,
    harness,
    frontmatter,
    formatter-drift,
    verification,
    spec-docs,
    backlog-execution,
    enforcement-architecture,
    continuous-integration,
  ]
completed: 2026-07-25
---

# RULE-010: prettier-wrapped tags fixture
`;

/**
 * The other prettier wrapping: just past printWidth, the whole bracketed list moves to a
 * single indented line below the key.
 */
const COMPACT_WRAPPED_TAGS_SPEC = `---
status: draft
type: RULE
tags:
  [architecture, harness, frontmatter, formatter-drift, verification, spec-docs]
completed: 2026-07-25
---

# RULE-015: compact prettier-wrapped tags fixture
`;

/** Canonical YAML block-sequence form. */
const BLOCK_SEQUENCE_TAGS_SPEC = `---
status: draft
type: RULE
tags:
  - harness
  - gate
---

# RULE-012: block-sequence tags fixture
`;

async function createFixture(files) {
  const root = makeTemp('robota-spec-frontmatter-');
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

  it('accepts a prettier-wrapped multi-line tags array (HARNESS-044)', async () => {
    const root = await createFixture({ 'draft/RULE-010-wrapped.md': WRAPPED_TAGS_SPEC });

    const { blocking, warnings } = findSpecDocFrontmatterFindings(root);
    expect(blocking).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('accepts the compact prettier wrapping (list on one indented line) (HARNESS-044)', async () => {
    const root = await createFixture({ 'draft/RULE-015-compact.md': COMPACT_WRAPPED_TAGS_SPEC });

    const { blocking } = findSpecDocFrontmatterFindings(root);
    expect(blocking).toEqual([]);
  });

  it('still reads scalar keys that FOLLOW a wrapped multi-line array (HARNESS-044)', async () => {
    // The wrapped block must not swallow the keys after it: corrupt `status` and prove
    // it is still the value that gets reported.
    const root = await createFixture({
      'draft/RULE-011-wrapped-badstatus.md': WRAPPED_TAGS_SPEC.replace(
        'status: draft',
        'status: cooking',
      ),
    });

    const { blocking } = findSpecDocFrontmatterFindings(root);
    expect(blocking).toHaveLength(1);
    expect(blocking[0].detail).toContain('status "cooking" not in {');
  });

  it('accepts a YAML block-sequence tags list (HARNESS-044)', async () => {
    const root = await createFixture({ 'draft/RULE-012-sequence.md': BLOCK_SEQUENCE_TAGS_SPEC });

    const { blocking } = findSpecDocFrontmatterFindings(root);
    expect(blocking).toEqual([]);
  });

  it('still flags an EMPTY wrapped tags array (the check is not weakened)', async () => {
    const root = await createFixture({
      'draft/RULE-013-wrapped-empty.md': `---
status: draft
type: RULE
tags:
  [
  ]
---

# RULE-013: empty wrapped tags
`,
    });

    const { blocking } = findSpecDocFrontmatterFindings(root);
    expect(blocking).toHaveLength(1);
    expect(blocking[0].detail).toBe('tags missing or empty');
  });

  it('still flags a tags key with no value at all (the check is not weakened)', async () => {
    const root = await createFixture({
      'draft/RULE-014-bare-tags.md': `---
status: draft
type: RULE
tags:
---

# RULE-014: bare tags key
`,
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

  it('exits 0 on a prettier-wrapped multi-line tags array (HARNESS-044)', async () => {
    const root = await createFixture({ 'draft/RULE-010-wrapped.md': WRAPPED_TAGS_SPEC });
    const result = runScan([root]);
    expect(result.stdout).toContain('spec-doc frontmatter scan passed.');
    expect(result.status).toBe(0);
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

describe('the subject cannot be absent and still read as clean', () => {
  it('refuses a spec-docs tree that is not there', async () => {
    // PROC-006 prerequisite, measured 2026-08-01: this finder returned `{blocking: [], warnings: []}`
    // over a root with no `.agents/spec-docs`, which is what it also returns when 242 documents are
    // all correct. It governs the tree PROC-006 moves.
    //
    // `scan-guard-scope-fail-closed` did not catch it, and its header says why: the finder set is
    // derived from `export function find…(root`, and this one takes a target instead.
    //
    // Directory mode only — the single-FILE mode below must keep working, since that is how the
    // pre-commit path checks one document.
    const root = makeTemp('absent-spec-docs-fm-');
    expect(
      () => findSpecDocFrontmatterFindings(path.join(root, '.agents/spec-docs')),
      'an absent subject was reported as clean',
    ).toThrow(/spec-docs/);
  });
});
