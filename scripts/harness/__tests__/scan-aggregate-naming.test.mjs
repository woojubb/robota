import { describe, expect, it } from 'vitest';

import { findAggregateReferences } from '../scan-aggregate-naming.mjs';

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
