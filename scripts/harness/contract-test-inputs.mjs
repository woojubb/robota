import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { collectFiles } from './enumerate-files.mjs';
import { extractSourceReferences } from './workspace-source-dependencies.mjs';
import { resolveSourceReference } from './workspace-source-reference-resolution.mjs';
import { isRepositoryPath } from './workspace-source-config-resolution.mjs';

import {
  contractInputDomains,
  inferContractTestPrimaryOwner,
  validateContractPrimaryOwnerDirectory,
} from './contract-test-owners.mjs';

const TEST_ROOT = 'scripts/harness/__tests__/';

/** Inputs that change contract selection, execution, or cache validity for every contract test. */
export const CONTRACT_CONTROL_PLANE_INPUTS = Object.freeze([
  '.agents/harness.config.json',
  '.github/workflows/**',
  '.npmrc',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'vitest.config.ts',
  'vitest.shared.ts',
  'scripts/harness/affected-contract-tests.mjs',
  'scripts/harness/canonical-temporary-directory.mjs',
  'scripts/harness/contract-test-cache.mjs',
  'scripts/harness/contract-change-resolution.mjs',
  'scripts/harness/contract-input-matching.mjs',
  'scripts/harness/contract-test-inputs.mjs',
  'scripts/harness/contract-test-owners.mjs',
  'scripts/harness/contract-selection-plan.mjs',
  'scripts/harness/contract-test-sharding.mjs',
  'scripts/harness/harness-contract-execution.mjs',
  'scripts/harness/harness-test-classification.mjs',
  'scripts/harness/harness-vitest-process.mjs',
  'scripts/harness/workspace-source-dependencies.mjs',
  'scripts/harness/workspace-source-reference-extraction.mjs',
  'scripts/harness/workspace-source-reference-resolution.mjs',
  'scripts/harness/workspace-source-config-resolution.mjs',
  'scripts/harness/lib/ts-ast.mjs',
  'scripts/harness/harness-test-tiers.mjs',
  'scripts/harness/shared.mjs',
]);

/** Fast, cheap contract smoke tests that still run when only ordinary product source changed. */
export const CONTRACT_SAFETY_FLOOR = Object.freeze([
  Object.freeze({
    test: `${TEST_ROOT}affected-contract-tests.test.mjs`,
    reason: 'guards the selector, registry completeness, fallback, and shard contracts',
  }),
  Object.freeze({
    test: `${TEST_ROOT}harness-test-tiers.test.mjs`,
    reason: 'guards the complete hermetic/contract partition and isolated-test boundary',
  }),
]);

/**
 * Audited dynamic reads whose variable path cannot be recovered from a single call expression.
 * Every group names the exact unresolved reference evidence it covers. Unmatched uncertainty is
 * never treated as permission to skip: its owning entry becomes always-run below.
 */
const CONTRACT_UNCERTAINTY_DISPOSITIONS = Object.freeze({
  [`${TEST_ROOT}agents-cannot-be-told-to-dispatch.test.mjs`]: Object.freeze([
    Object.freeze({
      kind: 'dynamic-input',
      reason: 'the test enumerates and reads every registered agent definition',
      inputs: Object.freeze([
        Object.freeze({ targetOrPattern: '.claude/agents/*', sensitivity: 'content' }),
      ]),
      references: Object.freeze([
        Object.freeze({
          source: `${TEST_ROOT}agents-cannot-be-told-to-dispatch.test.mjs`,
          kind: 'list-names',
          expression: 'AGENTS_DIR',
        }),
        Object.freeze({
          source: `${TEST_ROOT}agents-cannot-be-told-to-dispatch.test.mjs`,
          kind: 'read-content',
          expression: 'path.join(AGENTS_DIR, name)',
        }),
      ]),
    }),
  ]),
  [`${TEST_ROOT}architecture-refresh-contracts.test.mjs`]: Object.freeze([
    Object.freeze({
      kind: 'dynamic-input',
      reason: 'the shared read helper consumes the named architecture agents and routing owners',
      inputs: Object.freeze(
        [
          '.claude/agents/architecture-design-auditor.md',
          '.claude/agents/architecture-gate-auditor.md',
          '.claude/agents/architecture-runtime-auditor.md',
          '.claude/agents/architecture-structure-auditor.md',
          '.agents/skills/architecture-audit-fanout/SKILL.md',
          '.agents/skills/architecture-refresh/SKILL.md',
          '.agents/specs/orchestration-map.md',
        ].map((targetOrPattern) => Object.freeze({ targetOrPattern, sensitivity: 'content' })),
      ),
      references: Object.freeze([
        Object.freeze({
          source: `${TEST_ROOT}architecture-refresh-contracts.test.mjs`,
          kind: 'read-content',
          expression: 'path.join(ROOT, relative)',
        }),
      ]),
    }),
  ]),
  [`${TEST_ROOT}integration-migration-owner-documents.test.mjs`]: Object.freeze([
    Object.freeze({
      kind: 'dynamic-input',
      reason: 'the recursive policy-owner sweep reads every rule and skill Markdown file',
      inputs: Object.freeze([
        Object.freeze({ targetOrPattern: '.agents/rules/**', sensitivity: 'content' }),
        Object.freeze({ targetOrPattern: '.agents/skills/**', sensitivity: 'content' }),
      ]),
      references: Object.freeze([
        Object.freeze({
          source: `${TEST_ROOT}integration-migration-owner-documents.test.mjs`,
          kind: 'list-names',
          expression: 'dir',
        }),
        Object.freeze({
          source: `${TEST_ROOT}integration-migration-owner-documents.test.mjs`,
          kind: 'read-content',
          expression: 'file',
        }),
      ]),
    }),
  ]),
});

const normalize = (value) =>
  String(value ?? '')
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\.\//u, '')
    .replace(/^\//u, '');

function regularInput(root, file) {
  if (!isRepositoryPath(file)) return false;
  const parts = file.split('/');
  for (let index = 1; index <= parts.length; index += 1) {
    const stat = lstatSync(path.join(root, ...parts.slice(0, index)), { throwIfNoEntry: false });
    if (!stat || stat.isSymbolicLink()) return false;
    if (index === parts.length && !stat.isFile()) return false;
  }
  return true;
}

function referenceContext(root, options) {
  // Integration may supply the existing graph's packages and regular-file inventory. The
  // Delegate tracked + untracked names to their existing owner.
  const names = options.files ?? collectFiles([], { cwd: root, includeUntracked: true });
  const files = new Set([...names].filter((file) => regularInput(root, file)));
  const readFile = (file) => {
    if (!files.has(file) || !regularInput(root, file))
      throw new Error(`not a regular contract input: ${file}`);
    return options.readFile ? options.readFile(file) : readFileSync(path.join(root, file), 'utf8');
  };
  return { cwd: '.', ...options, files, readFile };
}

function collectContractInputs(testFile, context) {
  const pending = [normalize(testFile)];
  const visited = new Set();
  const references = [];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    if (!context.files.has(current))
      throw new Error(`contract registry input does not exist: ${current}`);
    visited.add(current);
    for (const extracted of extractSourceReferences(context.readFile(current), current)) {
      const resolved = resolveSourceReference(extracted, context);
      const reference = {
        ...resolved,
        id: `${current}:${extracted.span.start}:${extracted.span.end}:${extracted.kind}`,
      };
      references.push(reference);
      if (reference.kind === 'module' || reference.kind === 'execute') {
        pending.push(...(reference.resolution.targets ?? []));
      }
    }
  }
  return { implementationInputs: [...visited].sort(), references };
}

function matchesUncertainReference(reference, expected) {
  return (
    reference.source === expected.source &&
    reference.kind === expected.kind &&
    reference.expression === expected.expression
  );
}

function uncertaintyDispositions(test, uncertainInputs) {
  const dispositions = [];
  const claimed = new Set();
  for (const declaration of CONTRACT_UNCERTAINTY_DISPOSITIONS[test] ?? []) {
    const matches = uncertainInputs.filter((reference) =>
      declaration.references.some((expected) => matchesUncertainReference(reference, expected)),
    );
    if (matches.length === 0) {
      throw new Error(`stale contract uncertainty disposition: ${test}`);
    }
    for (const reference of matches) {
      if (claimed.has(reference.referenceId)) {
        throw new Error(`duplicate contract uncertainty disposition: ${reference.referenceId}`);
      }
      claimed.add(reference.referenceId);
      dispositions.push({
        referenceId: reference.referenceId,
        kind: declaration.kind,
        reason: declaration.reason,
        projectedInputs: declaration.inputs ?? [],
      });
    }
  }
  return dispositions.sort((left, right) => left.referenceId.localeCompare(right.referenceId));
}

/** Resolve one test's typed reference evidence and executable import closure. */
export function resolveContractTestInputs(root, testFile, options = {}) {
  const result = collectContractInputs(testFile, referenceContext(root, options));
  const uncertainInputs = validateContractReferenceEvidence(result.references);
  return { ...result, uncertainInputs };
}

export function validateContractReferenceEvidence(references) {
  if (!Array.isArray(references)) throw new Error('invalid contract reference evidence');
  const uncertainInputs = [];
  for (const reference of references) {
    if (
      !reference ||
      !['module', 'execute', 'read-content', 'list-names', 'config'].includes(reference.kind) ||
      !isRepositoryPath(reference.source) ||
      !Number.isInteger(reference.span?.start) ||
      !Number.isInteger(reference.span?.end) ||
      reference.span.start < 0 ||
      reference.span.end < reference.span.start ||
      !['resolved', 'unresolved', 'external', 'builtin'].includes(reference.resolution?.status) ||
      (reference.resolution.status === 'unresolved' &&
        (typeof reference.id !== 'string' ||
          reference.id.trim() === '' ||
          typeof reference.expression !== 'string' ||
          reference.expression.trim() === '' ||
          typeof reference.resolution.reason !== 'string' ||
          reference.resolution.reason.trim() === '' ||
          (reference.resolution.targets !== undefined &&
            (!Array.isArray(reference.resolution.targets) ||
              reference.resolution.targets.length > 0)))) ||
      (reference.resolution.status === 'resolved' &&
        (!Array.isArray(reference.resolution.targets) ||
          reference.resolution.targets.length === 0 ||
          reference.resolution.targets.some((file) => !isRepositoryPath(file)))) ||
      (reference.resolution.evidenceInputs !== undefined &&
        (!Array.isArray(reference.resolution.evidenceInputs) ||
          reference.resolution.evidenceInputs.some((file) => !isRepositoryPath(file))))
    ) {
      throw new Error('invalid contract reference evidence');
    }
    if (reference.resolution.status === 'unresolved') {
      uncertainInputs.push({
        referenceId: reference.id,
        source: reference.source,
        span: reference.span,
        kind: reference.kind,
        expression: reference.expression,
        reason: reference.resolution.reason,
      });
    }
  }
  return uncertainInputs;
}

/** Shared entry-level check for selector/cache; no registry enumeration or owner discovery. */
export function validateContractInputProjection(entry) {
  if (entry.references === undefined) {
    if (entry.projectedInputs !== undefined)
      throw new Error(`contract input projection lacks reference evidence: ${entry.test}`);
    return [];
  }
  const uncertainInputs = validateContractReferenceEvidence(entry.references);
  const dispositions = uncertaintyDispositions(entry.test, uncertainInputs);
  if (JSON.stringify(entry.uncertaintyDispositions) !== JSON.stringify(dispositions)) {
    throw new Error(`invalid contract uncertainty disposition: ${entry.test}`);
  }
  const disposed = new Set(dispositions.map(({ referenceId }) => referenceId));
  const undisposed = uncertainInputs.filter(({ referenceId }) => !disposed.has(referenceId));
  const safetyReason = CONTRACT_SAFETY_FLOOR.find(({ test }) => test === entry.test)?.reason;
  const expectedAlwaysReason =
    safetyReason ??
    (undisposed.length > 0
      ? `${undisposed.length} unresolved repository input(s) lack an explicit disposition`
      : null);
  if (
    (uncertainInputs.length > 0 && entry.cacheable !== false) ||
    ((uncertainInputs.length > 0 || entry.uncertainInputs !== undefined) &&
      JSON.stringify(entry.uncertainInputs) !== JSON.stringify(uncertainInputs)) ||
    entry.always !== (expectedAlwaysReason !== null) ||
    entry.alwaysReason !== expectedAlwaysReason
  ) {
    throw new Error(`invalid contract input uncertainty policy: ${entry.test}`);
  }
  const expected = projectReferences(entry.test, entry.references, dispositions);
  if (
    JSON.stringify(entry.projectedInputs) !== JSON.stringify(expected) ||
    JSON.stringify(entry.implementationInputs) !== JSON.stringify(projectedPaths(expected, true)) ||
    JSON.stringify(entry.repositoryInputs) !== JSON.stringify(projectedPaths(expected, false))
  ) {
    throw new Error(`invalid contract input projection: ${entry.test}`);
  }
  return uncertainInputs;
}

function projectReferences(test, references, uncertaintyDispositions = []) {
  const inputs = new Map();
  const add = (targetOrPattern, sensitivity, referenceId) => {
    if (!isRepositoryPath(targetOrPattern))
      throw new Error(`invalid projected contract input: ${targetOrPattern}`);
    targetOrPattern = normalize(targetOrPattern);
    const key = `${sensitivity}:${targetOrPattern}`;
    const input = inputs.get(key) ?? { targetOrPattern, sensitivity, referenceIds: [] };
    if (referenceId !== undefined && !input.referenceIds.includes(referenceId))
      input.referenceIds.push(referenceId);
    inputs.set(key, input);
  };
  add(test, 'execution');
  for (const disposition of uncertaintyDispositions) {
    for (const input of disposition.projectedInputs) {
      add(input.targetOrPattern, input.sensitivity, disposition.referenceId);
    }
  }
  for (const reference of references) {
    const sensitivity = ['module', 'execute'].includes(reference.kind)
      ? 'execution'
      : reference.kind === 'list-names'
        ? 'name-set'
        : 'content';
    for (const file of reference.resolution.evidenceInputs ?? [])
      add(file, 'content', reference.id);
    for (const target of reference.resolution.targets ?? []) {
      add(
        reference.kind === 'list-names' ? `${target.replace(/\/$/u, '')}/*` : target,
        sensitivity,
        reference.id,
      );
    }
  }
  return [...inputs.values()].sort(
    (a, b) =>
      a.targetOrPattern.localeCompare(b.targetOrPattern) ||
      a.sensitivity.localeCompare(b.sensitivity),
  );
}

function projectedPaths(inputs, execution) {
  return [
    ...new Set(
      inputs
        .filter((input) => (input.sensitivity === 'execution') === execution)
        .map((input) => input.targetOrPattern),
    ),
  ].sort();
}
/**
 * Derive registry inputs from the shared reference evidence, not quoted path literals.
 * options supplies the existing graph's packages, regular files, readFile and (when known) cwd.
 * Well-formed unresolved evidence makes only its entry always-run and noncacheable.
 * projectedInputs is shared with selection/cache integration:
 * execution traverses the closure, content hashes bytes, name-set hashes matching names only.
 */
export function createContractTestRegistry(root, contractTests, options = {}) {
  const tests = [...contractTests].map(normalize).sort();
  if (tests.length === 0) throw new Error('contract registry requires at least one contract test');
  if (new Set(tests).size !== tests.length) {
    throw new Error('contract registry cannot contain duplicate contract tests');
  }
  const safetyFloor = new Map(
    CONTRACT_SAFETY_FLOOR.filter(({ test }) => tests.includes(test)).map(({ test, reason }) => [
      test,
      reason,
    ]),
  );
  const context = referenceContext(root, options);
  return tests.map((test) => {
    if (!test.startsWith(TEST_ROOT) || !test.endsWith('.test.mjs')) {
      throw new Error(`invalid contract test path: ${test}`);
    }
    const { implementationInputs, references } = collectContractInputs(test, context);
    const uncertainInputs = validateContractReferenceEvidence(references);
    const dispositions = uncertaintyDispositions(test, uncertainInputs);
    const disposed = new Set(dispositions.map(({ referenceId }) => referenceId));
    const undisposed = uncertainInputs.filter(({ referenceId }) => !disposed.has(referenceId));
    const safetyReason = safetyFloor.get(test);
    const alwaysReason =
      safetyReason ??
      (undisposed.length > 0
        ? `${undisposed.length} unresolved repository input(s) lack an explicit disposition`
        : null);
    const always = alwaysReason !== null;
    const projectedInputs = projectReferences(test, references, dispositions);
    const repositoryInputs = projectedPaths(projectedInputs, false);
    return Object.freeze({
      test,
      always,
      alwaysReason,
      cacheable: !always && uncertainInputs.length === 0,
      uncertainInputs: Object.freeze(uncertainInputs),
      uncertaintyDispositions: Object.freeze(dispositions),
      implementationInputs: Object.freeze(implementationInputs),
      repositoryInputs: Object.freeze(repositoryInputs),
      references: Object.freeze(references),
      projectedInputs: Object.freeze(projectedInputs),
      // Deliberately empty unless a contract is manually audited as owning every source file in
      // a domain. Autogenerated `packages/**`-style literals describe structure, not source.
      broadSourceDomains: Object.freeze([]),
      inputDomains: contractInputDomains(root, repositoryInputs),
      primaryOwner: inferContractTestPrimaryOwner(root, {
        implementationInputs,
        repositoryInputs,
      }),
    });
  });
}

/** Validate exact registry coverage and reject stale, duplicated, or malformed metadata. */
export function validateContractTestRegistry(root, contractTests, registry) {
  const expected = [...contractTests].map(normalize).sort();
  if (!Array.isArray(registry)) throw new Error('contract registry must be an array');
  const actual = registry.map((entry) => normalize(entry?.test));
  if (actual.some((test) => !test) || new Set(actual).size !== actual.length) {
    throw new Error('contract registry contains a missing or duplicate test');
  }
  const missing = expected.filter((test) => !actual.includes(test));
  const extra = actual.filter((test) => !expected.includes(test));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `contract registry coverage mismatch (missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'})`,
    );
  }
  for (const entry of registry) {
    validateContractInputProjection(entry);
    if (
      typeof entry.always !== 'boolean' ||
      !Array.isArray(entry.implementationInputs) ||
      !Array.isArray(entry.repositoryInputs) ||
      !Array.isArray(entry.broadSourceDomains) ||
      !Array.isArray(entry.inputDomains) ||
      typeof entry.primaryOwner !== 'string'
    ) {
      throw new Error(`invalid contract registry metadata: ${entry.test}`);
    }
    validateContractPrimaryOwnerDirectory(root, entry.primaryOwner, entry.test);
    const expectedDomains = contractInputDomains(root, entry.repositoryInputs);
    if (JSON.stringify(entry.inputDomains) !== JSON.stringify(expectedDomains)) {
      throw new Error(`invalid contract registry input domains: ${entry.test}`);
    }
    const broadDomains = [...entry.broadSourceDomains].sort();
    if (
      broadDomains.length !== entry.broadSourceDomains.length ||
      new Set(broadDomains).size !== broadDomains.length ||
      broadDomains.some(
        (domain) =>
          !['apps', 'examples', 'packages'].includes(domain) ||
          !entry.repositoryInputs.includes(`${domain}/**`),
      )
    ) {
      throw new Error(`invalid explicit broad-source ownership: ${entry.test}`);
    }
    if (!existsSync(path.join(root, entry.test))) {
      throw new Error(`registered contract test does not exist: ${entry.test}`);
    }
    if (
      (entry.always &&
        (typeof entry.alwaysReason !== 'string' || entry.alwaysReason.trim().length === 0)) ||
      (!entry.always && entry.alwaysReason !== null)
    ) {
      throw new Error(`invalid contract registry always-run reason: ${entry.test}`);
    }
    const inputs = [...entry.implementationInputs, ...entry.repositoryInputs];
    if (inputs.some((input) => typeof input !== 'string' || normalize(input) !== input)) {
      throw new Error(`invalid contract registry input: ${entry.test}`);
    }
    if (
      new Set(entry.implementationInputs).size !== entry.implementationInputs.length ||
      new Set(entry.repositoryInputs).size !== entry.repositoryInputs.length
    ) {
      throw new Error(`duplicate contract registry input: ${entry.test}`);
    }
    if (!entry.implementationInputs.includes(entry.test)) {
      throw new Error(`contract registry closure omits its test: ${entry.test}`);
    }
    for (const input of entry.implementationInputs) {
      if (!existsSync(path.join(root, input))) {
        throw new Error(`contract registry implementation input does not exist: ${input}`);
      }
    }
  }
  return registry;
}
