import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  collectEmitted,
  emittedText,
  findEmittedIdentifiers,
  findUnstatedIdentifiers,
  isNormativeDoc,
  readExaminedIdentifierCount,
} from '../scan-rule-statement-floor.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');

function realNormativeDocs() {
  const files = execFileSync('git', ['ls-files', '*.md', '**/*.md'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter(isNormativeDoc);
  return Object.fromEntries(files.map((f) => [f, readFileSync(path.join(ROOT, f), 'utf8')]));
}

describe('emittedText — only what a scan actually prints', () => {
  it('keeps string and template literal contents', () => {
    expect(emittedText('console.error(`  [INTERFACE-DEPS] ${v}`);')).toContain('[INTERFACE-DEPS]');
    expect(emittedText("console.log('  [PLUGIN-LAYER] x');")).toContain('[PLUGIN-LAYER]');
  });

  it('drops line comments — a documented example names no rule', () => {
    expect(emittedText('// see `[SOME-123]` for the form')).not.toContain('SOME-123');
  });

  it('drops block comments', () => {
    expect(
      emittedText('/**\n * `[SOME-100](../tasks/…)` is the relocation form.\n */'),
    ).not.toContain('SOME-100');
  });

  it('drops regular-expression literals — a character range is not a rule', () => {
    expect(emittedText('const re = /^[A-Z0-9]+$/;')).not.toContain('A-Z0-9');
  });

  it('does not mistake division for a regular expression', () => {
    // `a / b` then a string: if `/` opened a regex, the string would be swallowed
    expect(emittedText('const r = a / b; console.log("[REAL-RULE]");')).toContain('[REAL-RULE]');
  });

  it('respects escapes inside a string', () => {
    expect(emittedText('console.log("a\\" [KEPT-RULE]");')).toContain('[KEPT-RULE]');
  });
});

describe('findEmittedIdentifiers', () => {
  it('finds an identifier a scan prints', () => {
    expect(findEmittedIdentifiers('console.error(`[INTERFACE-DEPS] x`)')).toEqual([
      'INTERFACE-DEPS',
    ]);
  });

  it('rejects a single-character segment, which is a character range and not a rule', () => {
    // survives inside a string, so comment/regex stripping alone cannot catch it
    expect(findEmittedIdentifiers('console.log("[A-Z]")')).toEqual([]);
    expect(findEmittedIdentifiers('console.log("[A-Z0-9]")')).toEqual([]);
  });

  it('rejects log levels that share the shape but name no rule', () => {
    expect(findEmittedIdentifiers('console.log("[WARN] x"); console.log("[INFO] y")')).toEqual([]);
  });

  it('accepts a two-character segment', () => {
    expect(findEmittedIdentifiers('console.log("[RE-EXPORT] x")')).toEqual(['RE-EXPORT']);
  });
});

describe('isNormativeDoc — what counts as a document that STATES a rule now', () => {
  it('accepts the rule-owning documents', () => {
    expect(isNormativeDoc('.agents/rules/git-branch.md')).toBe(true);
    expect(isNormativeDoc('.agents/project-structure.md')).toBe(true);
    expect(isNormativeDoc('AGENTS.md')).toBe(true);
    expect(isNormativeDoc('ARCHITECTURE.md')).toBe(true);
    expect(isNormativeDoc('.agents/specs/contract-family-owner-map.md')).toBe(true);
  });

  // This is design C's failure, encoded permanently. Treating archived and completed documents as
  // normative gave 95% adoption and would have stayed GREEN through the deletion that motivated this
  // scan — a check whose green was a property of the corpus rather than of the rule.
  it('REJECTS archived documents, which record what was decided rather than what binds', () => {
    expect(isNormativeDoc('.agents/archive/audits/rules-without-enforcement-2026-07-28.md')).toBe(
      false,
    );
    expect(isNormativeDoc('.agents/archive/task-breakdowns/completed/INFRA-013.md')).toBe(false);
  });

  it('REJECTS spec-docs, including completed ones', () => {
    expect(
      isNormativeDoc('.agents/spec-docs/done/INFRA-035-interface-package-purity-guard.md'),
    ).toBe(false);
    expect(isNormativeDoc('.agents/spec-docs/todo/HARNESS-117-x.md')).toBe(false);
  });
});

describe('findUnstatedIdentifiers', () => {
  it('reports an identifier no normative document states', () => {
    const out = findUnstatedIdentifiers(
      { 'MADE-UP': 'scripts/harness/x.mjs' },
      { '.agents/rules/a.md': 'nothing relevant here' },
    );
    expect(out).toEqual([{ id: 'MADE-UP', scan: 'scripts/harness/x.mjs' }]);
  });

  it('accepts an identifier a normative document states', () => {
    expect(
      findUnstatedIdentifiers(
        { 'MADE-UP': 'scripts/harness/x.mjs' },
        { '.agents/rules/a.md': 'The `MADE-UP` rule requires…' },
      ),
    ).toEqual([]);
  });

  it('does NOT accept a statement that appears only in an archived document', () => {
    expect(
      findUnstatedIdentifiers(
        { 'MADE-UP': 'scripts/harness/x.mjs' },
        { '.agents/archive/audits/old.md': 'The `MADE-UP` rule requires…' },
      ),
    ).toHaveLength(1);
  });
});

describe('the real repository (HARNESS-117 · issue #2178)', () => {
  const emitted = collectEmitted();
  const docs = realNormativeDocs();

  it('finds the rule identifiers the harness actually emits', () => {
    expect(Object.keys(emitted).length).toBeGreaterThan(0);
    expect(emitted).toHaveProperty('INTERFACE-DEPS');
  });

  it('reports INTERFACE-DEPS as stated today', () => {
    expect(findUnstatedIdentifiers(emitted, docs).map((u) => u.id)).not.toContain('INTERFACE-DEPS');
  });

  // The incident this scan was built for: ARCH-100 deleted the Interface Package Rule's statements
  // from .agents/project-structure.md and every scan stayed green. This asserts the verdict FLIPS.
  // Since issue #2188 the identifier is ALSO stated in ARCHITECTURE.md's rule-identifier section, so
  // both statements go — the flip is what is asserted, not which document carries the last copy.
  it('reports INTERFACE-DEPS as UNSTATED when no document states it any more', () => {
    const without = { ...docs };
    delete without['.agents/project-structure.md'];
    delete without['ARCHITECTURE.md'];
    expect(findUnstatedIdentifiers(emitted, without).map((u) => u.id)).toContain('INTERFACE-DEPS');
  });

  it('the count it reports is the set it actually checks', () => {
    expect(readExaminedIdentifierCount(emitted)).toBe(Object.keys(emitted).length);
  });
});

describe('readExaminedIdentifierCount — the size this scan reports (measurement-provenance.md)', () => {
  const FIXTURE =
    'console.log("[ONE-RULE] a"); console.log("[TWO-RULE] b"); console.log("[THREE-RULE] c");';

  it('counts a fixture of known size exactly, and does not accumulate across runs', () => {
    findEmittedIdentifiers(FIXTURE);
    const first = Object.fromEntries(
      findEmittedIdentifiers(FIXTURE).map((id) => [id, 'fixture.mjs']),
    );
    expect(readExaminedIdentifierCount(first)).toBe(3);
    // run the finder a SECOND time: an accumulating counter would report 6 here, a correct one 3
    findEmittedIdentifiers(FIXTURE);
    const second = Object.fromEntries(
      findEmittedIdentifiers(FIXTURE).map((id) => [id, 'fixture.mjs']),
    );
    expect(readExaminedIdentifierCount(second)).toBe(3);
  });

  it('reports zero for a source that emits no rule identifier', () => {
    const none = Object.fromEntries(
      findEmittedIdentifiers('console.log("nothing here"); const re = /[A-Z]/;').map((id) => [
        id,
        'f',
      ]),
    );
    expect(readExaminedIdentifierCount(none)).toBe(0);
  });
});
