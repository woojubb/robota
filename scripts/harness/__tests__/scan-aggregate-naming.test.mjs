import { describe, expect, it } from 'vitest';

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  collectAggregateNaming,
  findAggregateAliases,
  examinedFileCount,
  findAggregateReferences,
} from '../scan-aggregate-naming.mjs';

/**
 * ARCH-029. This scan is the criterion the design marks load-bearing — "the decomposition is not
 * real until this falls" — so a case that cannot go red is worse here than anywhere else in the
 * harness. Every case below is a shape that MUST be counted, or one that MUST NOT be.
 *
 * The MUST-NOT cases matter as much as the MUST cases: this floor's job is to fall to zero, and a
 * detector that over-fires on prose or on an unused import can never reach zero honestly. It would
 * be silenced instead — which is how the previous attempt on this contract ended.
 */
const AGGREGATES = ['ICommandHostContext'];

function count(source) {
  return findAggregateReferences(source, 'probe.ts', AGGREGATES).length;
}

describe('findAggregateReferences', () => {
  it('counts the plain parameter annotation — the form the design measured as 128', () => {
    expect(count('export function run(context: ICommandHostContext): void {}\n')).toBe(1);
  });

  it('counts a `Partial<>` wrapper, which a `: IAggregate` grep does not see', () => {
    expect(count('export function f(o: Partial<ICommandHostContext>): void {}\n')).toBe(1);
  });

  it('counts a `Pick<>` type argument', () => {
    expect(count("type T = Pick<ICommandHostContext, 'getCwd'>;\n")).toBe(1);
  });

  it('counts an indexed-access reference', () => {
    expect(count("type T = ICommandHostContext['getContextState'];\n")).toBe(1);
  });

  it('counts function-RETURN position', () => {
    expect(count('type F = () => ICommandHostContext;\n')).toBe(1);
  });

  it('counts array and union members', () => {
    expect(
      count('type A = ICommandHostContext[];\ntype U = ICommandHostContext | undefined;\n'),
    ).toBe(2);
  });

  it('counts each reference separately when one file has several', () => {
    expect(
      count(
        'export function a(c: ICommandHostContext): void {}\n' +
          'export function b(c: ICommandHostContext): void {}\n',
      ),
    ).toBe(2);
  });

  it('counts an `extends` heritage clause — a one-line re-alias of the whole surface', () => {
    // The worst hole this floor could have, and it shipped with it: `extends` parses as an
    // `ExpressionWithTypeArguments`, not a `TypeReferenceNode`. One line re-aliases all 46 members,
    // every consumer then names the alias, and the count sits at zero forever. Found by review.
    expect(count('export interface IMyHost extends ICommandHostContext {}\n')).toBe(1);
  });

  it('counts an `implements` heritage clause on a class', () => {
    expect(
      count(
        'export class C implements ICommandHostContext {\n  getCwd() {\n    return "";\n  }\n}\n',
      ),
    ).toBe(1);
  });

  it('counts the aggregate among several heritage entries, not just the first', () => {
    expect(count('interface X extends IOther, ICommandHostContext, IThird {}\n')).toBe(1);
  });

  it('does NOT count an import specifier — it names nothing in a type position', () => {
    // Counting it would double every honest site and make the frozen number mean two things.
    expect(count("import type { ICommandHostContext } from './host-context.js';\n")).toBe(0);
  });

  it('does NOT count prose that merely names the aggregate', () => {
    // This scan's own header names it a dozen times while explaining the rule. A text detector
    // flags itself, and a floor that flags itself gets suppressed rather than driven to zero.
    expect(
      count(
        '/**\n * ICommandHostContext is the 46-member aggregate this file must not name.\n */\n',
      ),
    ).toBe(0);
  });

  it('does NOT count a same-named VALUE identifier', () => {
    expect(count('const ICommandHostContext = 1;\nexport const x = ICommandHostContext;\n')).toBe(
      0,
    );
  });

  it('does NOT count a role port whose name merely contains the aggregate name as a prefix', () => {
    expect(count('export function f(c: ICommandHostContextRole): void {}\n')).toBe(0);
  });

  it('counts a reference reached through a qualified name', () => {
    expect(count('export function f(c: api.ICommandHostContext): void {}\n')).toBe(1);
  });

  it('reports the line, so a failure names where to look', () => {
    const found = findAggregateReferences(
      '\n\nexport function f(c: ICommandHostContext): void {}\n',
      'probe.ts',
      AGGREGATES,
    );

    expect(found).toEqual([{ aggregate: 'ICommandHostContext', line: 3 }]);
  });
});

describe('collectAggregateNaming — the `examined` counter is an output, and is asserted as one', () => {
  it('examines EXACTLY the files it is given, and counts exactly what is in them', () => {
    // measurement-provenance.md: a self-reported size nothing checks is how "examined 0 files"
    // reads as a clean repository. Fixture of known size: 3 files, 4 references.
    const root = mkdtempSync(join(tmpdir(), 'arch-029-count-'));
    mkdirSync(join(root, 'packages'), { recursive: true });
    const files = ['a.ts', 'b.ts', 'c.ts'];
    writeFileSync(join(root, 'a.ts'), 'export function f(c: ICommandHostContext): void {}\n');
    writeFileSync(
      join(root, 'b.ts'),
      'type T = Partial<ICommandHostContext>;\ntype U = () => ICommandHostContext;\ntype V = ICommandHostContext[];\n',
    );
    writeFileSync(join(root, 'c.ts'), 'export const nothing = 1;\n');

    const { counts, examined } = collectAggregateNaming(
      root,
      { aggregateNaming: { aggregates: ['ICommandHostContext'], allowlist: [] } },
      files,
    );

    expect(examined).toBe(3);
    expect(examinedFileCount(), 'the walk was miscounted').toBe(3);
    expect(counts.get('ICommandHostContext').references).toBe(4);
  });

  it('resets between runs — a second run over the same fixture reports the same size', () => {
    // An accumulating counter would say 6 on the second pass. That is how "the number came from
    // the walk" is told apart from "the number came from somewhere and kept growing".
    const root = mkdtempSync(join(tmpdir(), 'arch-029-reset-'));
    mkdirSync(join(root, 'packages'), { recursive: true });
    writeFileSync(join(root, 'a.ts'), 'export function f(c: ICommandHostContext): void {}\n');
    writeFileSync(join(root, 'b.ts'), 'export const nothing = 1;\n');
    const config = { aggregateNaming: { aggregates: ['ICommandHostContext'], allowlist: [] } };
    const files = ['a.ts', 'b.ts'];

    collectAggregateNaming(root, config, files);
    expect(examinedFileCount()).toBe(2);

    collectAggregateNaming(root, config, files);
    expect(examinedFileCount(), 'the counter accumulates across runs').toBe(2);
  });

  it('does not examine an allowlisted file — the count reflects the exclusion', () => {
    const root = mkdtempSync(join(tmpdir(), 'arch-029-allow-'));
    mkdirSync(join(root, 'packages'), { recursive: true });
    writeFileSync(join(root, 'a.ts'), 'export function f(c: ICommandHostContext): void {}\n');
    writeFileSync(join(root, 'b.ts'), 'export function g(c: ICommandHostContext): void {}\n');

    const { counts, examined } = collectAggregateNaming(
      root,
      {
        aggregateNaming: {
          aggregates: ['ICommandHostContext'],
          allowlist: [{ file: 'b.ts', reason: 'the declaration site' }],
        },
      },
      ['a.ts', 'b.ts'],
    );

    expect(examined).toBe(1);
    expect(counts.get('ICommandHostContext').references).toBe(1);
  });
});

describe('collectAggregateNaming fails closed on scope', () => {
  it('throws over a root without the governed tree, rather than counting zero', () => {
    // A counter that reports 0 for a tree it never read is indistinguishable from a finished
    // decomposition — which is the exact state this floor exists to refuse.
    const bare = mkdtempSync(join(tmpdir(), 'arch-029-bare-'));

    expect(() =>
      collectAggregateNaming(bare, { aggregateNaming: { aggregates: ['I'], allowlist: [] } }, []),
    ).toThrow(/packages/);
  });
});

describe('findAggregateAliases — renaming the aggregate is the finding, not the reference count', () => {
  it('flags an aliased IMPORT', () => {
    // Round 2's route: `as IHost` made every downstream reference invisible.
    const found = findAggregateAliases(
      "import type { ICommandHostContext as IHost } from 'x';\n",
      'p.ts',
      ['ICommandHostContext'],
    );

    expect(found).toEqual([{ aggregate: 'ICommandHostContext', alias: 'IHost', line: 1 }]);
  });

  it('flags an aliased RE-EXPORT, which the import-only fix did not see', () => {
    // Round 3's route. Two ordinary lines in a repo whose barrels are full of re-exports. Patching
    // one syntactic form per round does not converge, so the CLASS is banned: there is no
    // legitimate reason to rename these aggregates.
    const found = findAggregateAliases(
      "export type { ICommandHostContext as IHostAlias } from 'x';\n",
      'p.ts',
      ['ICommandHostContext'],
    );

    expect(found).toHaveLength(1);
    expect(found[0].alias).toBe('IHostAlias');
  });

  it('does NOT flag an un-aliased import or re-export', () => {
    expect(
      findAggregateAliases(
        "import type { ICommandHostContext } from 'x';\nexport type { ICommandHostContext } from 'x';\n",
        'p.ts',
        ['ICommandHostContext'],
      ),
    ).toEqual([]);
  });

  it('does NOT flag an alias of some other symbol', () => {
    expect(
      findAggregateAliases("import type { ISomethingElse as IX } from 'x';\n", 'p.ts', [
        'ICommandHostContext',
      ]),
    ).toEqual([]);
  });
});
