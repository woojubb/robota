import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { countContractCasts } from '../scan-contract-cast-ratchet.mjs';

/**
 * The ratchet's job is to make a growing number visible, so what matters most is that it COUNTS
 * correctly — a miscount either hides growth or blocks unrelated work until someone suppresses it.
 *
 * The word boundary is the case with history. The audit that produced ARCH-012 counted with
 * `rg 'as IInteractiveSession'`, which also matched `as IInteractiveSessionEvents[...]` and
 * `as IInteractiveSessionStandardOptions` — casts to entirely different types — and reported 51/33
 * where the contract itself has 41/29.
 */
const CONTRACT = 'IInteractiveSession';

function count(source) {
  return countContractCasts(['f.ts'], [CONTRACT], () => source).get(CONTRACT);
}

describe('scan-contract-cast-ratchet', () => {
  it('counts `as unknown as <Contract>`', () => {
    expect(count(`const s = {} as unknown as IInteractiveSession;`).casts).toBe(1);
  });

  it('counts a direct `as <Contract>`', () => {
    expect(count(`const s = x as IInteractiveSession;`).casts).toBe(1);
  });

  it('does NOT count a cast to a different type that merely starts with the name', () => {
    // The audit's over-count, pinned. Without the word boundary these three read as contract casts.
    const source = [
      `handler as IInteractiveSessionEvents[typeof event]`,
      `options as IInteractiveSessionStandardOptions`,
      `store as IInteractiveSessionStore`,
    ].join('\n');
    expect(count(source).casts).toBe(0);
  });

  it('counts every occurrence, not every line', () => {
    const source = `f(a as IInteractiveSession, b as unknown as IInteractiveSession);`;
    expect(count(source).casts).toBe(2);
  });

  it('reports the files carrying casts, so a growth message can name them', () => {
    const found = countContractCasts(['a.ts', 'b.ts', 'c.ts'], [CONTRACT], (f) =>
      f === 'c.ts' ? 'nothing here' : `x as ${CONTRACT}`,
    ).get(CONTRACT);
    expect(found.files.size).toBe(2);
  });

  it('does NOT count a cast to a MEMBER type of the contract', () => {
    // `as IFoo['bar']` narrows a handler to one member's type; it is not a partial re-implementation
    // of the contract and counting it inflates the ratchet. Found by the ratchet catching its own
    // author: replacing a hand-rolled double with the conformant one introduced three of these and
    // the count went UP.
    const source = [
      `handler as IInteractiveSession['on']`,
      `fn as IInteractiveSession['off']`,
    ].join('\n');
    expect(count(source).casts).toBe(0);
  });

  it('does NOT count the pattern when it appears in a COMMENT', () => {
    // Found the honest way: a commit that removed two casts left the number unchanged, because the
    // comments explaining the removal quoted the pattern. A counter that counts prose blocks work on
    // documentation. Parsing makes this structural — a comment is not an expression.
    const source = [
      `// the partial this replaces was \`as unknown as IInteractiveSession\``,
      `/* also as IInteractiveSession in a block comment */`,
      `const real = x as IInteractiveSession;`,
    ].join('\n');
    expect(count(source).casts).toBe(1);
  });

  it('does NOT count the pattern inside a string literal', () => {
    expect(count(`const msg = 'use as unknown as IInteractiveSession here';`).casts).toBe(0);
  });

  it('a string ending in a backslash does not swallow the rest of the file', () => {
    // The hand-rolled scanner this replaced read the closing quote as escaped and blanked everything
    // after it — a SILENT under-count, which is the worse direction: the scan treats a fall as
    // something to re-freeze, so a wrong low number gets frozen and the ratchet goes blind.
    const source = [`const p = 'C:\\\\';`, `const s = x as IInteractiveSession;`].join('\n');
    expect(count(source).casts).toBe(1);
  });

  it('an apostrophe inside a regex literal does not open a string', () => {
    const source = [`const r = /'/g;`, `const s = x as IInteractiveSession;`].join('\n');
    expect(count(source).casts).toBe(1);
  });

  it('counts a cast inside a template substitution', () => {
    expect(count('const m = `${x as IInteractiveSession}`;').casts).toBe(1);
  });

  it('counts an intersection whose first member is the contract', () => {
    // `as unknown as IFoo & { _emit }` still stands in for the contract.
    const source = `const s = x as unknown as IInteractiveSession & { _emit: () => void };`;
    expect(count(source).casts).toBe(1);
  });

  it('a contract that appears only as a type annotation is not a cast', () => {
    expect(count(`const session: IInteractiveSession = build();`).casts).toBe(0);
  });

  /**
   * The registered path and the live number. A ratchet that is never invoked, or whose frozen
   * number came from somewhere nobody can explain, is not a ratchet.
   */
  it('is registered, passes on the live repository, and its baseline matches what it counts', () => {
    const root = path.resolve(import.meta.dirname, '../../..');
    const registry = readFileSync(path.join(root, 'scripts/harness/run-all-scans.mjs'), 'utf8');
    expect(registry).toContain('scan-contract-cast-ratchet.mjs');

    const output = execFileSync('node', ['scripts/harness/scan-contract-cast-ratchet.mjs'], {
      cwd: root,
      encoding: 'utf8',
    });
    const examined = Number(/(\d+) file\(s\) examined/.exec(output)?.[1] ?? '0');
    // A pass over nothing is not a pass.
    expect(examined).toBeGreaterThan(100);

    const frozen = JSON.parse(
      readFileSync(path.join(root, 'scripts/harness/contract-cast-baseline.json'), 'utf8'),
    );
    expect(frozen[CONTRACT]).toBe(0);
    // The persisted-and-transferred contract is enrolled (issue #2190): a cast to it outlives the
    // process that made it, and three round-trip fixtures encoded values the contract forbids before
    // the ratchet governed it. Its baseline is the measured count, frozen so it can only fall.
    expect(Object.keys(frozen)).toContain('IInteractiveSessionRecord');
    const reported = Number(/(\d+) cast\(s\) at baseline/.exec(output)?.[1] ?? '-1');
    expect(reported).toBe(Object.values(frozen).reduce((sum, casts) => sum + casts, 0));
  });
});
