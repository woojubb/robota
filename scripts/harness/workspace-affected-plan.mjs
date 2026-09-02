import { normalizeWorkspacePath, resolveChangedFiles } from './workspace-affected-git.mjs';
import { createWorkspaceReachability, readWorkspaceGraph } from './workspace-graph.mjs';
import { selectPackagesForOperation } from './workspace-operation-selection.mjs';
import {
  globalPlan,
  isGlobalPath,
  isNoPackagePath,
  isOwned,
  noPackagePlan,
  packageRows,
  WORKSPACE_OPERATIONS,
} from './workspace-plan-shapes.mjs';
import { hasLiteralWorkspaceReference } from './workspace-source-dependencies.mjs';

function validateGraph(graph) {
  if (!graph || !Array.isArray(graph.packages) || graph.packages.length === 0) {
    throw new Error('workspace graph is empty');
  }
  const packages = [...graph.packages].sort((a, b) => a.directory.localeCompare(b.directory));
  const byName = new Map();
  for (const workspacePackage of packages) {
    if (
      !workspacePackage?.name ||
      !workspacePackage?.directory ||
      byName.has(workspacePackage.name)
    ) {
      throw new Error('workspace graph contains an invalid or duplicate package');
    }
    byName.set(workspacePackage.name, workspacePackage);
  }
  for (const workspacePackage of packages) {
    for (const dependency of workspacePackage.dependencies ?? []) {
      if (!byName.has(dependency)) throw new Error(`unknown workspace dependency: ${dependency}`);
    }
  }
  return { packages, byName };
}

function resolveOwners(files, packages, reasons) {
  const ownerNames = new Set();
  const unknown = [];
  for (const file of files) {
    const owners = packages.filter((workspacePackage) => isOwned(file, workspacePackage));
    if (owners.length > 1) return { failure: `ambiguous package owner for ${file}` };
    if (owners.length === 1) {
      const name = owners[0].name;
      ownerNames.add(name);
      if (!reasons.has(name)) reasons.set(name, new Set());
      reasons.get(name).add(`owner:${file}`);
    } else if (!isNoPackagePath(file)) {
      unknown.push(file);
    }
  }
  if (unknown.length > 0) return { failure: `unknown changed path: ${unknown.join(', ')}` };
  return { ownerNames };
}

/** Create a deterministic, package-distributable plan or explicit global/no-package result. */
export function createWorkspaceAffectedPlan({
  root,
  operation,
  changedFiles,
  mergeBases = [],
  graph,
  integrationOwners = {},
  typecheckIntegrationOwners = {},
  candidateReferenceResolver = hasLiteralWorkspaceReference,
  full = false,
}) {
  if (!WORKSPACE_OPERATIONS.includes(operation)) {
    return globalPlan({
      operation,
      changedFiles: changedFiles ?? [],
      reason: `unknown operation: ${operation}`,
    });
  }
  const files = [
    ...new Set((changedFiles ?? []).map(normalizeWorkspacePath).filter(Boolean)),
  ].sort();
  if (full)
    return globalPlan({
      operation,
      changedFiles: files,
      mergeBases,
      reason: 'full mode requested',
    });
  if (files.length === 0) {
    return globalPlan({
      operation,
      changedFiles: [],
      mergeBases,
      reason: 'changed-file set is empty',
    });
  }
  if (files.some(isGlobalPath)) {
    const triggers = files.filter(isGlobalPath);
    return globalPlan({
      operation,
      changedFiles: files,
      mergeBases,
      reason: `workspace-wide input changed: ${triggers.join(', ')}`,
    });
  }

  let packages;
  let byName;
  try {
    ({ packages, byName } = validateGraph(graph ?? readWorkspaceGraph(root)));
  } catch (error) {
    return globalPlan({
      operation,
      changedFiles: files,
      mergeBases,
      reason: `workspace graph is unreadable: ${error.message}`,
    });
  }

  const reasons = new Map();
  const ownerResolution = resolveOwners(files, packages, reasons);
  if (ownerResolution.failure) {
    return globalPlan({
      operation,
      changedFiles: files,
      mergeBases,
      reason: ownerResolution.failure,
    });
  }
  const { ownerNames } = ownerResolution;
  if (ownerNames.size === 0) {
    return noPackagePlan({
      operation,
      changedFiles: files,
      mergeBases,
      reason: 'recognized documentation/governance changes affect no workspace package',
    });
  }

  let dependencies;
  let dependents;
  try {
    ({ dependencies, dependents } = createWorkspaceReachability(packages, operation));
  } catch (error) {
    return globalPlan({
      operation,
      changedFiles: files,
      mergeBases,
      reason: `workspace graph is unreadable: ${error.message}`,
    });
  }
  const selection = selectPackagesForOperation({
    root,
    operation,
    ownerNames,
    dependencies,
    dependents,
    byName,
    reasons,
    integrationOwners,
    typecheckIntegrationOwners,
    candidateReferenceResolver,
  });
  if (selection.failure) {
    return globalPlan({ operation, changedFiles: files, mergeBases, reason: selection.failure });
  }
  const { selectedNames, dependencyNames, dependentNames } = selection;
  if (selectedNames.size === 0) {
    if (operation === 'examples-typecheck') {
      return noPackagePlan({
        operation,
        changedFiles: files,
        mergeBases,
        reason: 'no changed workspace package is an example owner',
        owners: packageRows(ownerNames, byName, reasons),
      });
    }
    return globalPlan({
      operation,
      changedFiles: files,
      mergeBases,
      reason: 'source changes selected zero packages; using full verification',
    });
  }
  return {
    version: 1,
    operation,
    mode: 'packages',
    packageDistributable: true,
    globalFallback: false,
    reason: 'workspace packages selected',
    changedFiles: files,
    mergeBases: [...mergeBases].sort(),
    owners: packageRows(ownerNames, byName, reasons),
    dependencyClosure: packageRows(dependencyNames, byName, reasons),
    dependentClosure: packageRows(dependentNames, byName, reasons),
    packages: packageRows(selectedNames, byName, reasons),
  };
}

/** Resolve the diff and graph, converting every read failure into a global fallback plan. */
export function planWorkspaceAffected({
  root = process.cwd(),
  operation,
  changedFiles,
  baseRef,
  headRef = 'HEAD',
  runGit,
  environment,
  integrationOwners,
  typecheckIntegrationOwners,
  candidateReferenceResolver,
  full = false,
}) {
  if (full) {
    return createWorkspaceAffectedPlan({
      root,
      operation,
      changedFiles: changedFiles ?? [],
      integrationOwners,
      typecheckIntegrationOwners,
      candidateReferenceResolver,
      full: true,
    });
  }
  const resolution =
    changedFiles !== undefined
      ? { ok: true, files: changedFiles, mergeBases: [] }
      : resolveChangedFiles({ root, baseRef, headRef, runGit, environment });
  if (!resolution.ok) {
    return globalPlan({
      operation,
      changedFiles: resolution.files ?? [],
      reason: `changed files are unreadable: ${resolution.reason}`,
    });
  }
  return createWorkspaceAffectedPlan({
    root,
    operation,
    changedFiles: resolution.files,
    mergeBases: resolution.mergeBases,
    integrationOwners,
    typecheckIntegrationOwners,
    candidateReferenceResolver,
  });
}
