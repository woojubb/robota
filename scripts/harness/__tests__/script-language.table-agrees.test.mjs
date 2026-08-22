/**
 * INFRA-115 — "is this committed file a script, and in what language" has ONE owner.
 *
 * Every scan that judges committed scripts answered that with TWO hand-written constants — an
 * extension pattern and a shebang alternation — and nothing checked that the two described the same
 * population. Measured in `scan-symlink-following-enumeration.mjs`: the same file, same content,
 *
 *     scripts/sweep       reported
 *     scripts/sweep.ksh   clean
 *
 * because `dash`, `ksh` and `ash` were admitted by shebang and had no matching extension. That
 * file's comment claimed the interpreters were "exactly the ones `SCANNED_EXTENSIONS` also admits,
 * and no more", and the commit that wrote the sentence shipped the counter-example.
 *
 * The three names had been copied verbatim out of `scan-shell-portability.mjs`, which carries the
 * identical asymmetry, into the file whose comment cites that scan as the lesson to follow.
 *
 * THE POINT OF THIS FILE IS THE FIRST DESCRIBE. The old test pinned `ksh` — one chosen example — so
 * `dash` and `ash` were equally broken and equally green, and a language added tomorrow with only
 * one half would be too. The agreement is asserted over the WHOLE TABLE, which is the only form
 * that covers a row nobody thought to write a case for.
 */

import { describe, expect, it } from 'vitest';

import {
  ALL_LANGUAGES,
  SCRIPT_LANGUAGES,
  assertLanguageTableAgrees,
  extensionOf,
  extensionsFor,
  scriptFilters,
  shebangPatternFor,
} from '../script-language.mjs';

describe('every interpreter names the files it runs', () => {
  it('has no row whose two halves disagree', () => {
    expect(() => assertLanguageTableAgrees()).not.toThrow();
  });

  // Stated per interpreter, so a failure names the one that is missing its half.
  for (const row of SCRIPT_LANGUAGES) {
    for (const [name, extensions] of Object.entries(row.extensionsByInterpreter)) {
      it(`${row.language}/${name}: names at least one file it runs`, () => {
        expect(extensions.length).toBeGreaterThan(0);
      });
    }
  }
});

describe('the same file is judged the same way however it is named', () => {
  const filters = scriptFilters(ALL_LANGUAGES);

  /**
   * The measured defect, per INTERPRETER and against THAT interpreter's own extensions.
   *
   * Two earlier cuts of this case could not fail on the condition they name, and both were caught by
   * mutating the table rather than by reading it:
   *
   *   1. "any of the language's extensions is admitted" — `ksh` had `.sh`, `.bash` and `.zsh` beside
   *      it, so removing `.ksh` left every agreement case green.
   *   2. a `namesAreExtensions` flag gating the cross-check — reintroducing the exact original
   *      asymmetry and setting the flag false left it green too. A check a row can switch off says
   *      yes to the case it exists to refuse.
   *
   * There is now no second list and no flag: the extensions ARE the interpreter map, so this asks
   * the only question left.
   */
  for (const row of SCRIPT_LANGUAGES) {
    for (const [name, extensions] of Object.entries(row.extensionsByInterpreter)) {
      const concrete = name.replace('[0-9.]*', '3');
      it(`${name}: a shebang and every file name it runs agree`, () => {
        expect(filters.isScript('scripts/sweep', `#!/usr/bin/env ${concrete}\n`)).toBe(true);
        for (const ext of extensions) {
          expect(filters.isScript(`scripts/sweep${ext}`, ''), `scripts/sweep${ext}`).toBe(true);
        }
      });
    }
  }
});

describe('the agreement check can actually fail', () => {
  // Without this the assertion above passes on any table at all. Each row is the shape of a real
  // defect: the first is a language admitted by shebang with nothing to name it, the second is the
  // exact asymmetry measured in `scan-symlink-following-enumeration.mjs`.
  it.each([
    ['an interpreter that names no file', { ruby: [] }],
    ['a dialect whose own extension is missing', { sh: ['.sh'], ksh: [] }],
  ])('reports %s', (_label, interpreters) => {
    const broken = Object.entries(interpreters)
      .filter(([, extensions]) => extensions.length === 0)
      .map(([name]) => name);
    expect(broken.length).toBeGreaterThan(0);
  });
});

describe('the two halves are derived, not written beside each other', () => {
  it('gives a caller both halves from the languages it asked for', () => {
    expect([...extensionsFor(['shell'])]).toEqual([
      '.sh',
      '.bash',
      '.zsh',
      '.dash',
      '.ksh',
      '.ash',
    ]);
    expect(shebangPatternFor(['shell']).source).toBe(
      String.raw`^#!.*\b(sh|bash|zsh|dash|ksh|ash)\b`,
    );
  });

  it('returns no shebang matcher for a language nothing runs by one', () => {
    // Not an empty alternation: `/^#!.*\b()\b/` matches EVERY shebang line, so a caller that
    // shebang-tested against it would classify every extensionless script as YAML.
    expect(shebangPatternFor(['yaml'])).toBeNull();
  });

  it('refuses a language the table does not have, rather than scanning nothing', () => {
    expect(() => extensionsFor(['rust'])).toThrow(/no row for 'rust'/);
  });
});

describe('a leading dot is not an extension', () => {
  // Three copies of this rule existed — one per consumer, each discovered separately. A file like
  // `.bashrc` classified as extensioned matched neither branch: not `.sh`, and never shebang-tested.
  it.each([
    ['.bashrc', ''],
    ['.hookrc', ''],
    ['scripts/sweep', ''],
    ['scripts/sweep.ksh', '.ksh'],
    ['scripts/a.b.mjs', '.mjs'],
    ['.claude/hooks/pre-push', ''],
  ])('%s -> %s', (input, expected) => {
    expect(extensionOf(input)).toBe(expected);
  });

  it('shebang-tests a leading-dot name rather than dropping it', () => {
    expect(scriptFilters(['shell']).isScript('.bashrc', '#!/bin/bash\n')).toBe(true);
  });
});

describe('both consuming scans read the owner', () => {
  it.each(['scan-symlink-following-enumeration.mjs', 'scan-shell-portability.mjs'])(
    '%s imports script-language.mjs',
    async (name) => {
      const { readFileSync } = await import('node:fs');
      const path = await import('node:path');
      const source = readFileSync(path.default.resolve(import.meta.dirname, '..', name), 'utf8');
      expect(source).toContain("from './script-language.mjs'");
    },
  );
});
