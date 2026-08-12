import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  acknowledgements,
  analyze,
  localImports,
  taggedFunctions,
} from '../scan-helper-limits.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');

/**
 * The floor for `helper-limits.md`: a helper's stated limits are re-judged at every consumer whose
 * consequences differ.
 *
 * Measured, not hypothetical — two instances in one session. `git()` trimmed its output, which is
 * right for a sha and wrong for a patch, and reused to feed `git apply -R` it broke every
 * reverse-apply the red-proof gate ever attempted. `testExecutesHook` was a grep-level relation for
 * an advisory floor, and reused to pick which tests may set a verdict, the same imprecision can hand
 * a verdict to a test that never ran the hook.
 *
 * In both, the function did not change. Nothing in the diff signalled anything, and review saw a
 * reuse, which reads as good practice.
 */
describe('a @limits helper is acknowledged where it is consumed', () => {
  const OWNER = 'scripts/harness/owner.mjs';
  const ownerText = [
    '/**',
    ' * Does the thing, roughly.',
    ' * @limits grep-level: approximate, and only an advisory message rides on it.',
    ' */',
    'export function roughRelation(text) { return text.length > 0; }',
  ].join('\n');

  it('flags a consumer that imports it without asking the question', () => {
    // The failure this exists to catch: the import is the whole diff, and it reads as reuse.
    const { findings } = analyze({
      [OWNER]: ownerText,
      'scripts/harness/consumer.mjs':
        "import { roughRelation } from './owner.mjs';\nroughRelation('x');",
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe('scripts/harness/consumer.mjs');
    expect(findings[0].message).toMatch(/roughRelation/);
  });

  it('accepts a consumer that states why they hold', () => {
    const { findings } = analyze({
      [OWNER]: ownerText,
      'scripts/harness/consumer.mjs': [
        "import { roughRelation } from './owner.mjs';",
        '// LIMITS roughRelation: only a log line rides on this, so approximate is enough.',
        "roughRelation('x');",
      ].join('\n'),
    });

    expect(findings).toEqual([]);
  });

  it('accepts a containment when they do NOT hold', () => {
    // The honest second answer. `finding-depth.md` allows a labelled hold; what it does not allow
    // is the question going unasked, which is what an unannotated import is.
    const { findings } = analyze({
      [OWNER]: ownerText,
      'scripts/harness/gate.mjs': [
        "import { roughRelation } from './owner.mjs';",
        '// LIMITS roughRelation: CONTAINMENT — INFRA-074, held until the gate becomes enforcing.',
      ].join('\n'),
    });

    expect(findings).toEqual([]);
  });

  it('does not ask the declaring module to acknowledge itself', () => {
    const { findings } = analyze({ [OWNER]: ownerText });

    expect(findings).toEqual([]);
  });

  it('rejects a tag that states nothing, and an acknowledgement with no reason', () => {
    // Anti-rot, the convention `allow-fake` and `allow-fallback` already use: a marker that says
    // nothing is a marker that stops being read, and then the floor is decorative.
    const { findings } = analyze({
      'scripts/harness/empty.mjs': ['/**', ' * @limits', ' */', 'export function bare() {}'].join(
        '\n',
      ),
      'scripts/harness/user.mjs': ["import { bare } from './empty.mjs';", '// LIMITS bare:'].join(
        '\n',
      ),
    });

    expect(findings.map((f) => f.message).join(' ')).toMatch(/states nothing/);
    expect(findings.map((f) => f.message).join(' ')).toMatch(/no reason/);
  });

  it('reads the tag only from the docblock attached to the export', () => {
    // A `@limits` line floating anywhere in the file would let the tag drift away from what it
    // describes, and a drifted tag is worse than none: it names limits that belong to something else.
    const floating = ['// @limits this belongs to nothing', 'export function untagged() {}'].join(
      '\n',
    );

    expect(taggedFunctions(floating)).toEqual([]);
  });

  it('does not adopt a `@limits` the file merely talks about', () => {
    // Found by running it: a lazy block starting at the MODULE docblock ran past it and reached the
    // first documented export, so this scan's own contract prose — which necessarily writes out
    // `@limits` — tagged an unrelated function. A tag that drifts names limits belonging to
    // something else, which is worse than no tag at all.
    const text = [
      '/**',
      ' * This module explains the @limits convention in prose.',
      ' */',
      '',
      '/**',
      ' * Unrelated, and untagged.',
      ' */',
      'export function innocent() {}',
    ].join('\n');

    expect(taggedFunctions(text)).toEqual([]);
  });

  it('refuses when tags exist in the text but the parser matched none', () => {
    // Fail-closed against parser drift. Declaring is opt-in, so `examined: 0` is legitimate while
    // nobody has tagged anything — but zero matches while the tag string IS present in the subject
    // means the reader broke, and a reader that reads nothing reports a clean sweep. That is the
    // twelve-green-runs-zero-verdicts shape, in the floor written because of it.
    const { findings, examined } = analyze({
      'scripts/harness/drifted.mjs': [
        '/**',
        ' * @limits written where nothing the parser recognises follows it.',
        ' */',
        'const notExported = 1;',
      ].join('\n'),
    });

    expect(examined).toBe(0);
    expect(findings.map((f) => f.message).join(' ')).toMatch(/matched none|parser/i);
  });

  it('does not credit an acknowledgement to a same-named export from elsewhere', () => {
    // `analyze`, `main`, `walk` are ordinary names in this directory. Resolving an owner by NAME
    // alone means an unrelated import can demand the wrong file's limits, or an acknowledgement of
    // an unrelated function can silently excuse the real one — the invisible-in-the-code failure
    // this rule exists to catch, reproduced by its own enforcement.
    const { findings } = analyze({
      'scripts/harness/owner.mjs': [
        '/**',
        ' * @limits approximate.',
        ' */',
        'export function shared(x) { return x; }',
      ].join('\n'),
      'scripts/harness/other.mjs': 'export function shared(x) { return x; }',
      'scripts/harness/consumer.mjs': "import { shared } from './other.mjs';",
    });

    expect(findings, 'an import of a different module was judged against these limits').toEqual([]);
  });

  it('reads a tag from every shape an export is written in', () => {
    // One shape was recognised: a multi-line docblock followed by `export function`. A single-line
    // docblock, an `export async function`, or an arrow assigned to an `export const` all registered
    // as nothing — and because the drift check counted tags across the WHOLE scan, one parsing
    // correctly elsewhere kept each specific miss invisible. Invisible in the code, visible only in
    // behaviour: the class this tool exists to catch, inside the tool.
    const shapes = [
      ['/** @limits one-liner. */', 'export function a() {}'].join('\n'),
      ['/**', ' * @limits async.', ' */', 'export async function b() {}'].join('\n'),
      ['/**', ' * @limits arrow.', ' */', 'export const c = (x) => x;'].join('\n'),
    ];

    expect(shapes.map((t) => taggedFunctions(t).map((f) => f.name))).toEqual([['a'], ['b'], ['c']]);
  });

  it('flags a file whose tag text the parser could not read, even when others parse', () => {
    // Per FILE, not per run. A global count is satisfied by any one tag anywhere, which is what let
    // the shapes above go missing without a sound.
    const { findings } = analyze({
      'scripts/harness/ok.mjs': [
        '/**',
        ' * @limits parsed fine.',
        ' */',
        'export function parsed() {}',
      ].join('\n'),
      'scripts/harness/unread.mjs': [
        '/**',
        ' * @limits declared, but nothing the parser recognises follows it.',
        ' */',
        'const notExported = 1;',
      ].join('\n'),
    });

    expect(findings.map((f) => f.file)).toContain('scripts/harness/unread.mjs');
  });

  it('is loud, not silent, when a tag drifts away from its export', () => {
    // Adjacency is required on purpose: tolerating a gap would let a MODULE docblock tag whatever
    // export happens to follow it, which is a drifted tag naming limits that belong to something
    // else. What matters is that breaking adjacency FAILS rather than passing quietly — the
    // per-file reader check is what makes that true, and this pins it so it stays a guarantee
    // rather than a coincidence.
    const spaced = [
      '/**',
      ' * @limits separated from its export by a blank line.',
      ' */',
      '',
      'export function spaced() {}',
    ].join('\n');

    expect(taggedFunctions(spaced)).toEqual([]);
    expect(analyze({ 'scripts/harness/x.mjs': spaced }).findings).toHaveLength(1);
  });

  it('reads imports and acknowledgements as written', () => {
    expect(localImports("import { a, b as c } from './x.mjs';")).toEqual([
      { specifier: './x.mjs', names: ['a', 'b'] },
    ]);
    // A default beside the named ones, and a double-quoted specifier. Neither is common here —
    // prettier settles the quotes — but a floor that MISSES a consumer fails silently, which is the
    // "invisible in the code" shape this rule exists to catch, occurring inside its own enforcement.
    expect(localImports('import owner, { a } from "./x.mjs";')).toEqual([
      { specifier: './x.mjs', names: ['a'] },
    ]);
    // Not a local module: a package import has no declaring file here to carry limits.
    expect(localImports("import { z } from 'node:path';")).toEqual([]);
    expect(acknowledgements('// LIMITS foo: because.')).toEqual([
      { name: 'foo', reason: 'because.' },
    ]);
    expect(acknowledgements(' * LIMITS foo: inside a docblock.')).toHaveLength(1);
  });
});

describe('the scan runs, and says what it examined', () => {
  it('reports the tagged-function count rather than a bare pass', () => {
    // A run that examined nothing must not read as a clean sweep. The repository has been burned by
    // exactly that: twelve green CI runs of a gate that produced no verdict at all.
    const result = spawnSync(
      'node',
      [path.join(WORKSPACE_ROOT, 'scripts/harness/scan-helper-limits.mjs')],
      { cwd: WORKSPACE_ROOT, encoding: 'utf8' },
    );

    const out = `${result.stdout}${result.stderr}`;
    const examined = Number(out.match(/helper-limits: (\d+) @limits-tagged/)?.[1] ?? -1);

    // `toMatch(/@limits-tagged function\(s\)/)` alone matched "0 @limits-tagged function(s)" too, so
    // the parser could stop matching anything and this case would stay green — an accidental-green
    // regression test guarding the scan whose whole subject is defects that leave no signal.
    expect(examined, 'the scan examined nothing and still reported success').toBeGreaterThan(0);
    expect(result.status, out).toBe(0);
  });
});
