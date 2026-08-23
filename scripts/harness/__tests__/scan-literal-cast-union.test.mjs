import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  collectStringUnions,
  findLiteralCastUnionFindings,
  findLiteralCastViolations,
} from '../scan-literal-cast-union.mjs';

/**
 * The scan exists for one measured defect (DAG-002): `(companion?.status ?? 'active') as
 * TDagDefinitionStatus`, where the union is `'draft' | 'published' | 'deprecated'`.
 *
 * Two directions matter, and the second more than the first. It must FAIL on that shape — a check
 * that cannot fail is worse than no check. And it must NOT fail on the shapes it cannot decide, because
 * a scan that reports violations it is not sure of gets suppressed rather than obeyed, and a suppressed
 * scan protects nothing.
 */
const UNIONS = new Map([['TStatus', new Set(['draft', 'published', 'deprecated'])]]);

function scan(source, unions = UNIONS) {
  return findLiteralCastViolations(['f.ts'], unions, () => source);
}

function unionsOf(source) {
  return collectStringUnions(['f.ts'], () => source);
}

describe('scan-literal-cast-union', () => {
  it('reverse (RED): the exact DAG-002 shape fails', () => {
    const found = scan(`status: (companion?.status ?? 'active') as TStatus,`);
    expect(found).toHaveLength(1);
    expect(found[0]?.literal).toBe('active');
    expect(found[0]?.union).toBe('TStatus');
  });

  it('reverse (RED): a bare literal cast outside the union fails', () => {
    expect(scan(`const s = 'archived' as TStatus;`)).toHaveLength(1);
  });

  it('reverse (RED): a ternary branch outside the union fails, and names that branch', () => {
    const found = scan(`const s = (ok ? 'draft' : 'active') as TStatus;`);
    expect(found.map((f) => f.literal)).toEqual(['active']);
  });

  it('a literal that IS a member passes', () => {
    expect(scan(`const s = 'draft' as TStatus;`)).toEqual([]);
  });

  it('every branch being a member passes', () => {
    expect(scan(`const s = (a ?? 'draft') as TStatus;`)).toEqual([]);
  });

  it('a NON-literal operand is not judged', () => {
    // `someString as TStatus` is exactly as unchecked as it was. The scan narrows the hole to what it
    // can decide with certainty; claiming more would mean reporting findings it cannot support.
    expect(scan(`const s = resolveStatus(x) as TStatus;`)).toEqual([]);
    expect(scan(`const s = raw as TStatus;`)).toEqual([]);
  });

  it('a cast to an unknown type name is not judged', () => {
    expect(scan(`const s = 'anything' as TSomethingNotDeclaredHere;`)).toEqual([]);
  });

  it('an operator that is NOT a default is not followed', () => {
    // `+` does not select between its operands the way `??`/`||`/`?:` do, so a literal inside one is
    // not a value the cast can receive.
    expect(scan("const s = ('a' + 'b') as TStatus;")).toEqual([]);
  });

  it('reports the line of the LITERAL, not of the cast', () => {
    const source = ['const a = 1;', 'const s = (', "  'active'", ') as TStatus;'].join('\n');
    expect(scan(source)[0]?.line).toBe(3);
  });

  describe('union collection', () => {
    it('collects a plain string union', () => {
      expect([...(unionsOf(`export type T = 'a' | 'b';`).get('T') ?? [])]).toEqual(['a', 'b']);
    });

    it('collects a DOUBLE-quoted union', () => {
      // The cheap pre-filter's first version matched only `'`, and silently dropped two real
      // double-quoted unions on this tree. A union the scan never learned about is one it can never
      // find a violation against — an under-report, which is the direction that matters.
      expect([...(unionsOf(`type T = "a" | "b";`).get('T') ?? [])]).toEqual(['a', 'b']);
    });

    it('collects a union whose members start on the NEXT line after a leading bar', () => {
      expect([...(unionsOf("type T =\n  | 'a'\n  | 'b';").get('T') ?? [])]).toEqual(['a', 'b']);
    });

    it('collects a single-member alias', () => {
      expect([...(unionsOf(`type T = 'only';`).get('T') ?? [])]).toEqual(['only']);
    });

    it('marks a union with a NON-literal member unjudgeable rather than partial', () => {
      // `'a' | string` accepts every string. Recording it as `{'a'}` would report every other literal
      // as a violation — the false-positive flood that gets a scan turned off.
      expect(unionsOf(`type T = 'a' | string;`).get('T')).toBeNull();
      expect(scan(`const s = 'zzz' as T;`, unionsOf(`type T = 'a' | string;`))).toEqual([]);
    });

    it('does not treat a non-union alias as an empty member set', () => {
      // An empty set would make EVERY literal cast to it a violation.
      const unions = unionsOf(`type T = Record<string, number>;`);
      expect(scan(`const s = 'x' as T;`, unions)).toEqual([]);
    });

    it('merges two declarations of the same alias name rather than judging by one', () => {
      const unions = collectStringUnions(['a.ts', 'b.ts'], (f) =>
        f === 'a.ts' ? `type T = 'x';` : `type T = 'y';`,
      );
      expect(scan(`const s = 'y' as T;`, unions)).toEqual([]);
    });
  });

  /**
   * The registered path and the live tree. A scan that works when imported and is never invoked is
   * the declared-but-unreachable shape this repository's audit is about.
   */
  it('is registered, fails closed, and passes on the live repository', () => {
    const root = path.resolve(import.meta.dirname, '../../..');
    expect(readFileSync(path.join(root, 'scripts/harness/run-all-scans.mjs'), 'utf8')).toContain(
      'scan-literal-cast-union.mjs',
    );

    // Fail-closed: a root without the governed tree is an error, never a pass.
    const bare = makeTemp('literal-cast-bare-');
    try {
      expect(() => findLiteralCastUnionFindings(bare)).toThrow(/nothing could be examined/);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }

    const output = execFileSync('node', ['scripts/harness/scan-literal-cast-union.mjs'], {
      cwd: root,
      encoding: 'utf8',
    });
    // A pass over nothing is not a pass — assert the size it reports.
    const examined = Number(/passed \((\d+) file/.exec(output)?.[1] ?? '0');
    expect(examined).toBeGreaterThan(1000);
  });
});
