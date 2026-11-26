import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// The dependency boundary is not gated by the repository's dependency rules, so this reads the
// manifest and the shipped source and holds the line: the adapter depends on the roundtable
// contract and the protocol SDK alone, never on a sibling adapter, the framework or a transport, and
// it reads neither the process environment nor product configuration.

const SRC = path.dirname(fileURLToPath(import.meta.url));

interface Manifest {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

const manifest = JSON.parse(readFileSync(path.join(SRC, '..', 'package.json'), 'utf8')) as Manifest;

/** The files that ship: everything in `src` that is neither a test nor a test fixture. */
const SHIPPED = readdirSync(SRC)
  .filter((entry) => entry.endsWith('.ts'))
  .filter(
    (entry) => !/\.test\.ts$/.test(entry) && !/^(?:fake-agent|test-support)\.ts$/.test(entry),
  );

const ALLOWED_SPECIFIERS = new Set([
  'node:path',
  '@robota-sdk/agent-roundtable',
  '@agentclientprotocol/sdk',
]);

function specifiersOf(text: string): string[] {
  return [...text.matchAll(/(?:from|import\(|import|require\()\s*['"]([^'"]+)['"]/g)].map(
    (match) => match[1],
  );
}

describe('manifest', () => {
  it('depends at run time on the roundtable contract alone', () => {
    expect(Object.keys(manifest.dependencies ?? {})).toEqual(['@robota-sdk/agent-roundtable']);
    expect(manifest.optionalDependencies).toBeUndefined();
  });

  it('asks the host for the protocol SDK at one exact version, not optionally', () => {
    expect(Object.keys(manifest.peerDependencies ?? {}).sort()).toEqual([
      '@agentclientprotocol/sdk',
      'zod',
    ]);
    expect(manifest.peerDependencies?.['@agentclientprotocol/sdk']).toBe('1.9.0');
    expect(manifest.devDependencies?.['@agentclientprotocol/sdk']).toBe('1.9.0');
    expect(manifest.peerDependenciesMeta?.['@agentclientprotocol/sdk']?.optional).not.toBe(true);
  });

  it('names no other package of this repository in any dependency section', () => {
    const named = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
    ].filter((name) => name.startsWith('@robota-sdk/'));
    expect([...new Set(named)]).toEqual(['@robota-sdk/agent-roundtable']);
  });
});

describe('shipped source', () => {
  it('has files to check', () => {
    expect(SHIPPED).toContain('index.ts');
  });

  it.each(SHIPPED)(
    '%s imports only relative modules, node:path, the roundtable and the SDK',
    (file) => {
      for (const specifier of specifiersOf(readFileSync(path.join(SRC, file), 'utf8'))) {
        expect(
          specifier.startsWith('.') || ALLOWED_SPECIFIERS.has(specifier),
          `${file} imports ${specifier}`,
        ).toBe(true);
      }
    },
  );

  it.each(SHIPPED)(
    '%s reads no environment, home directory, working directory or product configuration',
    (file) => {
      const text = readFileSync(path.join(SRC, file), 'utf8');
      for (const forbidden of [
        /process\.env/,
        /homedir/,
        /process\.cwd/,
        /product-config/,
        /node:os/,
      ]) {
        expect(text, `${file} matches ${String(forbidden)}`).not.toMatch(forbidden);
      }
    },
  );
});
