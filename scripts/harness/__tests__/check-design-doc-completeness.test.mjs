import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { findDesignDocFindings } from '../check-design-doc-completeness.mjs';

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
  const root = await mkdtemp(path.join(tmpdir(), 'robota-design-doc-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(root, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, 'utf8');
  }
  return root;
}

describe('findDesignDocFindings', () => {
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

  it('exits 0 with a pass message on a green fixture dir', async () => {
    const root = await createDesignDir({ 'design/session-store.md': GREEN_DESIGN_DOC });
    const result = runScan([path.join(root, 'design')]);
    expect(result.stdout).toContain('design-doc completeness scan passed.');
    expect(result.status).toBe(0);
  });

  it('exits 1 and lists missing sections on a violating fixture (RED)', async () => {
    const root = await createDesignDir({
      'design/session-store.md': GREEN_DESIGN_DOC.replace('## Test Approach', '## QA Notes'),
    });

    const result = runScan([path.join(root, 'design')]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('design-doc completeness scan failed:');
    expect(result.stdout).toContain('missing "## Test Approach" section');
  });
});
