/**
 * INFRA-125 (issue #1887) — a rewrite site is correct when the identifier RESOLVES to the declaration
 * being changed, not when it spells the same thing.
 *
 * The cases that carry the weight are the three real files a name-based rewrite edited wrongly, and
 * the limits this resolver reports rather than guesses at. A resolver that guesses is the regex it
 * replaces, wearing a better name.
 */

import { describe, expect, it } from 'vitest';

import {
  SITE,
  collectRewriteSites,
  examinedFileCount,
  importSpecifiersFor,
  namespaceImports,
} from '../resolve-rewrite-sites.mjs';

const MODULE = '@robota-sdk/agent-framework';

function resolve(files, symbol = 'createSession', module = MODULE) {
  return collectRewriteSites(Object.keys(files), symbol, module, (file) => files[file]).map(
    (site) => site.verdict,
  );
}

describe('the measured failure', () => {
  it('excludes a file that declares its OWN helper of that name', () => {
    // The shape all three wrongly-edited files took: a local function, no import from the package.
    expect(
      resolve({ 'a.test.ts': 'function createSession() { return {}; }\ncreateSession();' }),
    ).toEqual([SITE.SHADOWED]);
  });

  it('excludes a local declaration even when the symbol is ALSO imported', () => {
    // The local binding shadows the import, so the call site is not the declaration being changed.
    expect(
      resolve({
        'a.test.ts': `import { createSession } from '${MODULE}';\nconst createSession = () => {};`,
      }),
    ).toEqual([SITE.SHADOWED]);
  });

  it('admits a file that imports the symbol from the module being changed', () => {
    expect(
      resolve({ 'a.ts': `import { createSession } from '${MODULE}';\ncreateSession();` }),
    ).toEqual([SITE.BINDS]);
  });

  it('excludes a file importing that NAME from a different module', () => {
    expect(resolve({ 'a.ts': `import { createSession } from './local-factory.js';` })).toEqual([
      SITE.IMPORTED_ELSEWHERE,
    ]);
  });

  it('excludes a file that imports nothing of that name', () => {
    expect(resolve({ 'a.ts': `import { other } from '${MODULE}';\ncreateSession();` })).toEqual([
      SITE.NOT_IMPORTED,
    ]);
  });
});

describe('binding forms', () => {
  it('compares the LOCAL name of a renamed import, which is what a rewrite matches on', () => {
    expect(
      importSpecifiersFor(`import { make as createSession } from '${MODULE}';`, 'createSession'),
    ).toEqual([MODULE]);
    expect(
      importSpecifiersFor(`import { createSession as make } from '${MODULE}';`, 'createSession'),
    ).toEqual([]);
  });

  it('reads a named clause that follows a DEFAULT binding', () => {
    // Review finding: the first regex required `{` immediately after `import`, so this form matched
    // nothing and a file that genuinely binds the symbol came back `does-not-import-the-symbol` — a
    // real rewrite site skipped in silence, which is this tool's own failure mode reversed.
    expect(
      importSpecifiersFor(`import Default, { createSession } from '${MODULE}';`, 'createSession'),
    ).toEqual([MODULE]);
    expect(
      resolve({ 'a.ts': `import Default, { createSession } from '${MODULE}';\ncreateSession();` }),
    ).toEqual([SITE.BINDS]);
  });

  it('does not treat a DEFAULT-only import as binding the name', () => {
    // The widening must not become "a default import binds everything" — that would admit files the
    // rewrite must leave alone, which is the original defect in its first direction.
    expect(importSpecifiersFor(`import createSession from '${MODULE}';`, 'createSession')).toEqual(
      [],
    );
  });

  it('reads a type-only import, which still binds the name', () => {
    expect(
      importSpecifiersFor(`import type { createSession } from '${MODULE}';`, 'createSession'),
    ).toEqual([MODULE]);
  });

  it('resolves a relative specifier against the importing file', () => {
    expect(
      resolve(
        { 'packages/x/src/a.ts': `import { t } from './target.js';\nt();` },
        't',
        'packages/x/src/target.ts',
      ),
    ).toEqual([SITE.BINDS]);
  });

  it('resolves a relative specifier that lands on an index file', () => {
    expect(
      resolve(
        { 'packages/x/src/a.ts': `import { t } from './sub/index.js';\nt();` },
        't',
        'packages/x/src/sub.ts',
      ),
    ).toEqual([SITE.BINDS]);
  });
});

describe('the limits it reports rather than guesses at', () => {
  it('says it CANNOT decide a namespace import from the target module', () => {
    // `ns.createSession(...)` is a real site this cannot see. Reporting "no" would silently skip it,
    // which is the same silence the name-based rewrite produced, in the other direction.
    expect(namespaceImports(`import * as fw from '${MODULE}';`)).toEqual([
      { alias: 'fw', from: MODULE },
    ]);
    expect(resolve({ 'a.ts': `import * as fw from '${MODULE}';\nfw.createSession();` })).toEqual([
      SITE.UNRESOLVED,
    ]);
  });

  it('does not report a namespace import of an UNRELATED module as undecidable', () => {
    expect(resolve({ 'a.ts': `import * as path from 'node:path';\ncreateSession();` })).toEqual([
      SITE.NOT_IMPORTED,
    ]);
  });

  it('sees a namespace import that a named import from ANOTHER module would otherwise hide', () => {
    // The namespace check used to run only when the file named the symbol nowhere. So one named
    // import from an unrelated module was enough to hide a namespace import of the REAL one, and the
    // file came back `imports-that-name-from-another-module` — a leave-it-alone verdict — over a live
    // `fw.createSession()` site. Same spelling, different thing, answered "no" instead of flagged:
    // this tool's own failure mode, one level up.
    expect(
      resolve({
        'a.ts':
          `import { createSession } from './local.js';\n` +
          `import * as fw from '${MODULE}';\n` +
          `createSession();\nfw.createSession();`,
      }),
    ).toEqual([SITE.UNRESOLVED]);
  });

  it('still reports a named import from another module as such when no namespace reaches the target', () => {
    // The guard on the case above: widening the namespace check must not turn every file that
    // imports the name from elsewhere into "cannot decide", which would readmit the whole set the
    // rewrite is supposed to leave alone.
    expect(
      resolve({
        'a.ts':
          `import { createSession } from './local.js';\n` +
          `import * as other from '@robota-sdk/unrelated';\n` +
          `createSession();`,
      }),
    ).toEqual([SITE.IMPORTED_ELSEWHERE]);
  });
});

describe('the size it reports', () => {
  const files = { 'a.ts': '', 'b.ts': '', 'c.ts': '' };

  it('counts exactly the candidates it opened', () => {
    collectRewriteSites(Object.keys(files), 'x', MODULE, (f) => files[f]);
    expect(examinedFileCount()).toBe(3);
  });

  it('reports the same count after a SECOND run, rather than accumulating', () => {
    collectRewriteSites(Object.keys(files), 'x', MODULE, (f) => files[f]);
    collectRewriteSites(Object.keys(files), 'x', MODULE, (f) => files[f]);
    expect(examinedFileCount()).toBe(3);
  });
});
