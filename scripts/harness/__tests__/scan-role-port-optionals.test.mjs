import { describe, expect, it } from 'vitest';

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  examinedFileCount,
  findOptionalMembers,
  findRolePortOptionalFindings,
  rolePortsOf,
} from '../scan-role-port-optionals.mjs';

/**
 * ARCH-029 TC-06. The detector has to be exact in BOTH directions: it must see every declaration
 * form an optional member can take, and it must not see an optional-looking thing that is not one.
 * A floor meant to sit at zero and stay there is silenced the moment it over-fires, and this file's
 * whole job is to make the zero mean something.
 */
function optionalsOf(source, name = 'IPort') {
  return findOptionalMembers(source, 'probe.ts').get(name) ?? [];
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

    expect(found.get('IA')).toEqual(['a']);
    expect(found.get('IB')).toEqual(['b']);
  });

  it('lists every optional member, not just the first', () => {
    expect(
      optionalsOf('export interface IPort {\n  a?(): void;\n  b(): void;\n  c?(): void;\n}\n'),
    ).toEqual(['a', 'c']);
  });
});

describe("rolePortsOf — the scan's scope is derived, not listed", () => {
  it('resolves exactly the ports the aggregates extend, and no data shape beside them', () => {
    const source =
      'export interface IOptionsBag {\n  x?: string;\n}\n' +
      'export interface IPortA {\n  a(): void;\n}\n' +
      'export interface IPortB {\n  b(): void;\n}\n' +
      'export interface IAgg extends IPortA, IPortB {}\n';

    const ports = rolePortsOf(source, 'probe.ts', ['IAgg']);

    expect([...ports].sort()).toEqual(['IPortA', 'IPortB']);
  });
});

describe('findRolePortOptionalFindings — `examined` is an output, and is asserted as one', () => {
  it('examines EXACTLY the files it is given and flags exactly the port optionals in them', () => {
    // Fixture of known size: 1 file, 3 optionals declared, 1 of them on a DATA shape the scope
    // excludes and 1 carved out — so exactly one finding.
    const root = mkdtempSync(join(tmpdir(), 'arch-029-ports-'));
    mkdirSync(join(root, 'packages'), { recursive: true });
    writeFileSync(
      join(root, 'ports.ts'),
      'export interface IOptionsBag {\n  x?: string;\n}\n' +
        'export interface IPortA {\n  a?(): void;\n}\n' +
        'export interface IPortB {\n  b?(): void;\n}\n' +
        'export interface IAgg extends IPortA, IPortB {}\n',
    );

    const { findings, examined } = findRolePortOptionalFindings(root, {
      files: ['ports.ts'],
      aggregates: ['IAgg'],
      carveOuts: [{ interface: 'IPortB', member: 'b', reason: 'variational by design' }],
    });

    const settings = {
      files: ['ports.ts'],
      aggregates: ['IAgg'],
      carveOuts: [{ interface: 'IPortB', member: 'b', reason: 'variational by design' }],
    };

    expect(examined).toBe(1);
    expect(examinedFileCount(), 'the walk was miscounted').toBe(1);
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toContain('IPortA.a?');

    // Again over the same fixture: an accumulating counter would say 2.
    findRolePortOptionalFindings(root, settings);
    expect(examinedFileCount(), 'the counter accumulates across runs').toBe(1);
  });
});
