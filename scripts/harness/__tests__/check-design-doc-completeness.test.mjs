import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { findDesignDocFindings } from '../check-design-doc-completeness.mjs';
import { ADVISORY_MARKER } from '../run-all-scans.mjs';

const SCAN_SCRIPT = fileURLToPath(new URL('../check-design-doc-completeness.mjs', import.meta.url));

const GREEN_DESIGN_DOC = `# Session Store Design

See the owning [SPEC](../SPEC.md).

## Context & Goal

Why this component exists.

## Constraints

What binds the design.

## Internal Structure

The moving parts.

## Key Flows

The main sequences.

## Test Approach

How it is verified.
`;

async function createDesignDir(files) {
  const root = makeTemp('robota-design-doc-');
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(root, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, 'utf8');
  }
  return root;
}

describe('findDesignDocFindings', () => {
  // RULE-013: the reverse link. A design doc that points at its SPEC while the SPEC does not point
  // back is unreachable from the contract a reader starts at — which is how the whitebox material
  // ended up inside SPEC.md in the first place.
  const MUST_SECTIONS_DOC = [
    '# Renderer',
    '',
    'Realizes [the contract](../SPEC.md).',
    '',
    '## Context & Goal',
    'a',
    '## Constraints',
    'a',
    '## Internal Structure',
    'a',
    '## Key Flows',
    'a',
    '## Test Approach',
    'a',
    '',
  ].join('\n');

  it('warns when the owning SPEC does not link back', async () => {
    const root = await createDesignDir({
      'packages/widget/docs/SPEC.md': '# SPEC\n',
      'packages/widget/docs/design/renderer.md': MUST_SECTIONS_DOC,
    });
    const { warnings } = findDesignDocFindings(
      path.join(root, 'packages/widget/docs/design'),
      root,
    );
    expect(warnings.map((w) => w.detail).join(' ')).toMatch(/one-way/);
  });

  it('resolves the owning SPEC for a design doc nested under a topic directory', async () => {
    // The defect: `dirname(dirname(file))` resolved `docs/design/SPEC.md` for a nested doc, which
    // never exists, so the check silently passed — fail-open.
    const root = await createDesignDir({
      'packages/widget/docs/SPEC.md': '# SPEC\n',
      'packages/widget/docs/design/tui/renderer.md': MUST_SECTIONS_DOC.replace(
        '../SPEC.md',
        '../../SPEC.md',
      ),
    });
    const { warnings } = findDesignDocFindings(
      path.join(root, 'packages/widget/docs/design'),
      root,
    );
    expect(warnings.map((w) => w.detail).join(' ')).toMatch(/one-way/);
  });

  it('does not warn when the SPEC links back', async () => {
    const root = await createDesignDir({
      'packages/widget/docs/SPEC.md': '# SPEC\n\nSee [design](docs/design/renderer.md).\n',
      'packages/widget/docs/design/renderer.md': MUST_SECTIONS_DOC,
    });
    const { warnings } = findDesignDocFindings(
      path.join(root, 'packages/widget/docs/design'),
      root,
    );
    expect(warnings.map((w) => w.detail).join(' ')).not.toMatch(/one-way/);
  });

  it('passes a design doc with all MUST sections and a SPEC link', async () => {
    const root = await createDesignDir({ 'design/session-store.md': GREEN_DESIGN_DOC });
    const { blocking, warnings } = findDesignDocFindings(path.join(root, 'design'));
    expect(blocking).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it.each([
    ['Context & Goal', '## Context & Goal'],
    ['Constraints', '## Constraints'],
    ['Internal Structure', '## Internal Structure'],
    ['Key Flows', '## Key Flows'],
    ['Test Approach', '## Test Approach'],
  ])('flags a design doc missing the "%s" MUST section (RED)', async (label, heading) => {
    const root = await createDesignDir({
      'design/session-store.md': GREEN_DESIGN_DOC.replace(heading, '## Renamed'),
    });

    const { blocking } = findDesignDocFindings(path.join(root, 'design'));
    expect(blocking.map((f) => f.detail)).toContain(`missing "## ${label}" section`);
  });

  it('warns (non-blocking) when the SPEC link is missing', async () => {
    const root = await createDesignDir({
      'design/session-store.md': GREEN_DESIGN_DOC.replace(
        'See the owning [SPEC](../SPEC.md).\n\n',
        '',
      ),
    });

    const { blocking, warnings } = findDesignDocFindings(path.join(root, 'design'));
    expect(blocking).toEqual([]);
    expect(warnings.map((f) => f.detail)).toContain('no link to the owning SPEC.md — recommended');
  });

  it('is vacuously clean when the target dir has no markdown', async () => {
    const root = await createDesignDir({});
    const { blocking, warnings } = findDesignDocFindings(path.join(root, 'design'));
    expect(blocking).toEqual([]);
    expect(warnings).toEqual([]);
  });
});

describe('check-design-doc-completeness CLI', () => {
  function runScan(args) {
    try {
      const stdout = execFileSync(process.execPath, [SCAN_SCRIPT, ...args], { encoding: 'utf8' });
      return { status: 0, stdout };
    } catch (error) {
      return { status: error.status, stdout: `${error.stdout ?? ''}` };
    }
  }

  it('exits 0 with a pass message on a green fixture dir, naming the count it examined', async () => {
    const root = await createDesignDir({ 'design/session-store.md': GREEN_DESIGN_DOC });
    const result = runScan([path.join(root, 'design')]);
    // HARNESS-052: the count is the point. `passed.` alone read the same over one validated
    // document and over the empty set this scan had been reporting on since it was written.
    expect(result.stdout).toContain('design-doc completeness scan passed (1 design document(s)');
    expect(result.stdout).not.toContain(ADVISORY_MARKER);
    expect(result.status).toBe(0);
  });

  /**
   * The decision HARNESS-052 asked for, pinned. The design/LLD type is OPTIONAL, so zero documents
   * is a legitimate PASS — but it must not render as an ordinary tick, because "validated the
   * corpus" and "there was no corpus" were the same green for this scan's whole life.
   */
  it('marks a zero-document run as an advisory rather than a silent pass', async () => {
    const root = await createDesignDir({ 'design/notes.txt': 'not markdown' });
    const result = runScan([path.join(root, 'design')]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`${ADVISORY_MARKER} design-doc completeness examined 0`);
    // HARNESS-063: the zero is paired with the number of places looked in, so "no corpus" and
    // "a corpus that authored none" stop reading the same.
    expect(result.stdout).toContain(
      'design-doc completeness scan passed (0 design document(s) examined in 1 target path)',
    );
  });

  it('exits 1 and lists missing sections on a violating fixture (RED)', async () => {
    const root = await createDesignDir({
      'design/session-store.md': GREEN_DESIGN_DOC.replace('## Test Approach', '## QA Notes'),
    });

    const result = runScan([path.join(root, 'design')]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('design-doc completeness scan failed');
    expect(result.stdout).toContain('missing "## Test Approach" section');
  });

  /**
   * HARNESS-063 — a zero `examined` means something different depending on how many places were
   * looked in. Over this repository the numbers are 0 documents in 76 package design directories:
   * every package was enumerated and none authored a design doc, which is the honest reading the
   * unqualified `0` could not distinguish from "there was nowhere to look".
   */
  it('names how many locations it searched, not only how many documents it read', async () => {
    const root = await createDesignDir({
      'design/a.md': GREEN_DESIGN_DOC,
      'design/b.md': GREEN_DESIGN_DOC,
    });
    const result = runScan([path.join(root, 'design')]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      'design-doc completeness scan passed (2 design document(s) examined in 1 target path)',
    );
  });
});

/**
 * The auto-discovery denominator: how many package design directories were looked in. Over a
 * fixture workspace with a known package population, `searched` must equal that population — a
 * zero-document run in 3 packages is a different claim from a zero-document run in none.
 */
describe('findDesignDocFindings — the searched count when auto-discovering', () => {
  async function workspaceFixture(packages, designDocs = {}) {
    const root = makeTemp('robota-design-doc-ws-');
    for (const name of packages) {
      const dir = path.join(root, 'packages', name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'package.json'), `{"name":"${name}"}`, 'utf8');
    }
    for (const [rel, content] of Object.entries(designDocs)) {
      const abs = path.join(root, rel);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, content, 'utf8');
    }
    return root;
  }

  it('counts every manifest package as a place it looked, and the docs it found', async () => {
    const root = await workspaceFixture(['alpha', 'beta', 'gamma'], {
      'packages/beta/docs/design/store.md': GREEN_DESIGN_DOC,
    });
    const { examined, searched, blocking } = findDesignDocFindings(undefined, root);
    expect({ examined, searched }).toEqual({ examined: 1, searched: 3 });
    expect(blocking).toEqual([]);
  });

  it('reports 0 examined over 3 packages that authored none', async () => {
    const root = await workspaceFixture(['alpha', 'beta', 'gamma']);
    const { examined, searched } = findDesignDocFindings(undefined, root);
    expect({ examined, searched }).toEqual({ examined: 0, searched: 3 });
  });
});
