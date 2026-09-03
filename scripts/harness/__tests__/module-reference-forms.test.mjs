/*
 * Issue #2206 — the statement parser the family-owner scan and every codemod share.
 *
 * Each handled form is a fixture HERE, in the module that owns the parser, so a codemod importing it
 * inherits a debugged list rather than re-deriving "imports look like `import`" and being blind to
 * the multi-line `export type { … } from` re-exports that cost ARCH-103 24 MISSING_EXPORT errors.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  findModuleReferences,
  namedClauseSymbols,
  packageReferencePattern,
} from '../module-reference-forms.mjs';

const PREFIX = '@robota-sdk/agent-';

function refs(source) {
  return findModuleReferences(source, { internalPackagePrefix: PREFIX }).map(
    ({ form, target, symbols }) => (symbols ? { form, target, symbols } : { form, target }),
  );
}

describe('every form the parser handles (issue #2206)', () => {
  it('import and export named clauses, either keyword', () => {
    expect(refs("import { A, B } from './x.js';\nexport { C } from './y.js';")).toEqual([
      { form: 'named', target: 'x', symbols: ['A', 'B'] },
      { form: 'named', target: 'y', symbols: ['C'] },
    ]);
  });

  it('the `type` variant of both, and inline `type` / `as` inside the clause', () => {
    expect(
      refs("import type { A } from './x';\nexport type { type B as Bee, C } from './y';"),
    ).toEqual([
      { form: 'named', target: 'x', symbols: ['A'] },
      { form: 'named', target: 'y', symbols: ['B', 'C'] },
    ]);
  });

  it('every extension spelling, and none', () => {
    const source = [
      "import { A } from './a.js';",
      "import { B } from './b.ts';",
      "import { C } from './c.mjs';",
      "import { D } from './d.mts';",
      "import { E } from './e';",
    ].join('\n');
    expect(refs(source).map((r) => r.target)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('a MULTI-LINE named clause — the form the ARCH-103 codemod could not see', () => {
    const source = ['export type {', '  IOne,', '  ITwo,', "} from './contracts.js';"].join('\n');
    expect(refs(source)).toEqual([
      { form: 'named', target: 'contracts', symbols: ['IOne', 'ITwo'] },
    ]);
  });

  it('braceless forms: `export *` and `import * as ns`', () => {
    expect(refs("export * from './x.js';\nimport * as ns from './y';")).toEqual([
      { form: 'bare', target: 'x' },
      { form: 'bare', target: 'y' },
    ]);
  });

  it('the cross-package form, with the configured prefix', () => {
    const source = [
      "import type { A } from '@robota-sdk/agent-interface-session';",
      "export * from '@robota-sdk/agent-interface-command';",
      "import * as ns from '@robota-sdk/agent-interface-execution';",
    ].join('\n');
    expect(refs(source)).toEqual([
      { form: 'package', target: 'interface-session' },
      { form: 'package', target: 'interface-command' },
      { form: 'package', target: 'interface-execution' },
    ]);
  });

  it('returns references in source order, each with its statement text and offset', () => {
    const source = "export * from './b';\nimport { A } from './a';";
    const found = findModuleReferences(source);
    expect(found.map((r) => r.target)).toEqual(['b', 'a']);
    expect(found[0].statement).toBe("export * from './b'");
    expect(found[1].index).toBe(source.indexOf('import'));
  });

  it('skips the package form when no prefix is configured, rather than guessing a scope', () => {
    expect(findModuleReferences("import { A } from '@robota-sdk/agent-interface-x';")).toEqual([]);
  });

  it('escapes the prefix: a `.` in the scope is a literal, not any-character', () => {
    expect(packageReferencePattern('@a.b/c-').source).toContain('@a\\.b\\/c-');
  });

  it('namedClauseSymbols drops empty and malformed entries', () => {
    expect(namedClauseSymbols(' A, type B as Bee, , 1bad, ')).toEqual(['A', 'B']);
  });
});

describe('the scan consumes this parser, not a private copy', () => {
  it('scan-interface-family-owner.mjs imports findModuleReferences and holds no `from` regex', () => {
    const source = readFileSync(
      path.join(import.meta.dirname, '../scan-interface-family-owner.mjs'),
      'utf8',
    );
    expect(source).toContain("from './module-reference-forms.mjs'");
    // The three expressions that used to live inline. Their return would be the second copy #2206
    // is about; anything matching a `from` clause belongs in the shared module.
    expect(source).not.toMatch(/matchAll\(\s*\/\(\?:import\|export\)/);
    expect(source).not.toMatch(/new RegExp\([\s\S]{0,200}from\\s\*/);
  });
});
