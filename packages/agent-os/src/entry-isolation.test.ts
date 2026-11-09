import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SRC = path.dirname(fileURLToPath(import.meta.url));
const PRIMITIVES = ['file-authority', 'node-lock', 'process'] as const;

function sourceFilesOf(primitive: string): string[] {
  return readdirSync(path.join(SRC, primitive), { recursive: true, encoding: 'utf8' })
    .filter((entry) => entry.endsWith('.ts'))
    .map((entry) => path.join(SRC, primitive, entry));
}

function specifiersOf(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
}

describe('agent-os primitive isolation', () => {
  it.each(PRIMITIVES)(
    '%s imports no other primitive and no other package of this repository',
    (primitive) => {
      for (const file of sourceFilesOf(primitive)) {
        for (const specifier of specifiersOf(file)) {
          expect(specifier.startsWith('@robota-sdk/'), `${file} imports ${specifier}`).toBe(false);
          if (specifier.startsWith('.')) {
            const target = path.resolve(path.dirname(file), specifier);
            expect(
              path.relative(path.join(SRC, primitive), target).startsWith('..'),
              `${file} imports ${specifier}`,
            ).toBe(false);
          }
        }
      }
    },
  );

  it('process loads no native binding', () => {
    for (const file of sourceFilesOf('process')) {
      expect(specifiersOf(file), file).not.toContain('koffi');
    }
  });
});
