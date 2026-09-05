import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { classifyHarnessTestFiles } from '../harness-test-tiers.mjs';
import { groupContractTestsByOwner, ownerForRepositoryInput } from '../contract-test-owners.mjs';
import {
  CONTRACT_CONTROL_PLANE_INPUTS,
  CONTRACT_SAFETY_FLOOR,
  createContractTestRegistry,
  validateContractTestRegistry,
} from '../contract-test-inputs.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

describe('contract-test input registry ownership', () => {
  it('registers agent-definition file and directory consumers without owning other Claude inputs', () => {
    const registry = createContractTestRegistry(
      REPO_ROOT,
      classifyHarnessTestFiles(REPO_ROOT).contract,
    );
    const byTest = new Map(registry.map((entry) => [entry.test, entry]));
    expect(ownerForRepositoryInput(REPO_ROOT, '.claude/agents/pr-review-fixer.md')).toBe(
      'workspace:governance',
    );
    expect(ownerForRepositoryInput(REPO_ROOT, '.claude/agents')).toBe('workspace:governance');
    expect(ownerForRepositoryInput(REPO_ROOT, '.claude/settings.json')).toBeNull();
    expect(ownerForRepositoryInput(REPO_ROOT, '.claude/agents-backup/worker.md')).toBeNull();
    expect(
      byTest.get('scripts/harness/__tests__/review-before-push.test.mjs').repositoryInputs,
    ).toContain('.claude/agents/pr-review-fixer.md');
    for (const name of [
      'check-agent-def-convention',
      'depth-verdict-reachable',
      'scan-retired-agent-references',
    ]) {
      expect(
        byTest.get(`scripts/harness/__tests__/${name}.test.mjs`).repositoryInputs,
        name,
      ).toContain('.claude/agents/**');
    }
  });

  it('registers the complete live contract tier and gives every safety-floor test a reason', () => {
    const tiers = classifyHarnessTestFiles(REPO_ROOT);
    const registry = createContractTestRegistry(REPO_ROOT, tiers.contract);

    expect(validateContractTestRegistry(REPO_ROOT, tiers.contract, registry)).toBe(registry);
    expect(registry.map(({ test }) => test).sort()).toEqual(tiers.contract);
    expect(registry.every(({ primaryOwner }) => typeof primaryOwner === 'string')).toBe(true);
    expect(registry.every(({ broadSourceDomains }) => broadSourceDomains.length === 0)).toBe(true);
    const grouped = groupContractTestsByOwner(registry);
    expect(grouped.flatMap(({ tests }) => tests).sort()).toEqual(tiers.contract);
    expect(grouped.reduce((total, { tests }) => total + tests.length, 0)).toBe(
      tiers.contract.length,
    );
    expect(registry.filter(({ always }) => always)).toEqual(
      expect.arrayContaining(
        CONTRACT_SAFETY_FLOOR.map(({ test, reason }) =>
          expect.objectContaining({ test, always: true, alwaysReason: reason }),
        ),
      ),
    );

    const byTest = new Map(registry.map((entry) => [entry.test, entry]));
    expect(
      byTest.get('scripts/harness/__tests__/work-run-git.test.mjs')?.implementationInputs,
    ).toContain('scripts/harness/work-run-git.mjs');
    expect(
      byTest.get('scripts/harness/__tests__/harness-smoke.test.mjs')?.implementationInputs,
    ).toEqual(
      expect.arrayContaining([
        'scripts/harness/audit-spec-coverage.mjs',
        'scripts/harness/check-dependency-direction.mjs',
        'scripts/harness/scan-consistency.mjs',
      ]),
    );
    expect(CONTRACT_CONTROL_PLANE_INPUTS).toEqual(
      expect.arrayContaining([
        '.agents/harness.config.json',
        'pnpm-workspace.yaml',
        'scripts/harness/affected-contract-tests.mjs',
        'scripts/harness/contract-test-cache.mjs',
        'scripts/harness/contract-test-inputs.mjs',
        'scripts/harness/contract-test-owners.mjs',
        'scripts/harness/harness-test-tiers.mjs',
      ]),
    );
  });
});
