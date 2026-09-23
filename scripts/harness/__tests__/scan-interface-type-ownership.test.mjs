import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';
import { findInterfaceTypeOwnershipFindings } from '../scan-interface-type-ownership.mjs';

function fixture(files) {
  const root = makeTemp('robota-interface-type-ownership-');
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content, 'utf8');
  }
  return root;
}

function ownerMap(names) {
  return [
    '<!-- arch-100:owner-map -->',
    '| Target owner | Contract modules | Leaf |',
    '| ------------ | ---------------- | ---- |',
    ...names.map((name) => `| \`${name}\` | \`contracts\` | issue #1 |`),
    '## Next section',
  ].join('\n');
}

describe('interface Type Ownership locations', () => {
  it('derives declaration locations and reports a mixed row that names the wrong source file', () => {
    const root = fixture({
      '.agents/specs/contract-family-owner-map.md': ownerMap(['agent-interface-example']),
      'packages/agent-interface-example/docs/SPEC.md': [
        '## Type Ownership',
        '',
        '| Type | Location | Purpose |',
        '| ---- | -------- | ------- |',
        '| `IRecord`, `IStore` | `src/record.ts` | persisted record and store |', // allow-missing-artifact: fixture path, created under a temporary root
        '| `isReady` | `src/peer.ts` | contract discriminator |', // allow-missing-artifact: fixture path, created under a temporary root
        '',
        '## Public API Surface',
      ].join('\n'),
      'packages/agent-interface-example/src/record.ts': 'export interface IRecord { id: string }\n',
      'packages/agent-interface-example/src/store.ts':
        'export interface IStore { get(): IRecord }\n',
      'packages/agent-interface-example/src/peer.ts':
        'export function isReady(): boolean { return true }\n',
    });

    const result = findInterfaceTypeOwnershipFindings(root);
    expect(result.examined).toBe(3);
    expect(result.findings).toEqual([
      expect.objectContaining({
        symbol: 'IStore',
        stated: 'src/record.ts',
        declared: ['src/store.ts'],
      }),
    ]);
  });

  it('checks the current interface-package corpus without accepting an empty table set', () => {
    const root = path.resolve(import.meta.dirname, '../../..');
    const result = findInterfaceTypeOwnershipFindings(root);
    expect(result.packages).toBe(6);
    expect(result.examined).toBeGreaterThanOrEqual(90);
    expect(result.findings).toEqual([]);
  });

  it('reports a package whose Type Ownership table disappears while others remain', () => {
    const root = fixture({
      '.agents/specs/contract-family-owner-map.md': ownerMap([
        'agent-interface-present',
        'agent-interface-missing',
      ]),
      'packages/agent-interface-present/docs/SPEC.md': [
        '## Type Ownership',
        '| Type | Location | Purpose |',
        '| ---- | -------- | ------- |',
        '| `IRecord` | `src/record.ts` | record |', // allow-missing-artifact: fixture path, created under a temporary root
      ].join('\n'),
      'packages/agent-interface-present/src/record.ts': 'export interface IRecord {}\n',
      'packages/agent-interface-missing/docs/SPEC.md': '## Scope\n\nNo ownership table.\n',
    });

    const result = findInterfaceTypeOwnershipFindings(root);
    expect(result.examined).toBe(1);
    expect(result.findings).toEqual([
      expect.objectContaining({
        kind: 'missing-package-claims',
        file: 'packages/agent-interface-missing/docs/SPEC.md',
      }),
    ]);
  });

  it('reads the File column used by the transport contract SPEC', () => {
    const root = fixture({
      '.agents/specs/contract-family-owner-map.md': ownerMap(['agent-interface-transport']),
      'packages/agent-interface-transport/docs/SPEC.md': [
        '## Type Ownership',
        '| Type | Kind | File | Description |',
        '| ---- | ---- | ---- | ----------- |',
        '| `IAdapter` | Interface | `transport-adapter.ts` | adapter |',
      ].join('\n'),
      'packages/agent-interface-transport/src/transport-adapter.ts':
        'export interface IAdapter {}\n',
    });

    const result = findInterfaceTypeOwnershipFindings(root);
    expect(result.packages).toBe(1);
    expect(result.examined).toBe(1);
    expect(result.findings).toEqual([]);
  });

  it('does not silently skip a malformed location beside a valid row', () => {
    const root = fixture({
      '.agents/specs/contract-family-owner-map.md': ownerMap(['agent-interface-example']),
      'packages/agent-interface-example/docs/SPEC.md': [
        '## Type Ownership',
        '| Type | Location | Purpose |',
        '| ---- | -------- | ------- |',
        '| `IRecord` | `src/record.ts` | record |', // allow-missing-artifact: fixture path, created under a temporary root
        '| `IStore` | src/store.ts | store |',
      ].join('\n'),
      'packages/agent-interface-example/src/record.ts': 'export interface IRecord {}\n',
      'packages/agent-interface-example/src/store.ts': 'export interface IStore {}\n',
    });

    const result = findInterfaceTypeOwnershipFindings(root);
    expect(result.findings).toEqual([
      expect.objectContaining({ kind: 'malformed-location', symbol: 'IStore' }),
    ]);
  });
});
