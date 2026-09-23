import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';
import { classifyHarnessTestFiles } from '../harness-test-tiers.mjs';
import { createAffectedContractPlan } from '../contract-selection-plan.mjs';
import { createContractTestRegistry } from '../contract-test-inputs.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

it('selects an explicitly resolved content consumer across owner boundaries', () => {
  const root = makeTemp('robota-projected-selection-');
  const test = 'scripts/harness/__tests__/consumer.test.mjs';
  const data = 'packages/data/fixture.json';
  const files = [test, data, 'packages/data/package.json', 'packages/runner/package.json'];
  for (const file of files) mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(
    path.join(root, test),
    "import {readFileSync} from 'node:fs'; readFileSync(new URL('../../../packages/data/fixture.json', import.meta.url));",
  );
  writeFileSync(path.join(root, data), '{}');
  writeFileSync(path.join(root, 'packages/data/package.json'), '{"name":"@fixture/data"}');
  writeFileSync(path.join(root, 'packages/runner/package.json'), '{"name":"@fixture/runner"}');
  const registry = createContractTestRegistry(root, [test], {
    files: new Set(files),
    packages: [],
  });
  // The execution owner is explicit; data ownership must not suppress the resolved dependency.
  const entry = { ...registry[0], primaryOwner: 'package:runner' };
  const plan = createAffectedContractPlan({
    root,
    contractTests: [test],
    registry: [entry],
    changedFiles: [data],
  });
  expect(plan.mode).toBe('affected');
  expect(plan.selected).toEqual([test]);
  entry.references = entry.references.map((reference) =>
    reference.kind === 'read-content'
      ? {
          ...reference,
          kind: 'list-names',
          resolution: { ...reference.resolution, targets: ['packages/data'] },
        }
      : reference,
  );
  entry.projectedInputs = entry.projectedInputs.map((input) =>
    input.targetOrPattern === data
      ? { ...input, targetOrPattern: 'packages/data/*', sensitivity: 'name-set' }
      : input,
  );
  entry.repositoryInputs = ['packages/data/*'];
  const addedDirectory = createAffectedContractPlan({
    root,
    contractTests: [test],
    registry: [entry],
    changedFiles: ['packages/data/new-directory/file.json'],
  });
  expect(addedDirectory.mode).toBe('affected');
  expect(addedDirectory.selected).toEqual([test]);
});

it('selects an audited dynamic governance consumer for its real rule input', () => {
  const contractTests = classifyHarnessTestFiles(REPO_ROOT).contract;
  const registry = createContractTestRegistry(REPO_ROOT, contractTests);
  const plan = createAffectedContractPlan({
    root: REPO_ROOT,
    contractTests,
    registry,
    changedFiles: ['.agents/rules/git-branch.md'],
  });

  expect(plan.mode).toBe('affected');
  expect(plan.selected).toContain(
    'scripts/harness/__tests__/integration-migration-owner-documents.test.mjs',
  );
});

it('selects the architecture contract for a dynamically read agent definition', () => {
  const contractTests = classifyHarnessTestFiles(REPO_ROOT).contract;
  const registry = createContractTestRegistry(REPO_ROOT, contractTests);
  const target = 'scripts/harness/__tests__/architecture-refresh-contracts.test.mjs';
  const entry = registry.find(({ test }) => test === target);
  const plan = createAffectedContractPlan({
    root: REPO_ROOT,
    contractTests,
    registry,
    changedFiles: ['.claude/agents/architecture-structure-auditor.md'],
  });

  expect(entry).toMatchObject({ always: false, cacheable: false });
  expect(entry.uncertaintyDispositions).toEqual([
    expect.objectContaining({
      referenceId: entry.uncertainInputs[0].referenceId,
      kind: 'dynamic-input',
      projectedInputs: expect.arrayContaining([
        expect.objectContaining({
          targetOrPattern: '.claude/agents/architecture-structure-auditor.md',
        }),
      ]),
    }),
  ]);
  expect(plan.mode).toBe('affected');
  expect(plan.selected).toContain(target);

  expect(() =>
    createAffectedContractPlan({
      root: REPO_ROOT,
      contractTests,
      registry: registry.map((candidate) =>
        candidate.test === target ? { ...candidate, uncertaintyDispositions: [] } : candidate,
      ),
      changedFiles: ['.claude/agents/architecture-structure-auditor.md'],
    }),
  ).not.toThrow();
  const fallback = createAffectedContractPlan({
    root: REPO_ROOT,
    contractTests,
    registry: registry.map((candidate) =>
      candidate.test === target ? { ...candidate, uncertaintyDispositions: [] } : candidate,
    ),
    changedFiles: ['.claude/agents/architecture-structure-auditor.md'],
  });
  expect(fallback.mode).toBe('complete');
  expect(fallback.reason).toMatch(/invalid registry/);
});
