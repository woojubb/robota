export const WORKSPACE_OPERATIONS = Object.freeze([
  'build',
  'consumer-build',
  'test',
  'typecheck',
  'lint',
  'examples-typecheck',
]);

const GLOBAL_FILES = new Set([
  '.eslintignore',
  '.eslintrc.json',
  '.npmrc',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
  'tsconfig.eslint.json',
  'tsconfig.json',
  'vitest.config.ts',
  'vitest.shared.ts',
]);
const GLOBAL_PREFIXES = [
  '.github/workflows/',
  'scripts/build-',
  'scripts/harness/workspace-affected',
  'scripts/harness/workspace-graph.',
  'scripts/harness/workspace-plan-',
  'scripts/harness/workspace-source-',
];
const NO_PACKAGE_FILES = new Set([
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'README.md',
  'SECURITY.md',
]);
const NO_PACKAGE_PREFIXES = ['.agents/', '.changeset/', 'docs/'];

export function isGlobalPath(file) {
  return GLOBAL_FILES.has(file) || GLOBAL_PREFIXES.some((prefix) => file.startsWith(prefix));
}

export function isNoPackagePath(file) {
  return (
    NO_PACKAGE_FILES.has(file) || NO_PACKAGE_PREFIXES.some((prefix) => file.startsWith(prefix))
  );
}

export function isOwned(file, workspacePackage) {
  return file === workspacePackage.directory || file.startsWith(`${workspacePackage.directory}/`);
}

export function globalPlan({ operation, changedFiles, reason, mergeBases = [] }) {
  return {
    version: 1,
    operation,
    mode: 'global',
    packageDistributable: false,
    globalFallback: true,
    reason,
    changedFiles: [...changedFiles].sort(),
    mergeBases: [...mergeBases].sort(),
    owners: [],
    dependencyClosure: [],
    dependentClosure: [],
    packages: [],
  };
}

export function noPackagePlan({ operation, changedFiles, mergeBases, reason, owners = [] }) {
  return {
    version: 1,
    operation,
    mode: 'none',
    packageDistributable: true,
    globalFallback: false,
    reason,
    changedFiles,
    mergeBases: [...mergeBases].sort(),
    owners,
    dependencyClosure: [],
    dependentClosure: [],
    packages: [],
  };
}

export function packageRows(names, byName, reasons) {
  return [...names]
    .map((name) => ({
      name,
      directory: byName.get(name).directory,
      reasons: [...(reasons.get(name) ?? [])].sort(),
    }))
    .sort((left, right) => left.directory.localeCompare(right.directory));
}

export function addReason(reasons, name, reason) {
  if (!reasons.has(name)) reasons.set(name, new Set());
  reasons.get(name).add(reason);
}

export function transitiveClosure(startNames, adjacency) {
  const found = new Set();
  const queue = [...startNames].sort();
  while (queue.length > 0) {
    const current = queue.shift();
    for (const next of adjacency.get(current) ?? []) {
      if (startNames.has(next) || found.has(next)) continue;
      found.add(next);
      queue.push(next);
      queue.sort();
    }
  }
  return found;
}
