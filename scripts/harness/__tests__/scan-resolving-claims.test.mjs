import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  findClaimFindings,
  findUnresolvedLinks,
  isTemplateSlot,
  knownItemIds,
  scanResolvingClaims,
} from '../scan-resolving-claims.mjs';

/**
 * A claim must name something that exists.
 *
 * Nine or more occurrences of the opposite, six reconciliation passes in seven days, five items moved
 * back out of `completed/` — and every one was decidable without judging whether the work was done,
 * because a name either resolves or it does not.
 */
const scratch = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const nothingResolves = { resolves: () => false };

describe('a link that names nothing', () => {
  it('is caught', () => {
    expect(
      findUnresolvedLinks('See [it](../gone.md).', nothingResolves).map((f) => f.target),
    ).toEqual(['../gone.md']);
  });

  it('is not caught inside a fenced specimen', () => {
    expect(findUnresolvedLinks('```\n[a](../gone.md)\n```', nothingResolves)).toEqual([]);
  });

  it('is not caught when the line declares why, with a reason', () => {
    expect(
      findUnresolvedLinks(
        '[a](../gone.md) <!-- allow-unresolved: shown on purpose -->',
        nothingResolves,
      ),
    ).toEqual([]);
    // A declaration with no reason is not a declaration.
    expect(
      findUnresolvedLinks('[a](../gone.md) <!-- allow-unresolved: -->', nothingResolves),
    ).toHaveLength(1);
  });

  it('does not fire on a template slot, which names a form rather than a file', () => {
    // A template whose paths resolved would be a template of one package.
    expect(isTemplateSlot('packages/<pkg>/docs/SPEC.md')).toBe(true);
    expect(isTemplateSlot('packages/*/docs/SPEC.md')).toBe(true);
    expect(isTemplateSlot('../tasks/REAL-001-thing.md')).toBe(false);
    expect(findUnresolvedLinks('[SPEC](../<pkg>/SPEC.md)', nothingResolves)).toEqual([]);
  });
});

describe('a claim that names nothing', () => {
  const idExists = (id) => id === 'REAL-001';

  it('catches a FILED naming an item that does not exist, and passes one that does', () => {
    // The instance that filed this: three findings marked FILED, nothing filed, found weeks later.
    expect(findClaimFindings('- D7 — FILED: GHOST-060', { idExists }).map((f) => f.kind)).toEqual([
      'filed-nothing',
    ]);
    expect(findClaimFindings('- D7 — FILED: REAL-001', { idExists })).toEqual([]);
  });

  it('catches a ticked box whose own text says the work is not finished', () => {
    expect(
      findClaimFindings('- [x] the second half is filed as REAL-001', { idExists }).map(
        (f) => f.kind,
      ),
    ).toContain('ticked-but-unfinished');
    expect(findClaimFindings('- [x] done, and proven', { idExists })).toEqual([]);
  });

  it('does not read a directory named todo/ as an unfinished marker', () => {
    // Measured on this scan's first run: a case-insensitive `TODO` matched the path segment `todo/`
    // inside a perfectly finished checklist item — a guard firing on a correct state.
    expect(
      findClaimFindings('- [x] gates the live pipeline (`backlog/`, `todo/`, `active/`)', {
        idExists,
      }),
    ).toEqual([]);
    // The marker itself still counts.
    expect(
      findClaimFindings('- [x] shipped — TODO: wire the second half', { idExists }).map(
        (f) => f.kind,
      ),
    ).toContain('ticked-but-unfinished');
  });
});

describe('what counts as a defined ID', () => {
  it('counts a document, and a section heading inside one', () => {
    // An audit numbers its own findings as headings and cross-references them by number. Reading
    // filenames alone reported one of those as naming nothing while it was defined forty lines above.
    const root = mkdtempSync(path.join(tmpdir(), 'claims-'));
    scratch.push(root);
    mkdirSync(path.join(root, '.agents/tasks'), { recursive: true });
    mkdirSync(path.join(root, '.agents/specs'), { recursive: true });
    writeFileSync(path.join(root, '.agents/tasks/REAL-001-a-thing.md'), '# REAL-001\n');
    writeFileSync(path.join(root, '.agents/specs/audit.md'), '### SOME-019: a finding\n');

    const ids = knownItemIds(root);
    expect(ids.has('REAL-001'), 'a document did not define its own ID').toBe(true);
    expect(ids.has('SOME-019'), 'a heading did not define an ID').toBe(true);
  });
});

describe('over the tree it governs', () => {
  it('refuses a root with no live tree, and one with no documents', () => {
    // Fail closed: a sweep over a tree that is not there finds nothing, and nothing is not clean.
    const dir = mkdtempSync(path.join(tmpdir(), 'claims-empty-'));
    scratch.push(dir);
    expect(() => scanResolvingClaims(dir)).toThrow(/does not exist/);

    mkdirSync(path.join(dir, '.agents'), { recursive: true });
    expect(() => scanResolvingClaims(dir)).toThrow(/no documents to examine/);
  });

  it('exempts the archived trees, and says so rather than leaving it implicit', () => {
    const source = readFileSync(
      path.resolve(import.meta.dirname, '../scan-resolving-claims.mjs'),
      'utf8',
    );
    expect(source).toMatch(/historical records/i);
  });

  it('finds the live tree at zero', () => {
    const { findings, examined } = scanResolvingClaims();

    expect(examined, 'the scan examined almost no documents').toBeGreaterThan(100);
    expect(findings).toEqual([]);
  });

  it('is registered, so it runs', () => {
    const registry = readFileSync(
      path.resolve(import.meta.dirname, '../run-all-scans.mjs'),
      'utf8',
    );

    expect(registry).toContain('scan-resolving-claims.mjs');
  });
});
