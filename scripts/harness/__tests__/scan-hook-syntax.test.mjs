import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { collectHookSyntaxFindings } from '../scan-hook-syntax.mjs';

/**
 * ACCEPTANCE CRITERION (written before the scan).
 *
 * A hook that no longer parses exits 127, and the hook protocol treats a non-2 exit as PASS. So a
 * single bad edit to a shared helper takes every guard that sources it offline, and every command
 * afterwards sails through with nothing to show that anything changed. Registration floors prove a
 * hook is WIRED; nothing proved it still PARSES.
 *
 * The scan FAILS when any shell file under `.claude/hooks/`, including `lib/`, does not parse.
 */

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const HOOKS_DIR = path.join(WORKSPACE_ROOT, '.claude/hooks');

function shellScripts(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...shellScripts(full));
    else if (name.endsWith('.sh')) out.push(full);
  }
  return out;
}

describe('scan-hook-syntax', () => {
  it('is registered in run-all-scans.mjs', () => {
    const runner = readFileSync(
      path.join(WORKSPACE_ROOT, 'scripts/harness/run-all-scans.mjs'),
      'utf8',
    );
    expect(runner).toContain('scan-hook-syntax.mjs');
  });

  it('passes on the live repository', () => {
    expect(collectHookSyntaxFindings()).toEqual([]);
  });

  it('examines something — a pass over nothing is not a pass', () => {
    expect(shellScripts(HOOKS_DIR).length).toBeGreaterThan(0);
  });

  it('covers lib/, which registration floors deliberately exclude', () => {
    // Helpers are not registered to events, so a registration scan cannot see them — and they are
    // sourced by several guards, which makes them the highest blast radius in the directory.
    const libDir = path.join(HOOKS_DIR, 'lib');
    if (!existsSync(libDir)) return;
    const covered = shellScripts(HOOKS_DIR).map((f) => path.relative(WORKSPACE_ROOT, f));
    const helpers = readdirSync(libDir).filter((n) => n.endsWith('.sh'));
    for (const helper of helpers) {
      expect(covered).toContain(path.join('.claude/hooks/lib', helper));
    }
  });
});
