import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

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

const ROOT_INPUTS = new Set(CONTRACT_CONTROL_PLANE_INPUTS.filter((input) => !input.includes('*')));

const REPOSITORY_PREFIXES = [
  '.agents/',
  '.github/',
  '.husky/',
  'apps/',
  'content/',
  'docs/',
  'examples/',
  'packages/',
  'scripts/',
];

const normalize = (value) =>
  String(value ?? '')
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\.\//u, '')
    .replace(/^\//u, '');

function literalModuleSpecifiers(source) {
  const imports = [];
  const declaration = /^\s*(?:import|export)\s+(?:[^;]*?\s+from\s+)?['"]([^'"]+)['"]\s*;?/gmu;
  for (const match of source.matchAll(declaration)) {
    if (match[1].startsWith('.')) imports.push(match[1]);
  }
  for (const match of source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu)) {
    if (match[1].startsWith('.')) imports.push(match[1]);
  }
  return imports;
}

function resolveRelativeModule(root, owner, specifier) {
  const unresolved = path.resolve(root, path.dirname(owner), specifier);
  const candidates = [
    unresolved,
    `${unresolved}.mjs`,
    `${unresolved}.js`,
    `${unresolved}.cjs`,
    path.join(unresolved, 'index.mjs'),
    path.join(unresolved, 'index.js'),
  ];
  if (unresolved.endsWith('.js')) candidates.push(`${unresolved.slice(0, -3)}.mjs`);
  const absolute = candidates.find((candidate) => existsSync(candidate));
  if (!absolute) return null;
  const relative = normalize(path.relative(root, absolute));
  return relative.startsWith('../') ? null : relative;
}

function literalExecutableDependencies(root, owner, source) {
  const dependencies = new Set();
  for (const match of source.matchAll(/['"]([^'"\n]+\.(?:[cm]?[jt]s))['"]/gu)) {
    const specifier = match[1];
    let dependency = specifier.startsWith('.')
      ? resolveRelativeModule(root, owner, specifier)
      : null;
    if (!dependency) {
      const candidate = normalize(
        specifier.startsWith('scripts/') ? specifier : `scripts/harness/${specifier}`,
      );
      if (existsSync(path.join(root, candidate))) dependency = candidate;
    }
    if (dependency) dependencies.add(dependency);
  }
  return dependencies;
}

/** Return a test's complete relative static-import closure, including the test itself. */
export function relativeImportClosure(root, testFile) {
  const pending = [normalize(testFile)];
  const visited = new Set();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    const absolute = path.join(root, current);
    if (!existsSync(absolute))
      throw new Error(`contract registry input does not exist: ${current}`);
    visited.add(current);
    const source = readFileSync(absolute, 'utf8');
    for (const specifier of literalModuleSpecifiers(source)) {
      const dependency = resolveRelativeModule(root, current, specifier);
      if (dependency && !visited.has(dependency)) pending.push(dependency);
    }
    for (const dependency of literalExecutableDependencies(root, current, source)) {
      if (!visited.has(dependency)) pending.push(dependency);
    }
  }
  return [...visited].sort();
}

function looksLikeRepositoryInput(value) {
  const normalized = normalize(value);
  return (
    ROOT_INPUTS.has(normalized) ||
    REPOSITORY_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  );
}

function repositoryInputsFromSources(root, implementationInputs) {
  const inputs = new Set();
  for (const file of implementationInputs) {
    const source = readFileSync(path.join(root, file), 'utf8');
    for (const match of source.matchAll(/['"`]([^'"`\n]+)['"`]/gu)) {
      const candidate = normalize(match[1]);
      if (!looksLikeRepositoryInput(candidate) || candidate.includes('${')) continue;
      inputs.add(candidate.endsWith('/') ? `${candidate}**` : candidate);
    }
  }
  return [...inputs].sort();
}

/**
 * Generate complete metadata from the classified contract tier. Explicit repository paths are
 * harvested from each test's static implementation closure; an empty list is represented, not
 * omitted, so newly added tests cannot silently fall outside registry validation.
 */
export function createContractTestRegistry(root, contractTests) {
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
  return tests.map((test) => {
    if (!test.startsWith(TEST_ROOT) || !test.endsWith('.test.mjs')) {
      throw new Error(`invalid contract test path: ${test}`);
    }
    const implementationInputs = relativeImportClosure(root, test);
    const repositoryInputs = repositoryInputsFromSources(root, implementationInputs);
    return Object.freeze({
      test,
      always: safetyFloor.has(test),
      alwaysReason: safetyFloor.get(test) ?? null,
      implementationInputs: Object.freeze(implementationInputs),
      repositoryInputs: Object.freeze(repositoryInputs),
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
