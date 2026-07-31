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
      'scripts/harness/consumer.mjs': "import { roughRelation } from './owner.mjs';\nroughRelation('x');",
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
      'scripts/harness/empty.mjs': [
        '/**',
        ' * @limits',
        ' */',
        'export function bare() {}',
      ].join('\n'),
      'scripts/harness/user.mjs': [
        "import { bare } from './empty.mjs';",
        '// LIMITS bare:',
      ].join('\n'),
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
    expect(acknowledgements('// LIMITS foo: because.')).toEqual([{ name: 'foo', reason: 'because.' }]);
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

    expect(`${result.stdout}${result.stderr}`).toMatch(/@limits-tagged function\(s\)/);
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
  });
});
