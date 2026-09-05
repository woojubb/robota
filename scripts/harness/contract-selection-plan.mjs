import path from 'node:path';

import {
  CONTRACT_CONTROL_PLANE_INPUTS,
  createContractTestRegistry,
  validateContractTestRegistry,
} from './contract-test-inputs.mjs';
import {
  matchesContractRepositoryInput,
  matchesInput,
  normalizeContractPath,
} from './contract-input-matching.mjs';
import {
  groupContractTestsByOwner,
  ownerForRepositoryInput,
  selectionScopesForChangedPath,
} from './contract-test-owners.mjs';
import {
  createDeterministicShards,
  estimateContractTestWeights,
} from './contract-test-sharding.mjs';

const PRODUCT_SOURCE_PREFIXES = ['apps/', 'examples/', 'packages/'];
const isProductSource = (file) => PRODUCT_SOURCE_PREFIXES.some((prefix) => file.startsWith(prefix));
const isControlPlane = (file) =>
  CONTRACT_CONTROL_PLANE_INPUTS.some((input) => matchesInput(file, input));

// Hook files are governance inputs even though the legacy owner registry predates `.claude/hooks/`.
// Keep the mapping at selection time so changing a hook does not conservatively expand every
// contract test while the registry's control-plane contract remains unchanged.
const selectionOwnerForPath = (root, file) =>
  file.startsWith('.claude/hooks/') ? 'workspace:governance' : ownerForRepositoryInput(root, file);

const hasSelectionOwner = (root, file) =>
  file.startsWith('.claude/hooks/') || Boolean(selectionScopesForChangedPath(root, file));

function completeFallback({
  root,
  contractTests,
  isolatedContract,
  reason,
  registry,
  measuredDurations,
}) {
  const isolated = new Set(isolatedContract);
  const ordinary = contractTests.filter((file) => !isolated.has(file));
  const weights = estimateContractTestWeights({
    root,
    files: ordinary,
    registry,
    measuredDurations,
  });
  const selected = [...contractTests].sort();
  let ownerGroups;
  try {
    ownerGroups = groupContractTestsByOwner(Array.isArray(registry) ? registry : [], selected);
    if (ownerGroups.length === 0) throw new Error('owner groups are empty');
  } catch {
    ownerGroups = [Object.freeze({ owner: 'harness', tests: Object.freeze([...selected]) })];
  }
  return {
    mode: 'complete',
    reason,
    selected,
    shards: createDeterministicShards(ordinary, 4, weights),
    isolated: contractTests.filter((file) => isolated.has(file)).sort(),
    ownerGroups,
    selectedByOwner: ownerGroups,
  };
}

function fallback(context, reason) {
  return completeFallback({ ...context, reason });
}

/** Build an affected or complete execution plan. Any ambiguity expands coverage. */
export function createAffectedContractPlan({
  root,
  contractTests,
  isolatedContract = [],
  changedFiles,
  registry,
  measuredDurations,
}) {
  const contracts = [...contractTests].map(normalizeContractPath).sort();
  let entries;
  try {
    entries = registry ?? createContractTestRegistry(root, contracts);
    validateContractTestRegistry(root, contracts, entries);
  } catch (error) {
    return completeFallback({
      root,
      contractTests: contracts,
      isolatedContract,
      reason: `invalid registry: ${error.message}`,
      registry: entries ?? registry,
      measuredDurations,
    });
  }
  const context = {
    root,
    contractTests: contracts,
    isolatedContract,
    registry: entries,
    measuredDurations,
  };
  const changed = [
    ...new Set((changedFiles ?? []).map(normalizeContractPath).filter(Boolean)),
  ].sort();
  if (changed.length === 0) return fallback(context, 'changed-file input was missing or empty');
  if (changed.some((file) => file.startsWith('../') || path.isAbsolute(file))) {
    return fallback(context, 'changed-file input escaped the repository');
  }

  const byTest = new Map(entries.map((entry) => [entry.test, entry]));
  const selected = new Set(entries.filter((entry) => entry.always).map((entry) => entry.test));
  const recognized = new Set();
  for (const file of changed) {
    if (isControlPlane(file)) return fallback(context, `control-plane input changed: ${file}`);
    if (byTest.has(file)) {
      selected.add(file);
      recognized.add(file);
    }
    if (!hasSelectionOwner(root, file))
      return fallback(context, `unknown owner for changed input: ${file}`);
    recognized.add(file);
    const changedPrimaryOwner = selectionOwnerForPath(root, file);
    let dependencyMatched = byTest.has(file);
    for (const entry of entries) {
      const implementationMatch = entry.implementationInputs.includes(file);
      const sameSpecificOwner =
        /^(?:package|app|example):/u.test(entry.primaryOwner) &&
        entry.primaryOwner === changedPrimaryOwner;
      const globalInputMatch =
        (entry.primaryOwner === 'harness' || entry.primaryOwner.startsWith('workspace:')) &&
        entry.repositoryInputs.some((input) => matchesContractRepositoryInput(entry, file, input));
      if (implementationMatch || sameSpecificOwner || globalInputMatch) {
        selected.add(entry.test);
        recognized.add(file);
        dependencyMatched = true;
      }
    }
    if (changedPrimaryOwner === 'harness' && !dependencyMatched) {
      return fallback(context, `unmatched harness implementation changed: ${file}`);
    }
    if (isProductSource(file)) recognized.add(file);
  }

  const unknown = changed.filter((file) => !recognized.has(file));
  if (unknown.length > 0) return fallback(context, `unknown input changed: ${unknown[0]}`);
  if (selected.size === 0) return fallback(context, 'affected selection contained zero tests');

  const isolated = new Set(isolatedContract);
  const selectedFiles = [...selected].sort();
  const ownerGroups = groupContractTestsByOwner(entries);
  return {
    mode: 'affected',
    reason: `${selectedFiles.length} of ${contracts.length} contract tests selected`,
    selected: selectedFiles,
    shards: [selectedFiles.filter((file) => !isolated.has(file))],
    isolated: selectedFiles.filter((file) => isolated.has(file)),
    ownerGroups,
    selectedByOwner: groupContractTestsByOwner(entries, selectedFiles),
  };
}
