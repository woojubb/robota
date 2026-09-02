import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import * as affectedFacade from '../affected-contract-tests.mjs';
import * as changeResolution from '../contract-change-resolution.mjs';
import * as inputMatching from '../contract-input-matching.mjs';
import * as selectionPlan from '../contract-selection-plan.mjs';
import * as sharding from '../contract-test-sharding.mjs';
import * as tierFacade from '../harness-test-tiers.mjs';
import * as contractExecution from '../harness-contract-execution.mjs';
import * as classification from '../harness-test-classification.mjs';
import * as vitestProcess from '../harness-vitest-process.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const MODULES = [
  'scripts/harness/affected-contract-tests.mjs',
  'scripts/harness/contract-change-resolution.mjs',
  'scripts/harness/contract-input-matching.mjs',
  'scripts/harness/contract-selection-plan.mjs',
  'scripts/harness/contract-test-sharding.mjs',
  'scripts/harness/harness-contract-execution.mjs',
  'scripts/harness/harness-hermetic-runner.mjs',
  'scripts/harness/harness-test-classification.mjs',
  'scripts/harness/harness-test-tiers.mjs',
  'scripts/harness/harness-vitest-process.mjs',
];

describe('contract-test module boundaries', () => {
  it('keeps every facade and helper below the local 300-line maintainability limit', () => {
    for (const file of MODULES) {
      const lines = readFileSync(path.join(REPO_ROOT, file), 'utf8').split('\n').length;
      expect(lines, file).toBeLessThanOrEqual(300);
    }
  });

  it('preserves the affected-planning facade API identities', () => {
    expect(affectedFacade.parseNameStatusDiff).toBe(changeResolution.parseNameStatusDiff);
    expect(affectedFacade.resolveChangedContractInputs).toBe(
      changeResolution.resolveChangedContractInputs,
    );
    expect(affectedFacade.matchesInput).toBe(inputMatching.matchesInput);
    expect(affectedFacade.matchesContractRepositoryInput).toBe(
      inputMatching.matchesContractRepositoryInput,
    );
    expect(affectedFacade.createAffectedContractPlan).toBe(
      selectionPlan.createAffectedContractPlan,
    );
    expect(affectedFacade.createDeterministicShards).toBe(sharding.createDeterministicShards);
    expect(affectedFacade.estimateContractTestWeights).toBe(sharding.estimateContractTestWeights);
  });

  it('preserves the tier-runner facade API identities', () => {
    expect(tierFacade.classifyHarnessTestFiles).toBe(classification.classifyHarnessTestFiles);
    expect(tierFacade.testInvocationsForTier).toBe(classification.testInvocationsForTier);
    expect(tierFacade.vitestInvocation).toBe(vitestProcess.vitestInvocation);
    expect(tierFacade.vitestInvocationAsync).toBe(vitestProcess.vitestInvocationAsync);
    expect(tierFacade.harnessTestEnvironment).toBe(vitestProcess.harnessTestEnvironment);
    expect(tierFacade.worktreeFingerprint).toBe(contractExecution.worktreeFingerprint);
  });
});
