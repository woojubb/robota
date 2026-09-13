import { describe, expect, it } from 'vitest';

import * as configOwner from '../workspace-source-config-resolution.mjs';
import { resolveSourceReference } from '../workspace-source-reference-resolution.mjs';

describe('direct tsconfig extends references', () => {
  it('extracts single and array JSONC extends with decoded values and exact literal spans', () => {
    const source = 'packages/a/tsconfig.json';
    for (const literal of [
      '"../shared/tsconfig.private"',
      '["../shared/tsconfig.private", "./tsconfig.base.json"]',
    ]) {
      const text = `{\n // only the direct property is a reference\n "extends": ${literal},\n "other": { "extends": "./not-a-parent.json" },\n}`;
      const references = configOwner.extractConfigReferences(text, source);
      const expected = literal.startsWith('[')
        ? ['../shared/tsconfig.private', './tsconfig.base.json']
        : ['../shared/tsconfig.private'];
      expect(references.map((reference) => reference.specifier)).toEqual(expected);
      for (const reference of references) {
        expect(reference).toMatchObject({ source, kind: 'config', anchor: 'source' });
        expect(JSON.parse(text.slice(reference.span.start, reference.span.end))).toBe(
          reference.specifier,
        );
        expect(reference.expression).toBe(text.slice(reference.span.start, reference.span.end));
      }
    }
  });

  it('limits discovery to tsconfig JSON files and refuses invalid extends rather than losing them', () => {
    expect(configOwner.extractConfigReferences('{bad json', 'fixtures/data.json')).toEqual([]);
    expect(configOwner.extractConfigReferences('{"extends":"./other"}', 'package.json')).toEqual(
      [],
    );
    expect(configOwner.extractConfigReferences('{}', 'tsconfig.base.json')).toEqual([]);
    expect(configOwner.extractConfigReferences('{"extends":[]}', 'tsconfig.json')).toEqual([]);
    for (const value of ['null', '42', '["./valid", false]', '{}']) {
      expect(() =>
        configOwner.extractConfigReferences(`{"extends":${value}}`, 'tsconfig.json'),
      ).toThrow('invalid-config-extends');
    }
    expect(() => configOwner.extractConfigReferences('{bad json', 'tsconfig.json')).toThrow();
    const text = '{"extends":"./ignored", "extends":"./tsconfig.b\\u0061se.json"}';
    const references = configOwner.extractConfigReferences(text, 'tsconfig.dev.json');
    expect(references).toHaveLength(1);
    expect(references[0].specifier).toBe('./tsconfig.base.json');
    expect(JSON.parse(text.slice(references[0].span.start, references[0].span.end))).toBe(
      './tsconfig.base.json',
    );
  });

  it('feeds direct private and missing config inputs to the existing resolver without source translation', () => {
    const source = 'packages/a/tsconfig.json';
    const text =
      '{"extends":["../shared/tsconfig.private", "./missing", "./cache.js", "../../../outside"]}';
    const references = configOwner.extractConfigReferences(text, source);
    const context = {
      files: new Set([source, 'packages/shared/tsconfig.private.json', 'packages/a/cache.ts']),
      readFile: () => {
        throw new Error('resolution must use only declared regular paths');
      },
    };
    const resolved = references.map((reference) => resolveSourceReference(reference, context));
    expect(resolved).toHaveLength(4);
    expect(resolved[0]).toEqual({
      ...references[0],
      resolution: {
        status: 'resolved',
        targets: ['packages/shared/tsconfig.private.json'],
        evidenceInputs: [source, 'packages/shared/tsconfig.private.json'],
      },
    });
    expect(resolved[1].resolution).toEqual({
      status: 'unresolved',
      reason: 'missing-config',
      evidenceInputs: ['packages/a/missing', source],
    });
    expect(resolved[2].resolution.reason).toBe('missing-config');
    expect(resolved[3].resolution.reason).toBe('reference-escapes-repository');
    context.files.delete('packages/shared/tsconfig.private.json');
    expect(resolveSourceReference(references[0], context).resolution.reason).toBe('missing-config');
  });

  it('retains package config declaration evidence and unknowns without opening dependency storage', () => {
    const source = 'packages/a/tsconfig.json';
    const references = configOwner.extractConfigReferences(
      '{"extends":["astro/tsconfigs/strict", "@test/shared/base", "undeclared/base"]}',
      source,
    );
    const manifest = 'packages/a/package.json';
    const reads = [];
    const context = {
      files: new Set([source, manifest]),
      packages: [{ name: '@test/shared', directory: 'packages/shared' }],
      readFile: (file) => {
        reads.push(file);
        if (file !== manifest) throw new Error(`unexpected read ${file}`);
        return '{"devDependencies":{"astro":"1.0.0","@test/shared":"workspace:*"}}';
      },
    };
    const results = references.map(
      (reference) => resolveSourceReference(reference, context).resolution,
    );
    expect(results[0]).toEqual({ status: 'external', evidenceInputs: [manifest, source] });
    expect(results[1]).toEqual({
      status: 'unresolved',
      reason: 'unknown-workspace-module',
      evidenceInputs: [manifest, source],
    });
    expect(results[2]).toEqual({
      status: 'unresolved',
      reason: 'undeclared-module',
      evidenceInputs: [manifest, source],
    });
    expect(reads).toEqual([manifest, manifest, manifest]);
  });
});
