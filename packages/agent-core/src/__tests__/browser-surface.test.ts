import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '../..');
const SOURCE_ROOT = path.join(PACKAGE_ROOT, 'src');
const EXCLUDED = new Set(['__tests__', 'node_modules', 'testing']);

function browserReachableSources(directory: string, files: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED.has(entry.name)) browserReachableSources(fullPath, files);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('agent-core browser source surface', () => {
  it('does not statically import node:crypto', () => {
    const files = browserReachableSources(SOURCE_ROOT);
    expect(files.length, 'no browser-reachable source files were inspected').toBeGreaterThan(50);
    const offenders = files
      .filter((file) => /from\s+['"]node:crypto['"]/u.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(PACKAGE_ROOT, file));

    expect(
      offenders,
      'Use the platform-neutral randomId() helper; a node:crypto import reaches the browser bundle.',
    ).toEqual([]);
  });
});
