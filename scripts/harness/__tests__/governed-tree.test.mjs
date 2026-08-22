/**
 * HARNESS-052 — the shared fail-closed helper 27 finders now call.
 *
 * Its own failure modes matter more than most: a helper that silently accepted an empty requirement
 * list, or that only checked the FIRST path, would hand every caller the vacuous pass they adopted it
 * to escape. Both are pinned below.
 */

import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { requireGovernedTree } from '../governed-tree.mjs';

const CONTEXT = { scan: 'fixture-scan', why: 'The fixture tree is the subject.' };

async function rootWith(dirs) {
  const root = makeTemp('robota-governed-tree-');
  for (const dir of dirs) mkdirSync(path.join(root, dir), { recursive: true });
  return root;
}

describe('requireGovernedTree', () => {
  it('returns quietly when every required path exists', async () => {
    const root = await rootWith(['packages', 'apps']);
    expect(() => requireGovernedTree(root, ['packages', 'apps'], CONTEXT)).not.toThrow();
  });

  it('throws when the single required path is missing', async () => {
    const root = await rootWith([]);
    expect(() => requireGovernedTree(root, 'packages', CONTEXT)).toThrow(/packages missing from/);
  });

  it('throws when ANY of several required paths is missing, and names it', async () => {
    const root = await rootWith(['packages']);
    expect(() => requireGovernedTree(root, ['packages', 'apps'], CONTEXT)).toThrow(/apps/);
  });

  it('names the scan, the root and the reason, so the failure is actionable', async () => {
    const root = await rootWith([]);
    let message = '';
    try {
      requireGovernedTree(root, ['.agents/tasks'], CONTEXT);
    } catch (error) {
      message = error.message;
    }
    expect(message).toContain('fixture-scan');
    expect(message).toContain('.agents/tasks');
    expect(message).toContain(root);
    expect(message).toContain('The fixture tree is the subject.');
  });

  /**
   * The helper's own vacuity: `[].filter(...)` is empty, so an empty requirement list would return
   * quietly and every caller would believe it had been checked.
   */
  it('refuses an empty requirement list rather than passing it', async () => {
    const root = await rootWith(['packages']);
    expect(() => requireGovernedTree(root, [], CONTEXT)).toThrow(/no paths/);
  });
});
