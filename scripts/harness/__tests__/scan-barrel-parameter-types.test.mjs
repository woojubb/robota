import { describe, expect, it } from 'vitest';

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  examinedBarrelCount,
  findBarrelParameterTypeFindings,
  parameterTypeNames,
  readBarrel,
} from '../scan-barrel-parameter-types.mjs';

/**
 * ARCH-037. Every rule is asserted in BOTH directions — it fires on the shape it names and stays
 * silent on the shape it does not. The silent half matters more than usual here: this floor's two
 * deliberate exclusions (return types, other packages' types) are what keep it from firing on
 * correct code, and a floor that fires on correct code gets allowlisted into silence.
 */
function fixture(prefix, files) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  for (const [name, contents] of Object.entries(files)) {
    const full = join(root, name);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

const BARREL = 'packages/p/src/index.ts';

function settings(extra = {}) {
  return { barrels: [BARREL], ...extra };
}

describe('parameterTypeNames', () => {
  it('reads a plain parameter type', () => {
    const { functions } = readBarrel('export function f(a: IThing): void {}\n', 'p.ts');
    expect(parameterTypeNames(functions[0].node)).toEqual(['IThing']);
  });

  it('reads a type nested inside a generic, which a shallow read would miss', () => {
    const { functions } = readBarrel(
      'export function f(a: ReadonlyArray<IThing>): void {}\n',
      'p.ts',
    );
    expect(parameterTypeNames(functions[0].node)).toContain('IThing');
  });

  it('reads every parameter, not just the first', () => {
    const { functions } = readBarrel('export function f(a: IOne, b: ITwo): void {}\n', 'p.ts');
    expect(parameterTypeNames(functions[0].node).sort()).toEqual(['IOne', 'ITwo']);
  });

  it('does NOT read the return type — a caller can hold a value without naming its type', () => {
    const { functions } = readBarrel('export function f(a: IOne): IReturned {}\n', 'p.ts');
    expect(parameterTypeNames(functions[0].node)).toEqual(['IOne']);
  });
});

describe('a published function whose parameter type is unpublished is a finding', () => {
  it('flags the function declared in the barrel itself', () => {
    const root = fixture('arch-037-decl-', {
      [BARREL]: 'export interface IOther {}\nexport function f(a: IThing): void {}\n',
      'packages/p/src/thing.ts': 'export interface IThing {}\n',
    });

    const { findings, examined } = findBarrelParameterTypeFindings(root, settings());

    expect(findings.map((f) => f.rule)).toEqual(['barrel-parameter-type-unexported']);
    expect(findings[0].detail).toContain('IThing');
    expect(examined).toBe(1);
    expect(examinedBarrelCount(), 'the walk was miscounted').toBe(1);

    // Again over the same fixture: an accumulating counter would say 2.
    findBarrelParameterTypeFindings(root, settings());
    expect(examinedBarrelCount(), 'the counter accumulates across runs').toBe(1);
  });

  it('follows a function published by RE-EXPORT, which is how the real defect arrived', () => {
    const root = fixture('arch-037-reexport-', {
      [BARREL]: "export { f } from './impl.js';\n",
      'packages/p/src/impl.ts':
        'export interface IThing {}\nexport function f(a: IThing): void {}\n',
    });

    const { findings } = findBarrelParameterTypeFindings(root, settings());

    expect(findings.map((f) => f.rule)).toEqual(['barrel-parameter-type-unexported']);
  });

  it('follows one more hop through a NESTED barrel — the shape of `subagentExecutionRoot`', () => {
    // `index.ts` → `subagents/index.ts` → `execution-root.ts`. A one-hop walk reports nothing here,
    // which is exactly how the real instance stayed invisible.
    const root = fixture('arch-037-nested-', {
      [BARREL]: "export { f } from './sub/index.js';\n",
      'packages/p/src/sub/index.ts': "export { f } from './impl.js';\n",
      'packages/p/src/sub/impl.ts':
        'export interface IThing {}\nexport function f(a: IThing): void {}\n',
    });

    const { findings } = findBarrelParameterTypeFindings(root, settings());

    expect(findings.map((f) => f.rule)).toEqual(['barrel-parameter-type-unexported']);
  });

  it('is silent when the parameter type IS exported from the same barrel', () => {
    const root = fixture('arch-037-ok-', {
      [BARREL]: "export type { IThing } from './thing.js';\nexport { f } from './impl.js';\n",
      'packages/p/src/thing.ts': 'export interface IThing {}\n',
      'packages/p/src/impl.ts':
        "import type { IThing } from './thing.js';\nexport function f(a: IThing): void {}\n",
    });

    expect(findBarrelParameterTypeFindings(root, settings()).findings).toEqual([]);
  });
});

describe('the two deliberate exclusions, which keep it from firing on correct code', () => {
  it('does NOT flag a type owned by ANOTHER package', () => {
    // Requiring the barrel to re-export it would demand exactly the pass-through re-exports
    // STRUCT-07 bans — the rule would contradict a rule.
    const root = fixture('arch-037-foreign-', {
      [BARREL]:
        "import type { IForeign } from '@robota-sdk/other';\nexport function f(a: IForeign): void {}\n",
    });

    expect(findBarrelParameterTypeFindings(root, settings()).findings).toEqual([]);
  });

  it('does NOT flag an unexported RETURN type', () => {
    const root = fixture('arch-037-return-', {
      [BARREL]: 'export function f(): IReturned {}\n',
      'packages/p/src/returned.ts': 'export interface IReturned {}\n',
    });

    expect(findBarrelParameterTypeFindings(root, settings()).findings).toEqual([]);
  });

  it('does NOT flag ambient types every consumer can already name', () => {
    const root = fixture('arch-037-ambient-', {
      [BARREL]:
        'export function f(a: string, b: Promise<number>, c: Record<string, Date>): void {}\n',
    });

    expect(findBarrelParameterTypeFindings(root, settings()).findings).toEqual([]);
  });
});

describe('the floor fails closed rather than measuring nothing', () => {
  it('flags an empty barrel list instead of returning a clean result', () => {
    const { findings } = findBarrelParameterTypeFindings(process.cwd(), { barrels: [] });

    expect(findings.map((f) => f.rule)).toEqual(['barrel-scope-empty']);
  });
});

/**
 * Round-2 review found this file byte-identical across the commit that fixed the round-1 MUST, and
 * passing 12/12 against the PRE-fix reader. So the fixpoint walk, `export *`, const-arrow, default
 * exports, overloads, own-generic exclusion and the `wanted` threading all shipped with no coverage
 * at all — a suite that cannot go red on the defect it was written for.
 *
 * Every case below was run against that pre-fix reader (`d68982b45`) before being kept: 11 of the 12
 * FAIL there and pass here, which is the proof that they constrain something.
 *
 * The twelfth — "publishes only the NAME a named re-export carries" — passes on BOTH, and is kept
 * anyway with that stated rather than implied. It guards the widening defect (a resolver unioning
 * every visited module's declarations, so deleting a real re-export line changed nothing), which
 * existed only in an uncommitted intermediate revision. There is no commit to red-prove it against,
 * so it is a regression guard, not a demonstrated one. Saying that here costs a sentence; letting a
 * reader assume all twelve were proved is how this file came to be trusted while proving nothing.
 */
describe('red-proved against the pre-fix reader — each case fails on a two-hop walk', () => {
  it('follows THREE re-export hops, the depth the real barrel has', () => {
    // Chain: index.ts, then a/index.ts, then a/b/index.ts, then the impl module beneath it — every
    // one written into a throwaway temp dir below, not into this repo. The pre-fix reader stopped at two
    // and reported nothing, which is how `agent-executor` hid three functions.
    const root = fixture('arch-037-three-hop-', {
      [BARREL]: "export { f } from './a/index.js';\n",
      'packages/p/src/a/index.ts': "export { f } from './b/index.js';\n",
      'packages/p/src/a/b/index.ts': "export { f } from './impl.js';\n",
      'packages/p/src/a/b/impl.ts':
        'export interface IThing {}\nexport function f(a: IThing): void {}\n',
    });

    expect(findBarrelParameterTypeFindings(root, settings()).findings.map((f) => f.rule)).toEqual([
      'barrel-parameter-type-unexported',
    ]);
  });

  it('reads a const-arrow export, which has no FunctionDeclaration to find', () => {
    const root = fixture('arch-037-const-arrow-', {
      [BARREL]: "export { f } from './impl.js';\n",
      'packages/p/src/impl.ts':
        'export interface IThing {}\nexport const f = (a: IThing): void => {};\n',
    });

    expect(findBarrelParameterTypeFindings(root, settings()).findings.map((f) => f.rule)).toEqual([
      'barrel-parameter-type-unexported',
    ]);
  });

  it('reads a default-exported function', () => {
    const root = fixture('arch-037-default-', {
      [BARREL]: "export { default as f } from './impl.js';\n",
      'packages/p/src/impl.ts':
        'export interface IThing {}\nexport default function f(a: IThing): void {}\n',
    });

    expect(findBarrelParameterTypeFindings(root, settings()).findings.map((f) => f.rule)).toEqual([
      'barrel-parameter-type-unexported',
    ]);
  });

  it('follows `export *`, which publishes a whole module rather than a named list', () => {
    const root = fixture('arch-037-star-', {
      [BARREL]: "export * from './impl.js';\n",
      'packages/p/src/impl.ts':
        "import type { IThing } from './thing.js';\nexport function f(a: IThing): void {}\n",
      'packages/p/src/thing.ts': 'export interface IThing {}\n',
    });

    expect(findBarrelParameterTypeFindings(root, settings()).findings.map((f) => f.rule)).toEqual([
      'barrel-parameter-type-unexported',
    ]);
  });

  it('reads EVERY signature of an overload set, not only the first', () => {
    const root = fixture('arch-037-overload-', {
      [BARREL]: "export { f } from './impl.js';\n",
      'packages/p/src/impl.ts':
        'export interface IThing {}\n' +
        'export function f(a: string): void;\n' +
        'export function f(a: IThing): void;\n' +
        'export function f(a: unknown): void {}\n',
    });

    expect(findBarrelParameterTypeFindings(root, settings()).findings.map((f) => f.rule)).toEqual([
      'barrel-parameter-type-unexported',
    ]);
  });

  it('publishes only the NAME a named re-export carries, not everything the target declares', () => {
    // The widening defect: a resolver that unions each visited module's declarations reads a wider
    // surface than the package has, so `IThing` counts as published and the finding disappears. The
    // barrel re-exports `f` alone, so `IThing` is NOT published and this must fire.
    const root = fixture('arch-037-wanted-', {
      [BARREL]: "export { f } from './impl.js';\n",
      'packages/p/src/impl.ts':
        'export interface IThing {}\nexport function f(a: IThing): void {}\n',
    });

    expect(findBarrelParameterTypeFindings(root, settings()).findings.map((f) => f.rule)).toEqual([
      'barrel-parameter-type-unexported',
    ]);
  });

  it('does NOT flag a function’s own generic parameter, even when a type of that name exists', () => {
    // Over-fire guard: the pre-fix reader flagged `TItem` here because a package-declared type of
    // the same name exists. In a `T`-prefixing repo that collision is ordinary, not exotic.
    const root = fixture('arch-037-generic-', {
      [BARREL]: "export { f } from './impl.js';\n",
      'packages/p/src/impl.ts': 'export function f<TItem>(a: TItem): void {}\n',
      'packages/p/src/other.ts': 'export type TItem = string;\n',
    });

    expect(findBarrelParameterTypeFindings(root, settings()).findings).toEqual([]);
  });
});

describe('evasions and over-fires closed in round 2', () => {
  it('follows a DEFERRED `export { f };` back to the module it was imported from', () => {
    // `import { f } from './impl.js'; export { f };` put `f` in the export set but created no edge,
    // so its parameters were never read — silent on a defect the `export … from` form reports.
    const root = fixture('arch-037-deferred-', {
      [BARREL]: "import { f } from './impl.js';\nexport { f };\n",
      'packages/p/src/impl.ts':
        'export interface IThing {}\nexport function f(a: IThing): void {}\n',
    });

    expect(findBarrelParameterTypeFindings(root, settings()).findings.map((f) => f.rule)).toEqual([
      'barrel-parameter-type-unexported',
    ]);
  });

  it('does NOT treat an `export function` inside a namespace as a barrel export', () => {
    // A namespace body publishes INTO the namespace, not out of the module. Descending into it made
    // a nested name look like published surface.
    const root = fixture('arch-037-namespace-', {
      [BARREL]:
        'export interface IPublic {}\n' +
        'export namespace Inner {\n  export function f(a: IHidden): void {}\n}\n',
      'packages/p/src/hidden.ts': 'export interface IHidden {}\n',
    });

    expect(findBarrelParameterTypeFindings(root, settings()).findings).toEqual([]);
  });

  it('recognises `export abstract class` as a declaration of this package', () => {
    // `declaredInPackage`'s pattern had no slot for `abstract`, so 10+ live declarations read as
    // another package's type and were skipped — an under-report, which is the dangerous direction.
    const root = fixture('arch-037-abstract-', {
      [BARREL]: "export { f } from './impl.js';\n",
      'packages/p/src/impl.ts':
        "import type { Base } from './base.js';\nexport function f(a: Base): void {}\n",
      'packages/p/src/base.ts': 'export abstract class Base {}\n',
    });

    expect(findBarrelParameterTypeFindings(root, settings()).findings.map((f) => f.rule)).toEqual([
      'barrel-parameter-type-unexported',
    ]);
  });

  it('resolves a directory edge that lands on `index.tsx`', () => {
    const root = fixture('arch-037-index-tsx-', {
      [BARREL]: "export { f } from './ui/index.js';\n",
      'packages/p/src/ui/index.tsx':
        'export interface IThing {}\nexport function f(a: IThing): void {}\n',
    });

    expect(findBarrelParameterTypeFindings(root, settings()).findings.map((f) => f.rule)).toEqual([
      'barrel-parameter-type-unexported',
    ]);
  });

  it('requires a package-declared type even when its name shadows a built-in', () => {
    // The deleted `AMBIENT_TYPES` set would have skipped this by name. A package that declares its
    // own `Date` and exports a function taking it owes that type on its barrel like any other;
    // real built-ins fall out anyway, because they are not declared in the package.
    const root = fixture('arch-037-shadow-', {
      [BARREL]: "export { f, g } from './impl.js';\n",
      'packages/p/src/impl.ts':
        "import type { Date } from './date.js';\n" +
        'export function f(a: Date): void {}\n' +
        'export function g(a: string, b: Promise<number>): void {}\n',
      'packages/p/src/date.ts': 'export interface Date {}\n',
    });

    const { findings } = findBarrelParameterTypeFindings(root, settings());

    expect(findings.map((f) => f.rule)).toEqual(['barrel-parameter-type-unexported']);
    expect(findings[0].detail, 'the built-ins in `g` must not be reported').toContain('Date');
  });
});
