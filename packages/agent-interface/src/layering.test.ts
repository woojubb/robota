import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SRC = path.dirname(fileURLToPath(import.meta.url));

/**
 * The layering of the contract families: the subpaths each one may import (the dependency edges
 * between the families). A subpath may import only itself, the entry of a subpath listed here and,
 * for the families in `MAY_IMPORT_CORE`, `@robota-sdk/agent-core`.
 */
const MAY_IMPORT: Readonly<Record<string, readonly string[]>> = {
  analytics: [],
  command: [],
  execution: [],
  session: ['analytics', 'command', 'execution'],
  'session-mobility': ['session'],
  transport: [],
  tui: [],
};

/** The subpaths that may name `@robota-sdk/agent-core`; the others stay free of it. */
const MAY_IMPORT_CORE: readonly string[] = [
  'command',
  'execution',
  'session',
  'session-mobility',
  'transport',
];

function sourceFilesUnder(directory: string): string[] {
  return readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .filter((entry) => /\.tsx?$/.test(entry))
    .map((entry) => path.join(directory, entry));
}

function specifiersOf(file: string): string[] {
  const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
  return [
    ...text.matchAll(/(?:\bfrom|\bimport\s*\(?|\brequire\s*\(|\bvi\.mock\()\s*['"]([^'"]+)['"]/g),
  ].map((match) => match[1]);
}

function reachesCycle(start: string, seen: readonly string[] = []): boolean {
  if (seen.includes(start)) return true;
  return (MAY_IMPORT[start] ?? []).some((next) => reachesCycle(next, [...seen, start]));
}

describe('agent-interface layering', () => {
  it('declares a layer for every subpath directory', () => {
    const directories = readdirSync(SRC, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(directories).toEqual(Object.keys(MAY_IMPORT).sort());
  });

  it('has no cycle between subpaths', () => {
    for (const subpath of Object.keys(MAY_IMPORT)) {
      expect(reachesCycle(subpath), subpath).toBe(false);
    }
  });

  it.each(Object.keys(MAY_IMPORT))(
    '%s imports only agent-core and the entries of the layers below it',
    (subpath) => {
      const own = path.join(SRC, subpath);
      for (const file of sourceFilesUnder(own)) {
        for (const specifier of specifiersOf(file)) {
          if (specifier.startsWith('@robota-sdk/')) {
            expect(specifier, `${file} imports ${specifier}`).toBe('@robota-sdk/agent-core');
            expect(MAY_IMPORT_CORE, `${file} imports ${specifier}`).toContain(subpath);
            continue;
          }
          if (!specifier.startsWith('.')) continue;
          const target = path.resolve(path.dirname(file), specifier);
          const fromSrc = path.relative(SRC, target);
          expect(fromSrc.startsWith('..'), `${file} imports ${specifier}`).toBe(false);
          const owner = fromSrc.split(path.sep)[0];
          if (owner === subpath) continue;
          expect(MAY_IMPORT[subpath], `${file} imports ${specifier}`).toContain(owner);
          expect(fromSrc, `${file} must import the entry of ${owner}`).toBe(
            path.join(owner, 'index'),
          );
        }
      }
    },
  );
});
