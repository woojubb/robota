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
  'scripts/harness/contract-test-inputs.mjs',
  'scripts/harness/contract-test-owners.mjs',
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
  // compatibility entry point delegates tracked + untracked names to their existing owner.
  const names = options.files ?? collectFiles([], { cwd: root, includeUntracked: true });
  const files = new Set([...names].filter((file) => regularInput(root, file)));
  const readFile = (file) => {
    if (!files.has(file) || !regularInput(root, file))
      throw new Error(`not a regular contract input: ${file}`);
    return options.readFile ? options.readFile(file) : readFileSync(path.join(root, file), 'utf8');
  };
  return { ...options, files, readFile };
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

/** Compatibility view of the shared-reference module/execution closure, including the test. */
export function relativeImportClosure(root, testFile, options = {}) {
  const result = collectContractInputs(testFile, referenceContext(root, options));
  const uncertainInputs = validateContractReferenceEvidence(result.references);
  // This legacy array cannot carry uncertainty; never present a partial closure as complete.
  if (uncertainInputs.length > 0) throw new Error(uncertaintyReason(uncertainInputs));
  return result.implementationInputs;
}

function uncertaintyReason(uncertainInputs) {
  return uncertainInputs
    .map(
      ({ source, span, kind, expression, reason }) =>
        `unresolved contract input ${source}:${span.start} (${kind} ${expression}): ${reason}`,
    )
    .join('; ');
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
  const floorReason = CONTRACT_SAFETY_FLOOR.find(({ test }) => test === entry.test)?.reason;
  if (
    (uncertainInputs.length > 0 &&
      (entry.always !== true ||
        entry.cacheable !== false ||
        entry.alwaysReason !== (floorReason ?? uncertaintyReason(uncertainInputs)))) ||
    ((uncertainInputs.length > 0 || entry.uncertainInputs !== undefined) &&
      JSON.stringify(entry.uncertainInputs) !== JSON.stringify(uncertainInputs))
  ) {
    throw new Error(`invalid contract input uncertainty policy: ${entry.test}`);
  }
  const expected = projectReferences(entry.test, entry.references);
  if (
    JSON.stringify(entry.projectedInputs) !== JSON.stringify(expected) ||
    JSON.stringify(entry.implementationInputs) !== JSON.stringify(projectedPaths(expected, true)) ||
    JSON.stringify(entry.repositoryInputs) !== JSON.stringify(projectedPaths(expected, false))
  ) {
    throw new Error(`invalid contract input projection: ${entry.test}`);
  }
  return uncertainInputs;
}

function projectReferences(test, references) {
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
    const always = safetyFloor.has(test) || uncertainInputs.length > 0;
    const projectedInputs = projectReferences(test, references);
    const repositoryInputs = projectedPaths(projectedInputs, false);
    return Object.freeze({
      test,
      always,
      alwaysReason: safetyFloor.get(test) ?? (always ? uncertaintyReason(uncertainInputs) : null),
      cacheable: !always,
      uncertainInputs: Object.freeze(uncertainInputs),
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
