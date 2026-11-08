import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SRC = path.dirname(fileURLToPath(import.meta.url));
const SUBPATHS = ['capability-pack', 'preset', 'command', 'coding'] as const;
type TSubpath = (typeof SUBPATHS)[number];

const entry = (relative: string): string => path.join(SRC, relative);

// The entry files a subpath may reach in another subpath: exactly the edges its former package
// declared. Everything else a subpath owns is private to it.
const ALLOWED_EDGES: Record<TSubpath | 'root', readonly string[]> = {
  root: [entry('capability-pack/index.ts'), entry('preset/index.ts')],
  'capability-pack': [],
  preset: [],
  command: [entry('preset/index.ts')],
  coding: [entry('capability-pack/index.ts'), entry('command/index.ts'), entry('command/node.ts')],
};

// Node-only entries; a platform-neutral entry reaches none of them.
const NODE_ONLY = [entry('preset/node.ts'), entry('command/node.ts')];
const NEUTRAL_ENTRIES = [
  entry('index.ts'),
  entry('capability-pack/index.ts'),
  entry('preset/index.ts'),
  entry('command/index.ts'),
];

// Statements only: a doc comment that quotes an import line is not an import.
const IMPORT_PATTERN =
  /^(?:import|export)\s[^'";]*?from\s*['"]([^'"]+)['"]|^import\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/gm;

function specifiersOf(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(IMPORT_PATTERN)].map((match) => match[1] ?? match[2] ?? match[3]);
}

function resolveRelative(from: string, specifier: string): string | undefined {
  const base = path.resolve(path.dirname(from), specifier.replace(/\.js$/, ''));
  return [`${base}.ts`, path.join(base, 'index.ts')].find((candidate) => existsSync(candidate));
}

function sourcesUnder(directory: string, skip: readonly string[] = []): string[] {
  return readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .filter((name) => /\.tsx?$/.test(name) && !skip.includes(name.split(path.sep)[0]))
    .map((name) => path.join(directory, name));
}

function ownerOf(file: string): TSubpath | 'root' {
  const first = path.relative(SRC, file).split(path.sep)[0];
  return (SUBPATHS as readonly string[]).includes(first) ? (first as TSubpath) : 'root';
}

function reachableFrom(start: string): Set<string> {
  const reached = new Set<string>();
  const pending = [start];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (reached.has(file)) continue;
    reached.add(file);
    for (const specifier of specifiersOf(file)) {
      const target = specifier.startsWith('.') ? resolveRelative(file, specifier) : undefined;
      if (target !== undefined) pending.push(target);
    }
  }
  return reached;
}

describe('agent-product entry isolation', () => {
  it.each([...SUBPATHS, 'root'] as const)(
    '%s reaches another subpath only through the entries its former package imported',
    (owner) => {
      const files = sourcesUnder(SRC, owner === 'root' ? [...SUBPATHS] : []).filter(
        (file) => ownerOf(file) === owner,
      );
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) {
        for (const specifier of specifiersOf(file)) {
          expect(
            /^@robota-sdk\/(agent-capability-pack|agent-preset|agent-command|pack-coding|agent-product)/.test(
              specifier,
            ),
            `${file} imports ${specifier}`,
          ).toBe(false);
          if (!specifier.startsWith('.')) continue;
          const target = resolveRelative(file, specifier);
          expect(target, `${file} imports ${specifier}`).toBeDefined();
          if (ownerOf(target ?? '') === owner) continue;
          expect(ALLOWED_EDGES[owner], `${file} imports ${specifier}`).toContain(target);
        }
      }
    },
  );

  it.each(NEUTRAL_ENTRIES.map((file) => [path.relative(SRC, file), file]))(
    'the neutral entry %s reaches no Node-only entry',
    (_name, start) => {
      const reached = [...reachableFrom(start)];
      expect(
        reached.filter((file) => NODE_ONLY.includes(file) || ownerOf(file) === 'coding'),
      ).toEqual([]);
    },
  );
});
