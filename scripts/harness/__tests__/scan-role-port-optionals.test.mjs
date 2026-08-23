import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  declarationsOf,
  examinedFileCount,
  findOptionalMembers,
  findRolePortOptionalFindings,
  resolveModuleFile,
} from '../scan-role-port-optionals.mjs';

/**
 * ARCH-029 TC-06. The detector has to be exact in BOTH directions: it must see every declaration
 * form an optional member can take, and it must not see an optional-looking thing that is not one.
 * A floor meant to sit at zero and stay there is silenced the moment it over-fires, and this file's
 * whole job is to make the zero mean something.
 */
function optionalsOf(source, name = 'IPort') {
  return findOptionalMembers(source, 'probe.ts').get(name)?.optional ?? [];
}

/** A fixture root holding `files`, as `{ name: contents }`. */
function fixture(prefix, files) {
  const root = makeTemp(prefix);
  mkdirSync(join(root, 'packages'), { recursive: true });
  for (const [name, contents] of Object.entries(files)) writeFileSync(join(root, name), contents);
  return root;
}

describe('findOptionalMembers', () => {
  it('sees the method-shorthand optional form', () => {
    expect(optionalsOf('export interface IPort {\n  doThing?(): void;\n}\n')).toEqual(['doThing']);
  });

  it('sees the property-signature optional form, which a `name?(` regex misses', () => {
    expect(optionalsOf('export interface IPort {\n  doThing?: () => void;\n}\n')).toEqual([
      'doThing',
    ]);
  });

  it('sees an optional non-function property', () => {
    expect(optionalsOf('export interface IPort {\n  label?: string;\n}\n')).toEqual(['label']);
  });

  it('reports nothing for a port whose members are all required', () => {
    expect(
      optionalsOf(
        'export interface IPort {\n  a(): void;\n  b: string;\n  c(x: number): void;\n}\n',
      ),
    ).toEqual([]);
  });

  it('does NOT count an optional PARAMETER as an optional member', () => {
    // The member is required; only its argument is optional. A text detector conflates the two,
    // and this shape is everywhere in the guarded contract (`compact(instructions?: string)`).
    expect(
      optionalsOf('export interface IPort {\n  compact(instructions?: string): void;\n}\n'),
    ).toEqual([]);
  });

  it('does NOT count prose in a docblock that shows an optional call', () => {
    expect(
      optionalsOf(
        'export interface IPort {\n  /** Call as `host.doThing?.()` when unsure. */\n  doThing(): void;\n}\n',
      ),
    ).toEqual([]);
  });

  it('attributes each optional to the interface that declares it', () => {
    const found = findOptionalMembers(
      'export interface IA {\n  a?(): void;\n}\nexport interface IB {\n  b?(): void;\n  c(): void;\n}\n',
      'probe.ts',
    );

    expect(found.get('IA').optional).toEqual(['a']);
    expect(found.get('IB').optional).toEqual(['b']);
  });

  it('lists every optional member, not just the first', () => {
    expect(
      optionalsOf('export interface IPort {\n  a?(): void;\n  b(): void;\n  c?(): void;\n}\n'),
    ).toEqual(['a', 'c']);
  });

  it('ACCUMULATES members across two declarations of one name, as TypeScript merges them', () => {
    // Route G. `Map.set` per declaration kept only the LAST, so writing the decoy half FIRST hid a
    // real optional member. Demonstrated by review on the real `host-roles.ts`, compiling clean
    // under `--strict`, with the floor printing `0 optional member(s)`.
    const found = findOptionalMembers(
      'export interface IPort {\n  sneaky?(): void;\n}\nexport interface IPort {\n  harmless(): void;\n}\n',
      'probe.ts',
    );

    expect(found.get('IPort').optional).toEqual(['sneaky']);
    expect(found.get('IPort').members).toEqual(['sneaky', 'harmless']);
    expect(found.get('IPort').declarations).toBe(2);
  });
});

describe('declarationsOf resolves names in the file that declares them', () => {
  it('records a named import so a heritage name can be followed to its declaring file', () => {
    const { imports } = declarationsOf(
      "import type { IReal as ILocal } from './other.js';\nexport interface IAgg extends ILocal {}\n",
      'probe.ts',
    );

    expect(imports.get('ILocal')).toEqual({ module: './other.js', exported: 'IReal' });
  });

  it('reports a namespace-nested interface separately from a top-level one of the same name', () => {
    const { interfaces, nested } = declarationsOf(
      'declare namespace decoy {\n  export interface IPort {\n    harmless(): void;\n  }\n}\n' +
        'export interface IPort {\n  sneaky?(): void;\n}\n',
      'probe.ts',
    );

    expect(nested).toEqual([{ name: 'IPort' }]);
    expect(interfaces.get('IPort').optional).toEqual(['sneaky']);
  });
});

describe('resolveModuleFile', () => {
  it('follows a relative specifier to the scanned .ts file its .js extension names', () => {
    expect(
      resolveModuleFile('pkg/src/a/host.ts', './roles.js', new Set(['pkg/src/a/roles.ts'])),
    ).toBe('pkg/src/a/roles.ts');
  });

  it('answers undefined for a package specifier, which can never be a scanned file', () => {
    expect(resolveModuleFile('pkg/src/a/host.ts', '@robota-sdk/x', new Set())).toBeUndefined();
  });

  it('answers undefined when the target is not in the scanned set', () => {
    expect(resolveModuleFile('pkg/src/a/host.ts', './hidden.js', new Set())).toBeUndefined();
  });
});

describe('findRolePortOptionalFindings — `examined` is an output, and is asserted as one', () => {
  it('examines EXACTLY the files it is given and flags exactly the port optionals in them', () => {
    // Fixture of known size: 1 file, 3 optionals declared, 1 of them on a DATA shape the scope
    // excludes and 1 carved out — so exactly one finding.
    const root = fixture('arch-029-ports-', {
      'ports.ts':
        'export interface IOptionsBag {\n  x?: string;\n}\n' +
        'export interface IPortA {\n  a?(): void;\n}\n' +
        'export interface IPortB {\n  b?(): void;\n}\n' +
        'export interface IAgg extends IPortA, IPortB {}\n',
    });
    const settings = {
      files: ['ports.ts'],
      aggregates: ['IAgg'],
      carveOuts: [{ interface: 'IPortB', member: 'b', reason: 'variational by design' }],
    };

    const { findings, examined } = findRolePortOptionalFindings(root, settings);

    expect(examined).toBe(1);
    expect(examinedFileCount(), 'the walk was miscounted').toBe(1);
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toContain('IPortA.a?');

    // Again over the same fixture: an accumulating counter would say 2.
    findRolePortOptionalFindings(root, settings);
    expect(examinedFileCount(), 'the counter accumulates across runs').toBe(1);
  });
});

describe('a port declared outside the scanned files is a finding, not a silent pass', () => {
  it('flags a port named in `extends` whose declaration no scanned file contains', () => {
    // Demonstrated by review against the shipped scan: ports are DERIVED from the extends clause,
    // but their declarations were only searched inside the configured file list. A new file with an
    // optional member, added to the aggregate, printed "0 optional member(s)" — an optional member
    // reachable through the aggregate that the floor never read.
    const root = fixture('arch-029-unscanned-', {
      'ports.ts':
        'export interface IPortA {\n  a(): void;\n}\n' +
        'export interface IAgg extends IPortA, IPortElsewhere {}\n',
    });

    const { findings } = findRolePortOptionalFindings(root, {
      files: ['ports.ts'],
      aggregates: ['IAgg'],
      carveOuts: [],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe('role-port-declaration-unscanned');
    expect(findings[0].detail).toContain('IPortElsewhere');
  });

  it('does not flag a port that IS declared in a scanned file', () => {
    const root = fixture('arch-029-scanned-', {
      'a.ts': 'export interface IPortA {\n  a(): void;\n}\n',
      'b.ts': "import type { IPortA } from './a.js';\nexport interface IAgg extends IPortA {}\n",
    });

    const { findings } = findRolePortOptionalFindings(root, {
      files: ['a.ts', 'b.ts'],
      aggregates: ['IAgg'],
      carveOuts: [],
    });

    expect(findings).toEqual([]);
  });

  it('flags an import that renames an UNSCANNED port to the name of a scanned one', () => {
    // Route F, and the reason names resolve through the declaring file rather than a repo-wide map.
    // The aggregate's file extends `IPortA`, but ITS `IPortA` is imported from an unscanned file.
    // A bare-name map resolved that edge to the innocent sibling declaration, so the evil members
    // were live on the aggregate and completely unread. Reproduced by review on the real role file.
    const root = fixture('arch-029-shadow-', {
      'a.ts': 'export interface IPortA {\n  harmless(): void;\n}\n',
      'b.ts':
        "import type { IEvil as IPortA } from './hidden.js';\n" +
        'export interface IAgg extends IPortA {}\n',
      'hidden.ts': 'export interface IEvil {\n  sneaky?(): void;\n}\n',
    });

    const { findings } = findRolePortOptionalFindings(root, {
      files: ['a.ts', 'b.ts'],
      aggregates: ['IAgg'],
      carveOuts: [],
    });

    expect(findings.map((f) => f.rule)).toEqual(['role-port-declaration-unscanned']);
    expect(findings[0].detail).toContain("imported from './hidden.js'");
  });

  it('sees the optional member through an import that DOES resolve to a scanned file', () => {
    // The control for the case above: same shape, target scanned. Resolution must follow the
    // import to the real declaration rather than fail closed on everything imported.
    const root = fixture('arch-029-shadow-ok-', {
      'a.ts': 'export interface IPortA {\n  harmless(): void;\n}\n',
      'b.ts':
        "import type { IEvil as IPortA } from './hidden.js';\n" +
        'export interface IAgg extends IPortA {}\n',
      'hidden.ts': 'export interface IEvil {\n  sneaky?(): void;\n}\n',
    });

    const { findings } = findRolePortOptionalFindings(root, {
      files: ['a.ts', 'b.ts', 'hidden.ts'],
      aggregates: ['IAgg'],
      carveOuts: [],
    });

    expect(findings.map((f) => f.rule)).toEqual(['role-port-optional-member']);
    expect(findings[0].detail).toContain('IEvil.sneaky?');
  });
});

describe('an aggregate with members of its own is a finding (TC-04, mechanised)', () => {
  it('flags a REQUIRED member added to the aggregate body', () => {
    // The optional case is caught by the closure; this catches the required one, which the closure
    // cannot. TC-04 says "each aggregate is an empty `extends`" and review found that mechanised
    // nowhere — so the shape the trajectory table actually measures had no floor at all.
    const root = fixture('arch-029-agg-', {
      'ports.ts':
        'export interface IPortA {\n  a(): void;\n}\n' +
        'export interface IAgg extends IPortA {\n  accreted(): void;\n}\n',
    });

    const { findings } = findRolePortOptionalFindings(root, {
      files: ['ports.ts'],
      aggregates: ['IAgg'],
      carveOuts: [],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe('aggregate-has-own-members');
    expect(findings[0].detail).toContain('accreted');
  });

  it('flags a member added through a SECOND declaration of the aggregate in the same file', () => {
    // Route G2. Declaration merging put the member on the aggregate with the decoy half written
    // first, and the last-write-wins map silenced this rule entirely.
    const root = fixture('arch-029-agg-merged-', {
      'ports.ts':
        'export interface IAgg {\n  accreted(): void;\n}\n' +
        'export interface IPortA {\n  a(): void;\n}\n' +
        'export interface IAgg extends IPortA {}\n',
    });

    const { findings } = findRolePortOptionalFindings(root, {
      files: ['ports.ts'],
      aggregates: ['IAgg'],
      carveOuts: [],
    });

    expect(findings.map((f) => f.rule)).toEqual(['aggregate-has-own-members']);
    expect(findings[0].detail).toContain('across 2 merged declarations');
  });

  it('names an unnamed member by its source text rather than `<unnamed>`', () => {
    // Index, call and construct signatures all reach this rule and have no name. `<unnamed>` names
    // nothing a reader can act on.
    const root = fixture('arch-029-agg-index-', {
      'ports.ts':
        'export interface IPortA {\n  a(): void;\n}\n' +
        'export interface IAgg extends IPortA {\n  [key: string]: unknown;\n}\n',
    });

    const { findings } = findRolePortOptionalFindings(root, {
      files: ['ports.ts'],
      aggregates: ['IAgg'],
      carveOuts: [],
    });

    expect(findings[0].rule).toBe('aggregate-has-own-members');
    expect(findings[0].detail).toContain('[key: string]: unknown');
  });

  it('does not flag an aggregate that is a genuinely empty extends', () => {
    const root = fixture('arch-029-agg-ok-', {
      'ports.ts':
        'export interface IPortA {\n  a(): void;\n}\nexport interface IAgg extends IPortA {}\n',
    });

    const { findings } = findRolePortOptionalFindings(root, {
      files: ['ports.ts'],
      aggregates: ['IAgg'],
      carveOuts: [],
    });

    expect(findings).toEqual([]);
  });
});

describe('a construct this floor cannot model is a finding, not a silent pass', () => {
  it('flags a namespaced name that COLLIDES with a top-level one in the same file', () => {
    // Route F2. Which of the two declarations the floor read is not apparent from the source, and a
    // decoy is placed exactly where that is unclear.
    const root = fixture('arch-029-ns-', {
      'ports.ts':
        'declare namespace decoy {\n  export interface IPortA {\n    harmless(): void;\n  }\n}\n' +
        'export interface IPortA {\n  sneaky?(): void;\n}\n' +
        'export interface IAgg extends IPortA {}\n',
    });

    const { findings } = findRolePortOptionalFindings(root, {
      files: ['ports.ts'],
      aggregates: ['IAgg'],
      carveOuts: [],
    });

    expect(findings.map((f) => f.rule)).toEqual([
      'namespace-scoped-declaration',
      'role-port-optional-member',
    ]);
  });

  it('does NOT flag ordinary augmentation, which collides with nothing', () => {
    // The over-fire review measured: an earlier revision reported EVERY namespaced interface, so
    // `declare global { interface Window … }` and a `declare module 'vitest'` augmentation each
    // turned the floor red on their own. Both are things a real contributor writes, and a floor
    // that fires on them gets allowlisted into silence.
    const root = fixture('arch-029-ns-ok-', {
      'ports.ts':
        'declare global {\n  interface Window {\n    thing: string;\n  }\n}\n' +
        "declare module 'vitest' {\n  interface Assertion {\n    toBeThing(): void;\n  }\n}\n" +
        'export interface IPortA {\n  a(): void;\n}\n' +
        'export interface IAgg extends IPortA {}\n',
    });

    const { findings } = findRolePortOptionalFindings(root, {
      files: ['ports.ts'],
      aggregates: ['IAgg'],
      carveOuts: [],
    });

    expect(findings).toEqual([]);
  });

  it('flags a heritage expression no name can be read from', () => {
    // The backstop for a form the walker does not understand. Review measured that no VALID
    // TypeScript reaches it — every legal heritage form resolves — so it is a guard against a
    // parser divergence, and this case is what proves it is not simply unreachable code.
    const root = fixture('arch-029-unreadable-', {
      'ports.ts': 'export interface IAgg extends IPortA["x"] {}\n',
    });

    const { findings } = findRolePortOptionalFindings(root, {
      files: ['ports.ts'],
      aggregates: ['IAgg'],
      carveOuts: [],
    });

    expect(findings.map((f) => f.rule)).toContain('heritage-name-unresolvable');
  });

  it('does NOT fire the unreadable rule for any legal heritage form', () => {
    const legal = [
      'export interface IAgg extends IPortA {}\n',
      'export interface IAgg extends IPortA<string> {}\n',
      'export interface IAgg extends ns.IPortA {}\n',
      'export interface IAgg extends a.b.c.IPortA {}\n',
    ];

    for (const source of legal) {
      expect(declarationsOf(source, 'probe.ts').unreadable, source).toEqual([]);
    }
  });

  it('flags an aggregate declared in two different scanned files as ambiguous', () => {
    const root = fixture('arch-029-two-homes-', {
      'a.ts': 'export interface IAgg {\n  accreted(): void;\n}\n',
      'b.ts': 'export interface IAgg {}\n',
    });

    const { findings } = findRolePortOptionalFindings(root, {
      files: ['a.ts', 'b.ts'],
      aggregates: ['IAgg'],
      carveOuts: [],
    });

    expect(findings.map((f) => f.rule)).toContain('aggregate-declared-in-multiple-files');
  });

  it('does NOT flag two unrelated data shapes that happen to share a name across files', () => {
    // The over-fire review demonstrated in the previous revision, which reported a cross-file
    // duplicate as a finding. Resolution is per declaring file now, so a shared name outside the
    // closure is simply not this floor's business — and a floor that fires on options bags it
    // explicitly disclaims jurisdiction over is a floor that gets allowlisted into silence.
    const root = fixture('arch-029-dup-ok-', {
      'a.ts': 'export interface IOptions {\n  x?: string;\n}\nexport interface IAgg {}\n',
      'b.ts': 'export interface IOptions {\n  y?: number;\n}\n',
    });

    const { findings } = findRolePortOptionalFindings(root, {
      files: ['a.ts', 'b.ts'],
      aggregates: ['IAgg'],
      carveOuts: [],
    });

    expect(findings).toEqual([]);
  });
});

describe('a configured aggregate that resolves to nothing is a finding', () => {
  it('flags an aggregate declared in NO scanned file, while the others still resolve', () => {
    // A regression this scan introduced while fixing the class it belongs to: `homes.length === 0`
    // fell through with no finding and no queue entry, so deleting or renaming one aggregate took
    // every role port it composes out of scope and the floor printed a pass. `role-port-scope-empty`
    // cannot cover it — that needs EVERY aggregate to vanish, and here one still resolves.
    const root = fixture('arch-029-missing-agg-', {
      'ports.ts':
        'export interface IPortA {\n  a(): void;\n}\n' +
        'export interface IAggOne extends IPortA {}\n',
    });

    const { findings } = findRolePortOptionalFindings(root, {
      files: ['ports.ts'],
      aggregates: ['IAggOne', 'IAggGone'],
      carveOuts: [],
    });

    expect(findings.map((f) => f.rule)).toEqual(['aggregate-declaration-missing']);
    expect(findings[0].detail).toContain('IAggGone');
  });
});

describe('`examined` cannot overstate what was read', () => {
  it('counts a path listed twice in `files` once', () => {
    const root = fixture('arch-029-dupe-path-', {
      'ports.ts':
        'export interface IPortA {\n  a(): void;\n}\nexport interface IAgg extends IPortA {}\n',
    });

    const { examined } = findRolePortOptionalFindings(root, {
      files: ['ports.ts', 'ports.ts'],
      aggregates: ['IAgg'],
      carveOuts: [],
    });

    expect(examined).toBe(1);
    expect(examinedFileCount()).toBe(1);
  });
});

describe('an empty scope fails closed at BOTH config keys', () => {
  it('flags an empty `files` list instead of returning a clean result', () => {
    // Deleting one config array silenced the floor: it returned `{ findings: [] }` before any
    // fail-closed check and `main()` printed a pass. That is the same "absence reads as a pass"
    // shape this floor exists to close, moved one layer out into the config.
    const { findings } = findRolePortOptionalFindings(process.cwd(), {
      files: [],
      aggregates: ['IAgg'],
      carveOuts: [],
    });

    expect(findings.map((f) => f.rule)).toEqual(['role-port-scope-empty']);
  });

  it('flags an empty `aggregates` list', () => {
    const { findings } = findRolePortOptionalFindings(process.cwd(), {
      files: ['ports.ts'],
      aggregates: [],
      carveOuts: [],
    });

    expect(findings.map((f) => f.rule)).toEqual(['role-port-scope-empty']);
  });
});
