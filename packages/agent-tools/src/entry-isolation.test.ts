import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SRC = path.dirname(fileURLToPath(import.meta.url));
const DEFAULTS = path.join(SRC, 'defaults');
const MAIN_ENTRY = path.join(SRC, 'index.ts');
const NODE_ENTRY = path.join(SRC, 'node.ts');

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

function reachableFrom(entry: string): Set<string> {
  const reached = new Set<string>();
  const pending = [entry];
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

function isUnder(directory: string, file: string): boolean {
  return !path.relative(directory, file).startsWith('..');
}

describe('agent-tools entry isolation', () => {
  it.each([
    ['the main entry', MAIN_ENTRY],
    ['the node entry', NODE_ENTRY],
  ])('%s reaches nothing under defaults', (_name, entry) => {
    const reached = [...reachableFrom(entry)].filter((file) => isUnder(DEFAULTS, file));
    expect(reached).toEqual([]);
  });

  it('defaults reaches the rest of the package only through its main and node entries', () => {
    const sources = readdirSync(DEFAULTS, { recursive: true, encoding: 'utf8' })
      .filter((entry) => entry.endsWith('.ts'))
      .map((entry) => path.join(DEFAULTS, entry));
    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      for (const specifier of specifiersOf(file)) {
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(/^@robota-sdk\/agent-tools/);
        if (!specifier.startsWith('.')) continue;
        const target = resolveRelative(file, specifier);
        expect(target, `${file} imports ${specifier}`).toBeDefined();
        const allowed =
          [MAIN_ENTRY, NODE_ENTRY].includes(target ?? '') || isUnder(DEFAULTS, target ?? '');
        expect(allowed, `${file} imports ${specifier}`).toBe(true);
      }
    }
  });
});
