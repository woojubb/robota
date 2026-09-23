import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { classifyHarnessTestFiles } from '../harness-test-tiers.mjs';
import { groupContractTestsByOwner, ownerForRepositoryInput } from '../contract-test-owners.mjs';
import {
  CONTRACT_CONTROL_PLANE_INPUTS,
  CONTRACT_SAFETY_FLOOR,
  createContractTestRegistry,
  validateContractInputProjection,
  validateContractTestRegistry,
} from '../contract-test-inputs.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

function expectUncertainInput(entry, expected) {
  const uncertain = validateContractInputProjection(entry);
  const input = uncertain.find(
    (candidate) =>
      candidate.source === expected.source &&
      candidate.kind === expected.kind &&
      candidate.expression === expected.expression,
  );
  expect(input).toMatchObject(expected);
  expect(input.referenceId).toEqual(expect.any(String));
  expect(
    readFileSync(path.join(REPO_ROOT, input.source), 'utf8').slice(
      input.span.start,
      input.span.end,
    ),
  ).toBe(input.expression);
  expect(entry.always).toBe(true);
  expect(entry.cacheable).toBe(false);
  expect(entry.alwaysReason).toMatch(/unresolved repository input/);
}

describe('contract-test input registry ownership', () => {
  it('registers agent-definition file and directory consumers without owning other Claude inputs', () => {
    const consumers = [
      'review-before-push',
      'check-agent-def-convention',
      'scan-retired-agent-references',
    ];
    const registry = createContractTestRegistry(
      REPO_ROOT,
      consumers.map((name) => `scripts/harness/__tests__/${name}.test.mjs`),
    );
    const byTest = new Map(registry.map((entry) => [entry.test, entry]));
    expect(ownerForRepositoryInput(REPO_ROOT, '.claude/agents/pr-review-fixer.md')).toBe(
      'workspace:governance',
    );
    expect(ownerForRepositoryInput(REPO_ROOT, '.claude/agents')).toBe('workspace:governance');
    expect(ownerForRepositoryInput(REPO_ROOT, '.claude/settings.json')).toBeNull();
    expect(ownerForRepositoryInput(REPO_ROOT, '.claude/agents-backup/worker.md')).toBeNull();
    // These readers use helper parameters, not statically resolved literal paths. Their
    // exact read/list evidence must survive, without inventing a resolved directory glob.
    for (const [name, source, kind, expression] of [
      [
        'review-before-push',
        'scripts/harness/__tests__/review-before-push.test.mjs',
        'read-content',
        'path.join(WORKSPACE_ROOT, rel)',
      ],
      [
        'check-agent-def-convention',
        'scripts/harness/check-agent-def-convention.mjs',
        'list-names',
        'agentsDir',
      ],
      [
        'scan-retired-agent-references',
        'scripts/harness/scan-retired-agent-references.mjs',
        'list-names',
        'absolute',
      ],
    ]) {
      expectUncertainInput(byTest.get(`scripts/harness/__tests__/${name}.test.mjs`), {
        source,
        kind,
        expression,
        reason: 'nonliteral-reference',
      });
    }
  });

  it('registers the complete live contract tier and gives every safety-floor test a reason', () => {
    const tiers = classifyHarnessTestFiles(REPO_ROOT);
    const registry = createContractTestRegistry(REPO_ROOT, tiers.contract);

    // Compare identity without asking the assertion formatter to traverse every AST reference.
    expect(validateContractTestRegistry(REPO_ROOT, tiers.contract, registry) === registry).toBe(
      true,
    );
    expect(registry.map(({ test }) => test).sort()).toEqual(tiers.contract);
    expect(registry.every(({ primaryOwner }) => typeof primaryOwner === 'string')).toBe(true);
    expect(registry.every(({ broadSourceDomains }) => broadSourceDomains.length === 0)).toBe(true);
    const grouped = groupContractTestsByOwner(registry);
    expect(grouped.flatMap(({ tests }) => tests).sort()).toEqual(tiers.contract);
    expect(grouped.reduce((total, { tests }) => total + tests.length, 0)).toBe(
      tiers.contract.length,
    );
    const alwaysEntries = registry.filter(({ always }) => always);
    expect(alwaysEntries).toEqual(
      expect.arrayContaining(
        CONTRACT_SAFETY_FLOOR.map(({ test, reason }) =>
          expect.objectContaining({ test, always: true, alwaysReason: reason }),
        ),
      ),
    );
    const safetyTests = new Set(CONTRACT_SAFETY_FLOOR.map(({ test }) => test));
    expect(
      alwaysEntries
        .filter(({ test }) => !safetyTests.has(test))
        .every(({ alwaysReason }) => /unresolved repository input/.test(alwaysReason)),
    ).toBe(true);

    const byTest = new Map(registry.map((entry) => [entry.test, entry]));
    expect(byTest.get('scripts/harness/__tests__/harness-smoke.test.mjs')).toMatchObject({
      cacheable: true,
      uncertainInputs: [],
    });
    expect(CONTRACT_CONTROL_PLANE_INPUTS).toEqual(
      expect.arrayContaining([
        '.agents/harness.config.json',
        'pnpm-workspace.yaml',
        'scripts/harness/affected-contract-tests.mjs',
        'scripts/harness/contract-change-resolution.mjs',
        'scripts/harness/contract-input-matching.mjs',
        'scripts/harness/contract-selection-plan.mjs',
        'scripts/harness/contract-test-cache.mjs',
        'scripts/harness/contract-test-inputs.mjs',
        'scripts/harness/contract-test-owners.mjs',
        'scripts/harness/contract-test-sharding.mjs',
        'scripts/harness/harness-contract-execution.mjs',
        'scripts/harness/harness-test-classification.mjs',
        'scripts/harness/harness-test-tiers.mjs',
        'scripts/harness/harness-vitest-process.mjs',
      ]),
    );
  });

  it.each(['cacheable', 'uncertainInputs', 'reason'])(
    'rejects loss of unresolved input evidence: %s',
    (field) => {
      const [entry] = createContractTestRegistry(REPO_ROOT, [
        'scripts/harness/__tests__/review-before-push.test.mjs',
      ]);
      const changed = structuredClone(entry);
      if (field === 'cacheable') changed.cacheable = true;
      if (field === 'uncertainInputs') changed.uncertainInputs = [];
      if (field === 'reason') {
        changed.references.find((ref) => ref.resolution.status === 'unresolved').resolution.reason =
          '';
      }
      expect(() => validateContractInputProjection(changed)).toThrow(
        /invalid contract (input|reference)/,
      );
    },
  );
});
