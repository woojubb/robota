import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  extractStaticNodeTypes,
  findDagNodeRegistrationOwnerFindings,
  parseDagNodeOwnerMap,
  readExaminedDagNodePackageCount,
} from '../scan-dag-node-registration-owner.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const map = (rows) =>
  [
    '<!-- dag-node-registration-owner-map:start -->',
    '| Package owner | Static `nodeType` identities |',
    '| --- | --- |',
    ...rows,
    '<!-- dag-node-registration-owner-map:end -->',
  ].join('\n');

describe('DAG registration owner map', () => {
  it('extracts literal identities and ignores caller-supplied instant-node identities', () => {
    const source = `export class A { public readonly nodeType = 'alpha'; }
      export class B { public readonly nodeType: string; constructor(spec) { this.nodeType = spec.nodeType; } }`;
    expect(extractStaticNodeTypes(source, 'index.ts')).toEqual(['alpha']);
  });

  it('sees a definition declared inside a factory, not only top-level classes', () => {
    const source =
      "export function make() { class Nested { readonly nodeType = 'nested'; } return new Nested(); }";
    expect(extractStaticNodeTypes(source, 'nested.ts')).toEqual(['nested']);
  });

  it('does not silently accept an unmeasured static nodeType syntax', () => {
    const result = findDagNodeRegistrationOwnerFindings('/fixture', {
      doc: map(['| `alpha` | `a` |']),
      owners: ['alpha'],
      readSource: () => "export class A { get nodeType() { return 'a'; } }",
    });
    expect(result.findings.join(' ')).toMatch(/unsupported nodeType declaration/);
  });

  it('accepts a constant template literal and rejects computed property syntax', () => {
    expect(
      extractStaticNodeTypes('export class A { readonly nodeType = `fixed`; }', 'a.ts'),
    ).toEqual(['fixed']);
    const result = findDagNodeRegistrationOwnerFindings('/fixture', {
      doc: map(['| `alpha` | `a` |']),
      owners: ['alpha'],
      readSource: () => "export class A { readonly ['nodeType'] = 'a'; }",
    });
    expect(result.findings.join(' ')).toMatch(/unsupported nodeType declaration/);
  });

  it('rejects missing, duplicate and wrong package ownership', () => {
    const sources = new Map([
      ['alpha', "export class A { public readonly nodeType = 'a'; }"],
      ['beta', "export class B { public readonly nodeType = 'b'; }"],
    ]);
    const readSource = (owner) => sources.get(owner);
    const owners = ['alpha', 'beta'];
    const result = findDagNodeRegistrationOwnerFindings('/fixture', {
      doc: map(['| `alpha` | `a`, `b` |', '| `beta` | `a` |']),
      owners,
      readSource,
    });
    expect(result.examined).toBe(2);
    expect(result.findings.join(' ')).toMatch(/duplicate.*a/);
    expect(result.findings.join(' ')).toMatch(/wrong owner.*b/);
  });

  it('rejects duplicate source identities across packages', () => {
    const result = findDagNodeRegistrationOwnerFindings('/fixture', {
      doc: map(['| `alpha` | `same` |']),
      owners: ['alpha', 'beta'],
      readSource: () => "export class A { readonly nodeType = 'same'; }",
    });
    expect(result.findings.join(' ')).toMatch(/duplicate source identity same/);
  });

  it('allows caller-supplied identities only in the instant-node factory package', () => {
    const result = findDagNodeRegistrationOwnerFindings('/fixture', {
      doc: map(['| `alpha` | `a` |']),
      owners: ['alpha', 'instant-node'],
      readSource: (owner) =>
        owner === 'instant-node'
          ? 'export class PromptBackedNodeDefinition { readonly nodeType: string; }'
          : "export class A { readonly nodeType = 'a'; }",
    });
    expect(result.findings).toEqual([]);
  });

  it('does not exempt an instant-node getter or a third dynamic class', () => {
    const result = findDagNodeRegistrationOwnerFindings('/fixture', {
      doc: map(['| `alpha` | `a` |']),
      owners: ['alpha', 'instant-node'],
      readSource: (owner) =>
        owner === 'instant-node'
          ? "export class PromptBackedNodeDefinition { get nodeType() { return 'hidden'; } } export class NewNodeDefinition { readonly nodeType: string; }"
          : "export class A { readonly nodeType = 'a'; }",
    });
    expect(
      result.findings.filter((finding) => finding.includes('unsupported nodeType declaration')),
    ).toHaveLength(2);
  });

  it('fails closed when the map or a package source disappears', () => {
    expect(parseDagNodeOwnerMap('missing marker').findings.join(' ')).toMatch(/missing owner map/);
    const result = findDagNodeRegistrationOwnerFindings('/fixture', {
      doc: map(['| `alpha` | `a` |']),
      owners: ['alpha'],
      readSource: () => undefined,
    });
    expect(result.findings.join(' ')).toMatch(/missing source/);
  });

  it('detects an unmapped new definition and stale map entry', () => {
    const result = findDagNodeRegistrationOwnerFindings('/fixture', {
      doc: map(['| `alpha` | `old` |']),
      owners: ['alpha'],
      readSource: () => "export class A { public readonly nodeType = 'new'; }",
    });
    expect(result.findings.join(' ')).toMatch(/unmapped.*new/);
    expect(result.findings.join(' ')).toMatch(/stale.*old/);
  });

  it('matches the complete real family', () => {
    const result = findDagNodeRegistrationOwnerFindings(ROOT);
    expect(result.examined).toBe(19);
    expect(readExaminedDagNodePackageCount()).toBe(19);
    expect(result.staticIdentities).toBe(32);
    expect(result.findings).toEqual([]);
    findDagNodeRegistrationOwnerFindings(ROOT);
    expect(readExaminedDagNodePackageCount()).toBe(19);
    expect(readFileSync(path.join(ROOT, 'packages/dag-nodes/docs/SPEC.md'), 'utf8')).toContain(
      'dag-node-registration-owner-map:start',
    );
  });
});
