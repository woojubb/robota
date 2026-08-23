/**
 * CMD-004 Phase 2 (TC-06) — the workspace-wide grep floor.
 *
 * After Stage E no production source may reference the deleted legacy command-effect contract:
 * no `*-tui-requested` name, no `TCommandEffect`, and no `effects:` / `effects?:` property key
 * (`rg -n "tui-requested|TCommandEffect|\beffects\??:"` over every `packages/<pkg>/src` tree —
 * test files excluded). This test IS that floor, run mechanically on every CI pass so the
 * renderer-coupled effect contract cannot regrow.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const FLOOR_PATTERN = /tui-requested|TCommandEffect|\beffects\??:/;

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const PACKAGES_ROOT = join(REPO_ROOT, 'packages');

const PRODUCTION_SOURCE = /\.(ts|tsx)$/;
const TEST_FILE = /\.(test|ptytest|bintest)\.(ts|tsx)$/;

function collectProductionSources(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      collectProductionSources(path, out);
    } else if (PRODUCTION_SOURCE.test(entry.name) && !TEST_FILE.test(entry.name)) {
      out.push(path);
    }
  }
}

describe('CMD-004 TC-06 — legacy command-effect grep floor (production sources)', () => {
  it('no packages/*/src production file references tui-requested / TCommandEffect / effects keys', () => {
    const files: string[] = [];
    for (const pkg of readdirSync(PACKAGES_ROOT, { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue;
      try {
        collectProductionSources(join(PACKAGES_ROOT, pkg.name, 'src'), files);
      } catch {
        continue; // allow-fallback: a package without a src/ tree has nothing to scan
      }
    }
    expect(files.length).toBeGreaterThan(100); // sanity: the walk actually saw the workspace

    const violations: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, 'utf-8').split('\n');
      lines.forEach((line, i) => {
        if (FLOOR_PATTERN.test(line)) {
          violations.push(`${relative(REPO_ROOT, file)}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(violations).toEqual([]);
  });
});
