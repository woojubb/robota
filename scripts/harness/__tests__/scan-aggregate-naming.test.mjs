import { describe, expect, it } from 'vitest';

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  collectAggregateNaming,
  findAggregateAliases,
  examinedFileCount,
  findAggregateNamingFindings,
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

  it('does not COUNT an allowlisted file, but still reads it', () => {
    // The allowlist exempts a file's references from the count and nothing else — so the file is
    // read (its renames are still checked) while contributing zero references. Round 4 found the
    // rename ban sitting behind the skip, which made the ten files most entitled to NAME the
    // aggregate the ten that could freely RENAME it.
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

    expect(examined).toBe(2);
    expect(counts.get('ICommandHostContext').references).toBe(1);
  });

  it('flags a rename inside an ALLOWLISTED file', () => {
    // Route H, reproduced by review on the real tree: one `export type IHostAll =
    // ICommandHostContext;` in the allowlisted declaration site, plus an ordinary consumer naming
    // `IHostAll` in type position and in `extends`, left the scan green at its frozen baseline.
    const root = mkdtempSync(join(tmpdir(), 'arch-029-allow-rename-'));
    mkdirSync(join(root, 'packages'), { recursive: true });
    writeFileSync(join(root, 'b.ts'), 'export type IHostAll = ICommandHostContext;\n');

    const { aliasFindings } = collectAggregateNaming(
      root,
      {
        aggregateNaming: {
          aggregates: ['ICommandHostContext'],
          allowlist: [{ file: 'b.ts', reason: 'the declaration site' }],
        },
      },
      ['b.ts'],
    );

    expect(aliasFindings).toHaveLength(1);
    expect(aliasFindings[0].rule).toBe('aggregate-renamed');
    expect(aliasFindings[0].detail).toContain('IHostAll');
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

describe('the ratchet requires its subject to exist', () => {
  it('flags a guarded aggregate that no scanned file declares', () => {
    // A count falls for two reasons that look identical from outside: the consumers migrated, or
    // the subject stopped existing under that name. Measured with only a renamed declaration
    // present, the scan counted 0 against a frozen 18 and passed — reading as a finished migration.
    const root = mkdtempSync(join(tmpdir(), 'arch-029-gone-'));
    mkdirSync(join(root, 'packages'), { recursive: true });
    writeFileSync(join(root, 'a.ts'), 'export interface IAgentJobHostContextRenamed {}\n');

    const { declaredIn } = collectAggregateNaming(
      root,
      { aggregateNaming: { aggregates: ['IAgentJobHostContext'], allowlist: [] } },
      ['a.ts'],
    );

    expect(declaredIn.get('IAgentJobHostContext')).toEqual([]);
  });

  it('records the file that DOES declare it', () => {
    const root = mkdtempSync(join(tmpdir(), 'arch-029-home-'));
    mkdirSync(join(root, 'packages'), { recursive: true });
    writeFileSync(join(root, 'a.ts'), 'export interface ICommandHostContext {}\n');

    const { declaredIn } = collectAggregateNaming(
      root,
      { aggregateNaming: { aggregates: ['ICommandHostContext'], allowlist: [] } },
      ['a.ts'],
    );

    expect(declaredIn.get('ICommandHostContext')).toEqual(['a.ts']);
  });

  it('is NOT satisfied by a decoy declaration outside the declaration site', () => {
    // "Declared somewhere in the tree" was satisfiable by one bare `interface ICommandHostContext {}`
    // in an unimported file — cheaper than any rename route, and it left the scan green against a
    // frozen baseline. The site is pinned to the allowlist, which already names each real
    // declaration file with a reason.
    const root = mkdtempSync(join(tmpdir(), 'arch-029-decoy-'));
    mkdirSync(join(root, 'packages'), { recursive: true });
    writeFileSync(join(root, 'site.ts'), 'export interface ICommandHostContextRenamed {}\n');
    writeFileSync(join(root, 'decoy.ts'), 'export interface ICommandHostContext {}\n');

    const settings = {
      aggregateNaming: {
        aggregates: ['ICommandHostContext'],
        allowlist: [{ file: 'site.ts', reason: 'the declaration site' }],
      },
    };

    const { findings } = findAggregateNamingFindings(root, settings, ['site.ts', 'decoy.ts']);

    expect(findings.map((f) => f.rule)).toContain('aggregate-declaration-missing');

    // Control: with the real declaration back at the allowlisted site, the rule is silent.
    writeFileSync(join(root, 'site.ts'), 'export interface ICommandHostContext {}\n');
    const after = findAggregateNamingFindings(root, settings, ['site.ts', 'decoy.ts']);
    expect(after.findings.map((f) => f.rule)).not.toContain('aggregate-declaration-missing');
  });
});

describe('a carve-out that matches nothing is reported', () => {
  it('flags a configured carve-out with no live site', () => {
    // It fails closed — a stale entry just stops exempting — but config asserting an exception that
    // does not exist is the same silence this file's header refuses everywhere else.
    const root = mkdtempSync(join(tmpdir(), 'arch-029-stale-carve-'));
    mkdirSync(join(root, 'packages'), { recursive: true });
    writeFileSync(join(root, 'site.ts'), 'export interface ICommandHostContext {}\n');

    const { aliasFindings } = collectAggregateNaming(
      root,
      {
        aggregateNaming: {
          aggregates: ['ICommandHostContext'],
          allowlist: [{ file: 'site.ts', reason: 'the declaration site' }],
          renameCarveOuts: [
            { file: 'site.ts', declaration: 'IGone.member', type: 'IGone', reason: 'moved away' },
          ],
        },
      },
      ['site.ts'],
    );

    expect(aliasFindings.map((f) => f.rule)).toEqual(['rename-carve-out-unused']);
  });
});

describe('an empty aggregate list fails closed', () => {
  it('flags an empty `aggregates` config instead of returning a clean result', () => {
    // Deleting one config array switched the load-bearing floor off silently: it returned
    // `{ findings: [] }` and `main()` printed a pass. Same "absence reads as a pass" shape as the
    // rest of this round, moved one layer out into the config.
    const bare = mkdtempSync(join(tmpdir(), 'arch-029-noagg-'));

    const { findings } = findAggregateNamingFindings(bare, { aggregateNaming: {} });

    expect(findings.map((f) => f.rule)).toEqual(['aggregate-scope-empty']);
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

    expect(found).toEqual([
      { aggregate: 'ICommandHostContext', alias: 'IHost', line: 1, form: 'an aliased import' },
    ]);
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

  it('flags a TYPE ALIAS, the form that made the allowlist a rename channel', () => {
    // Round 4's route H. The previous revision inspected import/export SPECIFIERS only, so the
    // one-line form that needs no import at all was invisible everywhere, allowlisted or not.
    const found = findAggregateAliases('export type IHostAll = ICommandHostContext;\n', 'p.ts', [
      'ICommandHostContext',
    ]);

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ alias: 'IHostAll', form: 'a type alias' });
  });

  it('flags a type alias written through an `import()` type', () => {
    const found = findAggregateAliases(
      "type IHostAll = import('@robota-sdk/agent-framework').ICommandHostContext;\n",
      'p.ts',
      ['ICommandHostContext'],
    );

    expect(found).toHaveLength(1);
    expect(found[0].alias).toBe('IHostAll');
  });

  it('flags an INTERFACE that extends the aggregate — a second name for the whole surface', () => {
    const found = findAggregateAliases(
      'export interface IAlsoEverything extends ICommandHostContext {}\n',
      'p.ts',
      ['ICommandHostContext'],
    );

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      alias: 'IAlsoEverything',
      form: 'an interface that extends it',
    });
  });

  it('does NOT flag a class that IMPLEMENTS the aggregate — that is conformance, not a rename', () => {
    // The production host declares `implements ICommandHostContext`, and TC-01 installed exactly
    // that as the compiler-checked conformance. Banning it would ban the check.
    expect(
      findAggregateAliases('export class Host implements ICommandHostContext {}\n', 'p.ts', [
        'ICommandHostContext',
      ]),
    ).toEqual([]);
  });

  it('flags a WRAPPED alias inside an ALLOWLISTED file, where nothing counts references', () => {
    // Round 5's route. `directlyNamedAggregate` is exact, and exactness is right where references
    // are still counted — but an allowlisted file's references are NOT counted, so both channels
    // were off and two characters defeated the ban. Measured green from an allowlisted file before
    // this: `& {}`, `Omit<I, never>`, `Pick<I, keyof I>`, `Readonly<I>`, a conditional resolving to
    // `I`, `extends Omit<I, never>`, and bare parentheses.
    const wrapped = [
      'export type IHostAll = ICommandHostContext & {};\n',
      'export type IHostAll = Omit<ICommandHostContext, never>;\n',
      'export type IHostAll = Readonly<ICommandHostContext>;\n',
      'export type IHostAll = (ICommandHostContext);\n',
      'export interface IHostAll extends Omit<ICommandHostContext, never> {}\n',
    ];

    for (const source of wrapped) {
      expect(
        findAggregateAliases(source, 'p.ts', ['ICommandHostContext'], { allowlisted: true }),
        source,
      ).toHaveLength(1);
    }
  });

  it('flags every position an allowlisted declaration can MINT a handle from', () => {
    // Round 6. The previous revision applied the mint rule at two positions — a type alias RHS and
    // a heritage clause — and review measured three more taking the whole surface with the ratchet
    // unmoved: a member type reached as `IHostBox['it']`, an exported const reached as
    // `typeof theHost`, and a generic default reached as `IBox['it']`. The rule was right and the
    // implementation was positional.
    const minted = [
      'export interface IHostBox {\n  readonly it: ICommandHostContext;\n}\n',
      'export interface IHostBox {\n  readonly it: Readonly<ICommandHostContext>;\n}\n',
      'export declare const theHost: ICommandHostContext;\n',
      'export interface IBox<T = ICommandHostContext> {\n  readonly it: T;\n}\n',
    ];

    for (const source of minted) {
      expect(
        findAggregateAliases(source, 'p.ts', ['ICommandHostContext'], { allowlisted: true }),
        source,
      ).toHaveLength(1);
    }
  });

  it('treats a DEFERRED `export { X }` as exported', () => {
    // Round 7. `isExported` read only `node.modifiers`, so "has an export modifier" stood in for
    // "is exported" and three routes went green on the real tree behind an ordinary second export
    // form.
    const deferred = [
      'interface IHostBox {\n  readonly it: ICommandHostContext;\n}\nexport { IHostBox };\n',
      'declare const theHost: ICommandHostContext;\nexport { theHost };\n',
      'interface IBox<T = ICommandHostContext> {\n  readonly it: T;\n}\nexport { IBox };\n',
    ];

    for (const source of deferred) {
      expect(
        findAggregateAliases(source, 'p.ts', ['ICommandHostContext'], { allowlisted: true }),
        source,
      ).toHaveLength(1);
    }
  });

  it('inspects INSIDE a function type — only a parameter is skipped structurally', () => {
    // `FunctionType` and `ConstructorType` were skipped subtree-and-all and forced by no site: the
    // real tree is green without them, and their presence cost three routes.
    const inside = [
      'export type TGetHost = () => ICommandHostContext;\n',
      'export interface IHostBox {\n  readonly get: () => Array<ICommandHostContext>;\n}\n',
      'export type TCtor = new () => ICommandHostContext;\n',
    ];

    for (const source of inside) {
      expect(
        findAggregateAliases(source, 'p.ts', ['ICommandHostContext'], { allowlisted: true }),
        source,
      ).toHaveLength(1);
    }
  });

  it('does NOT flag the CONSUMED positions, which mint nothing', () => {
    // The direction that makes `execute(context: I)` harmless is not that it is a member — it is
    // that nothing outside can address the aggregate through it. A parameter is the ONLY kind
    // skipped structurally, and it is unbounded-but-safe: no instance of it is addressable, so a
    // blanket rule and a per-site rule would exempt the same set. A generic CONSTRAINT mints
    // nothing either. An UNEXPORTED declaration is unreachable from outside the file, which is how
    // both doubles' `const base: IAggregate = { … }` stays clean — the cast-free conformance they
    // exist to provide.
    const consumed = [
      'export interface ISystemCommand {\n  execute(context: ICommandHostContext): void;\n}\n',
      'export type TRun = (context: ICommandHostContext) => void;\n',
      'export interface IBox<T extends ICommandHostContext> {\n  readonly it: T;\n}\n',
      'const base: ICommandHostContext = makeIt();\n',
      'interface IUnexported {\n  readonly it: ICommandHostContext;\n}\n',
    ];

    for (const source of consumed) {
      expect(
        findAggregateAliases(source, 'p.ts', ['ICommandHostContext'], { allowlisted: true }),
        source,
      ).toEqual([]);
    }
  });

  it('honours a named carve-out that states the EXACT type it exempts', () => {
    // Four real sites exist and are listed in the harness config, each with a reason and the exact
    // type it exempts: the two role-port methods that reach a sibling aggregate by design, and the
    // conformant double's two options-bag members. Recorded here so the rule is not quietly
    // designed around them.
    const source =
      'export interface ICreateTestCommandHostOptions {\n  readonly overrides?: TOverrides<ICommandHostContext>;\n}\n';
    const carveOuts = new Map([
      ['double.ts#ICreateTestCommandHostOptions.overrides', 'TOverrides<ICommandHostContext>'],
    ]);

    expect(
      findAggregateAliases(source, 'double.ts', ['ICommandHostContext'], { allowlisted: true }),
    ).toHaveLength(1);
    expect(
      findAggregateAliases(source, 'double.ts', ['ICommandHostContext'], {
        allowlisted: true,
        carveOuts,
      }),
    ).toEqual([]);
  });

  it('a carve-out covers ONLY the type it names, not every wrapper under that member name', () => {
    // Two weaker versions were measured through. Keying on the member NAME alone exempted
    // `overrides?: IAggregate` under an entry written for `TOverrides<IAggregate>`; requiring
    // merely "not syntactically bare" then exempted `(I)`, `I & {}`, `I | I`, `I | never` and
    // `Readonly<I>` — every one a full handle on the surface. The entry now states its type.
    const carveOuts = new Map([
      ['double.ts#ICreateTestCommandHostOptions.overrides', 'TOverrides<ICommandHostContext>'],
    ]);
    const evasions = [
      'ICommandHostContext',
      '(ICommandHostContext)',
      'ICommandHostContext & {}',
      'ICommandHostContext | ICommandHostContext',
      'ICommandHostContext | never',
      'Readonly<ICommandHostContext>',
    ];

    for (const type of evasions) {
      expect(
        findAggregateAliases(
          `export interface ICreateTestCommandHostOptions {\n  readonly overrides?: ${type};\n}\n`,
          'double.ts',
          ['ICommandHostContext'],
          { allowlisted: true, carveOuts },
        ),
        type,
      ).toHaveLength(1);
    }
  });

  it('a carve-out matches regardless of how the type is FORMATTED', () => {
    // The exemption asserts a type, not a line break. A member wrapped across lines by the
    // formatter must still match the single-line type the config states — otherwise a cosmetic
    // reformat turns the load-bearing floor red AND reports the exemption as describing nothing,
    // which is the over-fire shape that gets a floor silenced.
    const wrapped =
      'export interface IOpts {\n  readonly overrides?: TOverrides<\n    ICommandHostContext\n  >;\n}\n';

    expect(
      findAggregateAliases(wrapped, 'double.ts', ['ICommandHostContext'], {
        allowlisted: true,
        carveOuts: new Map([['double.ts#IOpts.overrides', 'TOverrides<ICommandHostContext>']]),
      }),
    ).toEqual([]);
  });

  it('normalising formatting does NOT collapse a space that separates identifiers', () => {
    // `keyof T` and `keyofT` are different tokens. Stripping whitespace next to punctuation must
    // not become stripping whitespace generally.
    expect(
      findAggregateAliases(
        'export interface IOpts {\n  readonly keys?: keyof ICommandHostContext;\n}\n',
        'double.ts',
        ['ICommandHostContext'],
        {
          allowlisted: true,
          carveOuts: new Map([['double.ts#IOpts.keys', 'keyofICommandHostContext']]),
        },
      ),
    ).toHaveLength(1);
  });

  it('a METHOD signature returning the aggregate is a handle, not a structural exemption', () => {
    // `MethodSignature` was in the skip set, forced by two sites and exempting every future
    // method-signature handle in all ten allowlisted files. The identical member in property syntax
    // was red — a rule keyed on syntax rather than on the property. The two real sites are named
    // carve-outs now; everything else fires.
    const handles = [
      'export interface IHostReach {\n  getEverything(): ICommandHostContext;\n}\n',
      'export interface IHostReach {\n  (): ICommandHostContext;\n}\n',
      'export interface IHostReach {\n  new (): ICommandHostContext;\n}\n',
    ];

    for (const source of handles) {
      expect(
        findAggregateAliases(source, 'p.ts', ['ICommandHostContext'], { allowlisted: true }),
        source,
      ).toHaveLength(1);
    }
  });

  it('treats `export default <identifier>` as exported', () => {
    // An ExportAssignment, not an ExportDeclaration. Review reproduced the route end to end on the
    // real tree and compiled a consumer reaching the surface through `typeof theHost`.
    expect(
      findAggregateAliases(
        'declare const theHost: ICommandHostContext;\nexport default theHost;\n',
        'p.ts',
        ['ICommandHostContext'],
        { allowlisted: true },
      ),
    ).toHaveLength(1);
  });

  it('does NOT apply the mint rule outside the allowlist — the reference count guards those', () => {
    // A member type naming the aggregate in an ordinary consumer is a REFERENCE, and the ratchet
    // already counts and freezes it. Applying "mentions anywhere" there would double-report every
    // honest site and fire on the narrowing aliases this repo's tests genuinely use.
    expect(
      findAggregateAliases(
        'export interface IHostBox {\n  readonly it: ICommandHostContext;\n}\n',
        'p.ts',
        ['ICommandHostContext'],
      ),
    ).toEqual([]);
  });

  it('does NOT flag a narrowing alias outside the allowlist, which the count already guards', () => {
    // Real code in this repo: `type TPermissionMode = ReturnType<ICommandSessionRuntime['…']>`.
    // It names one member's return type, not the surface, and it is counted as a reference — so
    // applying the allowlisted "mentions anywhere" rule everywhere would fire on honest test code.
    expect(
      findAggregateAliases(
        "type TPermissionMode = ReturnType<ICommandSessionRuntime['getPermissionMode']>;\n",
        'p.ts',
        ['ICommandSessionRuntime'],
      ),
    ).toEqual([]);
  });

  it('does NOT flag a WRAPPED use, which is a reference and already counted', () => {
    expect(
      findAggregateAliases(
        "type A = Partial<ICommandHostContext>;\ntype B = ICommandHostContext['getCwd'];\ntype C = () => ICommandHostContext;\n",
        'p.ts',
        ['ICommandHostContext'],
      ),
    ).toEqual([]);
  });
});

describe('an `import()` type is a type-position reference', () => {
  it('counts `import(...).IAggregate`, which needs no import statement to name the surface', () => {
    // Round 4: three such uses in one consumer left the ratchet GREEN, while the equivalent plain
    // annotation went red. The header claims this definition is broader than a `: IAggregate` grep;
    // this is a form the grep would have caught and the AST walk did not.
    const found = findAggregateReferences(
      "export function f(c: import('@robota-sdk/agent-framework').ICommandHostContext): void {}\n",
      'probe.ts',
      AGGREGATES,
    );

    expect(found).toHaveLength(1);
    expect(found[0].aggregate).toBe('ICommandHostContext');
  });
});
