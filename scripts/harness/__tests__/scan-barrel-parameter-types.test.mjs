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
