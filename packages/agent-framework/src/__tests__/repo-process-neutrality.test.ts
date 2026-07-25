/**
 * NEUT-001 — the published library must not serialize THIS repository's process.
 *
 * Red-first floor: no framework source file may embed Robota repo-process literals
 * (`pnpm harness:verify`, `origin/develop`, `pnpm --filter`). The repo-specific
 * command templates live in the unpublished `scripts/harness/` tier and are injected
 * by the composition root.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC_ROOT = join(__dirname, '..');

const FORBIDDEN_REPO_PROCESS_LITERALS: readonly RegExp[] = [
  /harness:verify/,
  /origin\/develop/,
  /pnpm --filter/,
];

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      files.push(...collectSourceFiles(full));
      continue;
    }
    if (entry.endsWith('.ts')) files.push(full);
  }
  return files;
}

describe('repo-process neutrality (NEUT-001)', () => {
  it('framework source carries no Robota repo-process literals', () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(SRC_ROOT)) {
      const content = readFileSync(file, 'utf8');
      for (const pattern of FORBIDDEN_REPO_PROCESS_LITERALS) {
        if (pattern.test(content)) {
          offenders.push(`${file}: ${pattern.source}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
