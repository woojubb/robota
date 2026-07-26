import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { findBaseHistoryFindings, listWorkflows } from '../scan-ci-base-history.mjs';
import { findAutomergePermissionFindings } from '../scan-automerge-disarm-permission.mjs';
import {
  classificationFindings,
  derivedFinders,
  findGuardScopeFindings,
  MANDATORY_TREE_GUARDS,
  measuredVacuous,
  PENDING_CLASSIFICATION,
  registeredScanFiles,
  rootFinderExports,
} from '../scan-guard-scope-fail-closed.mjs';
import { findNoFallbackFindings } from '../scan-no-fallback.mjs';
import { findFakeInSrc } from '../scan-no-fake-in-src.mjs';
import { findReviewWorkflowParityFindings, listGovernedWorkflows } from '../scan-review-workflow-parity.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');

const bareRoot = () => mkdtemp(path.join(tmpdir(), 'robota-guard-scope-'));

describe('derivation (the half that cannot be dodged by editing a table)', () => {
  it('reads the registration list from run-all-scans.mjs rather than a hand-list', () => {
    const files = registeredScanFiles(WORKSPACE_ROOT);
    expect(files).toContain('scan-ci-base-history.mjs');
    expect(files).toContain('scan-no-fallback.mjs');
    expect(files.length).toBeGreaterThan(50);
  });

  it('extracts only the find…(root = …) exports', () => {
    const source = [
      'export function findThings(root = X) {}',
      'export function findOther(text) {}',
      'function findPrivate(root = X) {}',
      'export function helper(root = X) {}',
    ].join('\n');
    expect(rootFinderExports(source)).toEqual(['findThings']);
  });

  it('classifies every derived finder exactly once', () => {
    expect(classificationFindings(WORKSPACE_ROOT)).toEqual([]);
  });

  it('reports a derived finder that no table classifies', () => {
    const declared = new Set(
      [...MANDATORY_TREE_GUARDS, ...PENDING_CLASSIFICATION].map((e) => `${e.file}#${e.finder}`),
    );
    for (const entry of derivedFinders(WORKSPACE_ROOT)) {
      expect(declared.has(`${entry.file}#${entry.finder}`)).toBe(true);
    }
  });

  it('keeps the vacuous ledger non-empty — an empty one would read as "all clear"', () => {
    expect(measuredVacuous().length).toBeGreaterThan(0);
  });
});

/**
 * The behavioural half, and the regression fixtures for the five guards this item repaired. Each of
 * these returned an EMPTY finding list — i.e. reported a pass — when handed a root without its
 * governed tree, measured on 2026-07-26. A revert of any repair fails the matching case here.
 */
describe('the repaired guards fail closed on an absent governed tree', () => {
  it('listWorkflows throws instead of returning []', async () => {
    const root = await bareRoot();
    expect(() => listWorkflows(root)).toThrow(/does not exist/);
  });

  it('listGovernedWorkflows throws instead of returning []', async () => {
    const root = await bareRoot();
    expect(() => listGovernedWorkflows(root)).toThrow(/does not exist/);
  });

  it.each([
    ['findBaseHistoryFindings', findBaseHistoryFindings],
    ['findAutomergePermissionFindings', findAutomergePermissionFindings],
    ['findReviewWorkflowParityFindings', findReviewWorkflowParityFindings],
    ['findNoFallbackFindings', findNoFallbackFindings],
    ['findFakeInSrc', findFakeInSrc],
  ])('%s does not report a pass over a tree it never read', async (_name, finder) => {
    const root = await bareRoot();
    let threw = false;
    let result;
    try {
      result = finder(root);
    } catch {
      threw = true;
    }
    if (threw) return;
    const list = Array.isArray(result) ? result : (result?.findings ?? []);
    expect(list.length).toBeGreaterThan(0);
  });

  /**
   * The parity scan's anti-rot half: a workflows directory that exists but in which nothing invokes
   * the governed action is an empty subject, not a clean one. Before the repair this returned no
   * findings and `main()` printed "nothing to guard" and exited 0 — the scan whose whole subject is
   * an action that exits 0 having reviewed nothing, doing exactly that.
   */
  it('parity reports an empty governed set as a finding', async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const root = await bareRoot();
    mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
    writeFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'name: ci\njobs: {}\n', 'utf8');
    const { findings, checked } = findReviewWorkflowParityFindings(root);
    expect(checked).toEqual([]);
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toMatch(/governs an empty set/);
  });
});

describe('the scan as a whole', () => {
  it('is green on this repository', async () => {
    expect(await findGuardScopeFindings(WORKSPACE_ROOT)).toEqual([]);
  });
});
