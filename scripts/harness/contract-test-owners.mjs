import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const OWNER_PATTERN =
  /^(?:package|app|example):[a-z0-9][a-z0-9._/-]*$|^workspace:[a-z0-9][a-z0-9._-]*$|^harness$/u;
const MONOREPO_DOMAINS = Object.freeze({
  packages: 'package',
  apps: 'app',
  examples: 'example',
});
const GLOBAL_INPUTS = new Set([
  '.npmrc',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'vitest.config.ts',
  'vitest.shared.ts',
]);
const WORKSPACE_UNIT_CACHE = new Map();

const normalize = (value) =>
  String(value ?? '')
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\.\//u, '')
    .replace(/^\//u, '');

function discoverWorkspaceUnits(root, domain) {
  const cacheKey = `${path.resolve(root)}\0${domain}`;
  if (WORKSPACE_UNIT_CACHE.has(cacheKey)) return WORKSPACE_UNIT_CACHE.get(cacheKey);
  const domainRoot = path.join(root, domain);
  if (!existsSync(domainRoot)) return [];
  const units = [];
  const visit = (directory, relative) => {
    if (existsSync(path.join(directory, 'package.json'))) units.push(relative);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name.startsWith('.')) {
        continue;
      }
      visit(path.join(directory, entry.name), relative ? `${relative}/${entry.name}` : entry.name);
    }
  };
  visit(domainRoot, '');
  const result = units
    .filter(Boolean)
    .sort((left, right) => right.length - left.length || left.localeCompare(right));
  WORKSPACE_UNIT_CACHE.set(cacheKey, result);
  return result;
}

function unitNameForPath(root, domain, remainder) {
  const clean = remainder.split(/[?*]/u, 1)[0].replace(/\/$/u, '');
  if (!clean || /^[?*]/u.test(remainder)) return null;
  const units = discoverWorkspaceUnits(root, domain);
  const matched = units.find((unit) => clean === unit || clean.startsWith(`${unit}/`));
  if (matched) return matched;
  if (units.length > 0) return null;
  const fallback = clean.split('/')[0];
  return /^[a-z0-9][a-z0-9._-]*$/u.test(fallback) ? fallback : null;
}

/** Validate one and only one stable primary owner. */
export function validateContractPrimaryOwner(primaryOwner, label = 'contract') {
  const normalized = normalize(primaryOwner);
  if (!normalized || normalized !== primaryOwner || !OWNER_PATTERN.test(normalized)) {
    throw new Error(`${label} requires exactly one valid primaryOwner`);
  }
  return normalized;
}

/** Ensure a specific primary owner names a real pnpm workspace directory. */
export function validateContractPrimaryOwnerDirectory(root, primaryOwner, label = 'contract') {
  const owner = validateContractPrimaryOwner(primaryOwner, label);
  const match = /^(package|app|example):(.+)$/u.exec(owner);
  if (!match) return owner;
  const domain = match[1] === 'package' ? 'packages' : `${match[1]}s`;
  if (!existsSync(path.join(root, domain, match[2], 'package.json'))) {
    throw new Error(`${label} names a non-workspace primaryOwner: ${owner}`);
  }
  return owner;
}

/** Convert one declared repository input to its narrowest auditable monorepo owner. */
export function ownerForRepositoryInput(root, input) {
  const normalized = normalize(input);
  const [domain, ...tail] = normalized.split('/');
  if (MONOREPO_DOMAINS[domain]) {
    const remainder = tail.join('/');
    if (!remainder || /^[?*]/u.test(remainder)) return `workspace:${domain}`;
    const unit = unitNameForPath(root, domain, remainder);
    return unit ? `${MONOREPO_DOMAINS[domain]}:${unit}` : null;
  }
  if (normalized.startsWith('docs/') || normalized === 'docs') return 'workspace:docs';
  if (normalized.startsWith('.github/workflows/')) return 'workspace:workflows';
  if (
    normalized.startsWith('.agents/') ||
    normalized.startsWith('.husky/') ||
    normalized === '.claude/agents' ||
    normalized.startsWith('.claude/agents/')
  ) {
    return 'workspace:governance';
  }
  if (normalized.startsWith('content/')) return 'workspace:content';
  if (normalized.startsWith('scripts/harness/')) return 'harness';
  if (normalized.startsWith('scripts/')) return 'workspace:scripts';
  if (GLOBAL_INPUTS.has(normalized)) return 'workspace:global';
  return null;
}

/** Preserve matching domains as non-execution metadata for audits and diagnostics. */
export function contractInputDomains(root, repositoryInputs = []) {
  const domains = new Set();
  for (const input of repositoryInputs) {
    const owner = ownerForRepositoryInput(root, input);
    if (owner) domains.add(owner);
  }
  return Object.freeze([...domains].sort());
}

/** Infer exactly one execution owner; ambiguous cross-domain contracts are root-global. */
export function inferContractTestPrimaryOwner(
  root,
  { implementationInputs = [], repositoryInputs = [] },
) {
  const domains = contractInputDomains(root, repositoryInputs);
  const meaningful = domains.filter((owner) => owner !== 'workspace:global');
  const specific = meaningful.filter((owner) => /^(?:package|app|example):/u.test(owner));
  const broad = meaningful.filter((owner) => owner.startsWith('workspace:'));

  if (specific.length === 1 && broad.length === 0) return specific[0];
  if (specific.length === 0 && broad.length === 1) return broad[0];
  if (meaningful.length === 0 && domains.includes('workspace:global')) return 'workspace:global';
  if (meaningful.length > 0) return 'workspace:global';
  if (implementationInputs.some((input) => normalize(input).startsWith('scripts/harness/'))) {
    return 'harness';
  }
  return 'harness';
}

/** Resolve one changed path to the owner scopes that are safe to execute for it. */
export function selectionScopesForChangedPath(root, file) {
  const normalized = normalize(file);
  const direct = ownerForRepositoryInput(root, normalized);
  if (!direct) return null;
  const owners = new Set([direct, 'workspace:global']);
  if (direct.startsWith('package:')) owners.add('workspace:packages');
  if (direct.startsWith('app:')) owners.add('workspace:apps');
  if (direct.startsWith('example:')) owners.add('workspace:examples');
  return [...owners].sort();
}

/** Deterministic, JSON-friendly grouping for Action logs and downstream scheduling. */
export function groupContractTestsByOwner(registry, selectedTests = undefined) {
  const selected = selectedTests ? new Set(selectedTests.map(normalize)) : null;
  const groups = new Map();
  for (const entry of [...registry].sort((left, right) => left.test.localeCompare(right.test))) {
    if (selected && !selected.has(normalize(entry.test))) continue;
    const owner = validateContractPrimaryOwner(entry.primaryOwner, entry.test);
    const tests = groups.get(owner) ?? [];
    tests.push(normalize(entry.test));
    groups.set(owner, tests);
  }
  return [...groups]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([owner, tests]) =>
      Object.freeze({ owner, tests: Object.freeze([...new Set(tests)].sort()) }),
    );
}
