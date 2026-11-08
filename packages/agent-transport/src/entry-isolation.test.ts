import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SRC = path.dirname(fileURLToPath(import.meta.url));
const CARRIERS = ['ws', 'http', 'mcp', 'acp', 'webrtc', 'link'] as const;

function sourceFilesUnder(directory: string, skip: readonly string[] = []): string[] {
  return readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .filter(
      (entry) => entry.endsWith('.ts') && !skip.some((name) => entry.split(path.sep)[0] === name),
    )
    .map((entry) => path.join(directory, entry));
}

function specifiersOf(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
}

function resolvedRelative(file: string, specifier: string): string {
  return path.resolve(path.dirname(file), specifier);
}

describe('agent-transport entry isolation', () => {
  it.each(CARRIERS)(
    '%s imports no other carrier, no sibling transport package and not its own package by name',
    (carrier) => {
      const own = path.join(SRC, carrier);
      for (const file of sourceFilesUnder(own)) {
        for (const specifier of specifiersOf(file)) {
          expect(
            /^@robota-sdk\/agent-transport(?:-|\/|$)/.test(specifier),
            `${file} imports ${specifier}`,
          ).toBe(false);
          if (!specifier.startsWith('.')) continue;
          const target = resolvedRelative(file, specifier);
          for (const other of CARRIERS) {
            if (other === carrier) continue;
            expect(
              path.relative(path.join(SRC, other), target).startsWith('..'),
              `${file} imports ${specifier}`,
            ).toBe(true);
          }
        }
      }
    },
  );

  it('the root, client and node entries import no carrier', () => {
    for (const file of sourceFilesUnder(SRC, [...CARRIERS])) {
      for (const specifier of specifiersOf(file)) {
        if (!specifier.startsWith('.')) continue;
        const target = resolvedRelative(file, specifier);
        for (const carrier of CARRIERS) {
          expect(
            path.relative(path.join(SRC, carrier), target).startsWith('..'),
            `${file} imports ${specifier}`,
          ).toBe(true);
        }
      }
    }
  });
});
