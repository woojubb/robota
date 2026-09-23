#!/usr/bin/env node

/**
 * Single fail-closed owner for changed-path and capability classification. Both CI and Review Gate
 * consume this verdict so documentation detection cannot diverge between required checks.
 *
 * Usage: node scripts/harness/classify-changed-paths.mjs --base-ref origin/develop [--head HEAD]
 * The CLI prints classifications and mirrors them to `$GITHUB_OUTPUT` under Actions.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { appendFileSync } from 'node:fs';

import { resolveCapabilityReachability } from './changed-path-capabilities.mjs';
import { classifyPackageManifestChange, classifyRootManifestChange } from './shared.mjs';
import { changedManifestKeys } from './manifest-change-classification.mjs';
import { HERMETIC_TEST_FILES } from './harness-test-classification.mjs';

export { resolveCapabilityReachability } from './changed-path-capabilities.mjs';

/**
 * Paths that are pure documentation. Workflow callers consume this classifier; they do not own a
 * second path list.
 */
export const DOCS_ONLY_GLOBS = ['**/*.md', '**/*.mdx', 'docs/**', 'content/**'];

/** `DOCS_ONLY_GLOBS` as a matcher over repository-relative paths. */
export const DOCS_ONLY_PATTERN = /(\.mdx?$|^docs\/|^content\/)/;

/** Whether one repository-relative path is pure documentation. */
export function isDocsOnlyPath(file) {
  return DOCS_ONLY_PATTERN.test(String(file ?? ''));
}

// `.agents/` holds records, ledgers, rules and skills — the harness's own state, never product
// code; a `.jsonl` ledger append must not make a push owe 81 packages' build output (PROC-016).
const INFRASTRUCTURE_ONLY_PATTERN =
  /^(scripts\/harness\/|scripts\/build-|\.github\/|\.husky\/|\.claude\/|\.agents\/)/;
const INFRASTRUCTURE_ONLY_FILES = new Set(['osv-scanner.toml']);

function failClosedCapabilities(reason) {
  return {
    code: true,
    product: true,
    tui: true,
    examples: true,
    windows: true,
    cli: true,
    payloadNative: true,
    harness: true,
    hermetic: true,
    buildMachinery: true,
    workflow: true,
    dependencies: true,
    full: true,
    reason,
  };
}

const HARNESS_OWNER_FILES = new Set([
  'AGENTS.md',
  '.agents/harness.config.json',
  '.npmrc',
  'package.json',
  'pnpm-lock.yaml',
  'vitest.config.ts',
  'vitest.shared.ts',
]);
// Every `.agents/` artifact is harness/governance input. The fine-grained contract selector decides
// which tests actually own a changed record; this outer boundary must only guarantee that selector
// is reached. Keeping a narrower duplicate path list here creates a fail-open gap whenever a
// contract begins reading a new Task, spec, memory, or project-structure owner.
const HARNESS_GOVERNANCE_PATTERN = /^\.agents\//u;
const HERMETIC_EXECUTION_OWNER_FILES = new Set([
  '.agents/harness.config.json',
  '.github/workflows/ci.yml',
  '.github/workflows/scans-full.yml',
  'scripts/harness/canonical-temporary-directory.mjs',
  'scripts/harness/entrypoint.mjs',
  'scripts/harness/git-base-ref-resolution.mjs',
  'scripts/harness/harness-hermetic-runner.mjs',
  'scripts/harness/harness-test-classification.mjs',
  'scripts/harness/harness-test-tiers.mjs',
  'scripts/harness/harness-vitest-process.mjs',
  'scripts/harness/shared.mjs',
]);
const HERMETIC_TEST_FILE_SET = new Set(HERMETIC_TEST_FILES);

/** Whether one repository-relative path can change the harness implementation or its execution. */
export function isHarnessOwnerPath(file) {
  const normalized = String(file ?? '')
    .trim()
    .replaceAll('\\', '/');
  return (
    normalized.startsWith('scripts/harness/') ||
    normalized.startsWith('scripts/build-') ||
    normalized.startsWith('.github/workflows/') ||
    normalized === '.github/PULL_REQUEST_TEMPLATE.md' ||
    normalized.startsWith('.claude/agents/') ||
    normalized.startsWith('.claude/hooks/') ||
    normalized === '.claude/settings.json' ||
    normalized.startsWith('.husky/') ||
    HARNESS_GOVERNANCE_PATTERN.test(normalized) ||
    HARNESS_OWNER_FILES.has(normalized)
  );
}

function isDirectHermeticOwnerPath(file) {
  const normalized = String(file ?? '').replaceAll('\\', '/');
  return HERMETIC_EXECUTION_OWNER_FILES.has(normalized) || HERMETIC_TEST_FILE_SET.has(normalized);
}

/**
 * Keep the pre-install CI classifier dependency-free and fail closed for harness implementation
 * changes. The hermetic tier is intentionally cheap; deriving its exact import closure belongs to
 * the installed contract selector, not to the checkout-only `changes` job.
 */
function classifyHermeticChangesFromTree({ files }) {
  return files.some(isDirectHermeticOwnerPath);
}

const DEPENDENCY_MANIFEST_FIELDS = new Set([
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
  'packageManager',
  'overrides',
  'resolutions',
  'pnpm',
]);
const DEPENDENCY_POLICY_FILES = new Set([
  'pnpm-lock.yaml',
  'osv-scanner.toml',
  '.github/workflows/dependency-review.yml',
  '.github/workflows/security-scheduled.yml',
  'scripts/harness/generate-dependency-review-license-exemptions.mjs',
]);

const PACKAGE_BUILD_FIELDS = new Set([
  'bin',
  'exports',
  'files',
  'main',
  'module',
  'sideEffects',
  'tsdown',
  'tsup',
  'tsupConfig',
  'type',
  'types',
  'typings',
]);
const BUILD_SCRIPT_PATTERN = /^(?:build|prebuild|postbuild|prepack|postpack|pack|prepare)(?::|$)/u;

function classifyManifestPair(before, after) {
  const classification = classifyPackageManifestChange({ before, after });
  const changedScriptKeys = classification.changedKeys.includes('scripts')
    ? changedManifestKeys(before?.scripts ?? {}, after?.scripts ?? {})
    : [];
  const buildMachinery =
    classification.changedKeys.some((field) => PACKAGE_BUILD_FIELDS.has(field)) ||
    changedScriptKeys.some((script) => BUILD_SCRIPT_PATTERN.test(script));
  return {
    ...classification,
    changedScriptKeys,
    buildMachinery,
    needsProductVerification:
      classification.hasDependencyChanges ||
      classification.hasScriptOrBuildChanges ||
      buildMachinery ||
      classification.hasUnknownManifestChanges,
  };
}

function combineManifestChanges(changes) {
  return {
    changedKeys: [...new Set(changes.flatMap((change) => change.changedKeys))].sort(),
    changedScriptKeys: [...new Set(changes.flatMap((change) => change.changedScriptKeys))].sort(),
    hasDependencyChanges: changes.some((change) => change.hasDependencyChanges),
    hasUnknownManifestChanges: changes.some((change) => change.hasUnknownManifestChanges),
    buildMachinery: changes.some((change) => change.buildMachinery),
    needsProductVerification: changes.some((change) => change.needsProductVerification),
  };
}

/** Resolve manifest capabilities from immutable Git objects; unreadable content fails closed. */
function classifyManifestChangesFromGit({ files, bases, head, cwd, runGit }) {
  let dependencyChanges = files.some((file) => DEPENDENCY_POLICY_FILES.has(file));
  const manifests = files.filter((file) => /(^|\/)package\.json$/u.test(file));
  const packageManifestChanges = new Map();
  if (manifests.length === 0) return { dependencyChanges, packageManifestChanges };

  for (const manifest of manifests) {
    const headResult = runGit(['show', `${head}:${manifest}`], { cwd });
    if (!headResult.ok) return { dependencyChanges: true, packageManifestChanges: null };
    let after;
    try {
      after = JSON.parse(headResult.stdout);
    } catch {
      return { dependencyChanges: true, packageManifestChanges: null };
    }
    const changes = [];
    for (const base of bases) {
      const baseResult = runGit(['show', `${base}:${manifest}`], { cwd });
      if (!baseResult.ok) return { dependencyChanges: true, packageManifestChanges: null };
      try {
        const change = classifyManifestPair(JSON.parse(baseResult.stdout), after);
        changes.push(change);
        dependencyChanges ||= change.changedKeys.some((field) =>
          DEPENDENCY_MANIFEST_FIELDS.has(field),
        );
      } catch {
        return { dependencyChanges: true, packageManifestChanges: null };
      }
    }
    packageManifestChanges.set(manifest, combineManifestChanges(changes));
  }
  return { dependencyChanges, packageManifestChanges };
}

export const WORKSPACE_FULL_FILES = new Set([
  '.eslintignore',
  '.eslintrc.json',
  '.npmrc',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'scripts/harness/product-integration-tests.mjs',
  'tsconfig.base.json',
  'tsconfig.eslint.json',
  'tsconfig.json',
  'vitest.config.ts',
  'vitest.shared.ts',
]);

/** Build machinery changes need the clean partial-build regression, not ordinary product edits. */
export function isBuildMachineryPath(
  file,
  { rootManifestChange = null, packageManifestChanges = null } = {},
) {
  const normalized = String(file ?? '').replaceAll('\\', '/');
  if (isDocsOnlyPath(normalized)) return false;
  return (
    /^(scripts\/artifacts\/|scripts\/build-|scripts\/harness\/workspace-)/u.test(normalized) ||
    [
      '.github/workflows/ci.yml',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      '.npmrc',
      'tsconfig.base.json',
      'tsconfig.json',
    ].includes(normalized) ||
    (normalized === 'package.json' ? rootManifestChange?.workspaceWide !== false : false) ||
    (/^packages\/.*\/package\.json$/u.test(normalized)
      ? (packageManifestChanges?.get(normalized)?.buildMachinery ?? true)
      : /^packages\/.*\/(?:tsdown|vite)\.config\.[cm]?[jt]s$/u.test(normalized) ||
        /^packages\/.*\/tsconfig\.build\.json$/u.test(normalized))
  );
}

/** Inputs whose behavior or packaging can change stable external-payload reads. */
export function isPayloadNativePath(file) {
  const normalized = String(file ?? '').replaceAll('\\', '/');
  if (isDocsOnlyPath(normalized)) return false;
  return (
    normalized.startsWith('packages/agent-file-authority/') ||
    /^packages\/agent-session\/src\/(?:external-payload-[^/]+|session-log-[^/]+|session-logger|session-store|session-id|index)\.ts$/u.test(
      normalized,
    ) ||
    /^packages\/agent-session\/src\/session-record-codec\//u.test(normalized) ||
    /^packages\/agent-session\/src\/__tests__\/(?:external-payload|session-log|session-store|session-record|session-id)[^/]*\.test\.ts$/u.test(
      normalized,
    ) ||
    normalized === 'packages/agent-session/examples/verify-external-payload-replay.ts' ||
    /^packages\/agent-framework\/src\/workspace-trust\//u.test(normalized) ||
    /^packages\/agent-framework\/src\/interactive\/(?:session-persistence|workspace-session-io|workspace-session-store|interactive-session-persistence|index)\.ts$/u.test(
      normalized,
    ) ||
    /^packages\/agent-framework\/src\/interactive\/__tests__\/(?:session-persistence|session-load-routing)[^/]*\.test\.ts$/u.test(
      normalized,
    ) ||
    [
      'packages/agent-framework/src/index.ts',
      'packages/agent-framework/src/paths.ts',
      'packages/agent-framework/src/contributions/node-host-contribution-source.ts',
    ].includes(normalized) ||
    /^packages\/agent-cli\/src\/session-analyzer\//u.test(normalized) ||
    /^packages\/agent-cli\/src\/startup\/(?:preparsed-command-routing|workspace-[^/]+|command-setup|project-setup-routing|version)\.ts$/u.test(
      normalized,
    ) ||
    [
      'packages/agent-cli/src/bin.ts',
      'packages/agent-cli/src/cli.ts',
      'packages/agent-cli/src/index.ts',
      'packages/agent-cli/src/utils/cli-args.ts',
    ].includes(normalized) ||
    /^packages\/agent-cli\/scripts\/(?:build-bun|e2e-native-file-authority)\.mjs$/u.test(
      normalized,
    ) ||
    /^scripts\/artifacts\/[^/]+\.mjs$/u.test(normalized) ||
    [
      'packages/agent-session/package.json',
      'packages/agent-session/tsdown.config.ts',
      'packages/agent-session/tsconfig.json',
      'packages/agent-session/vitest.config.ts',
      'packages/agent-framework/package.json',
      'packages/agent-framework/tsdown.config.ts',
      'packages/agent-framework/tsconfig.json',
      'packages/agent-framework/vitest.config.ts',
      'packages/agent-cli/package.json',
      'packages/agent-cli/tsdown.config.ts',
      'packages/agent-cli/tsconfig.json',
      'packages/agent-cli/vitest.config.ts',
      '.github/workflows/ci.yml',
      '.github/workflows/release-bun-binaries.yml',
      '.github/required-status-checks.json',
      'scripts/harness/classify-changed-paths.mjs',
      'scripts/harness/payload-native-evidence.mjs',
    ].includes(normalized)
  );
}

/** Inputs that can change product ownership, graph traversal, or root product configuration. */
export function isFullVerificationPath(
  file,
  { rootManifestChange = null, packageManifestChanges = null } = {},
) {
  const normalized = String(file ?? '').replaceAll('\\', '/');
  if (normalized === 'package.json') return rootManifestChange?.workspaceWide !== false;
  if (/(^|\/)package\.json$/u.test(normalized)) {
    return packageManifestChanges?.get(normalized)?.hasUnknownManifestChanges ?? true;
  }
  return WORKSPACE_FULL_FILES.has(normalized);
}

/**
 * Classify an already-resolved list of changed paths.
 *
 * @param {string[]} files repository-relative paths changed by the PR
 * @returns {{code: boolean, reason: string}}
 */
export function classifyFiles(
  files,
  {
    rootManifestChange = null,
    capabilities = null,
    dependencyChanges = null,
    hermeticChanges = null,
    packageManifestChanges = null,
    buildMachineryChanges = null,
  } = {},
) {
  const changed = (files ?? []).map((file) => String(file).trim()).filter(Boolean);
  if (changed.length === 0) {
    return failClosedCapabilities(
      'no changed files could be resolved — classifying as CODE so nothing is skipped.',
    );
  }
  const harness = changed.some(isHarnessOwnerPath);
  const codeFiles = changed.filter((file) => !isDocsOnlyPath(file));
  if (codeFiles.length === 0) {
    return {
      code: false,
      product: false,
      tui: false,
      examples: false,
      windows: false,
      cli: false,
      payloadNative: false,
      harness,
      hermetic: false,
      buildMachinery: false,
      workflow: false,
      dependencies: false,
      full: false,
      reason: 'docs-only PR: no analyzable code changed.',
    };
  }

  const full =
    codeFiles.some((file) =>
      isFullVerificationPath(file, { rootManifestChange, packageManifestChanges }),
    ) || Boolean(capabilities?.error);

  const product = codeFiles.some((file) => {
    if (file === 'package.json' && rootManifestChange?.workspaceWide === false) return false;
    const manifestChange = packageManifestChanges?.get(file);
    if (manifestChange) return manifestChange.needsProductVerification;
    if (isBuildMachineryPath(file, { rootManifestChange, packageManifestChanges })) return true;
    if (INFRASTRUCTURE_ONLY_PATTERN.test(file) || INFRASTRUCTURE_ONLY_FILES.has(file)) return false;
    return true;
  });
  const workflow = codeFiles.some((file) => /^\.github\/workflows\/.*\.ya?ml$/u.test(file));
  const dependencies =
    dependencyChanges ??
    codeFiles.some(
      (file) => DEPENDENCY_POLICY_FILES.has(file) || /(^|\/)package\.json$/u.test(file),
    );
  const hermetic = full || hermeticChanges || codeFiles.some(isDirectHermeticOwnerPath);
  const buildMachinery =
    full ||
    buildMachineryChanges ||
    codeFiles.some((file) =>
      isBuildMachineryPath(file, { rootManifestChange, packageManifestChanges }),
    );
  const payloadNative = full || codeFiles.some(isPayloadNativePath);
  return {
    code: true,
    product,
    tui: full || capabilities?.tui === true,
    examples: full || capabilities?.examples === true,
    windows: full || capabilities?.windows === true,
    cli: full || capabilities?.cli === true,
    payloadNative,
    harness,
    hermetic,
    buildMachinery,
    workflow,
    dependencies,
    full,
    reason: capabilities?.error
      ? `${capabilities.error}; full verification runs fail closed.`
      : full
        ? 'control-plane, workspace graph, manifest, lock, or root config changed: full verification runs.'
        : product
          ? `product changes present: product matrix runs (${codeFiles.length} code file(s)).`
          : `infrastructure-only changes: product matrix is not applicable (${codeFiles.length} code file(s)).`,
  };
}

function git(args, { cwd } = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function classifyRootManifestFromGit({ files, bases, head, cwd, runGit }) {
  if (!files.includes('package.json')) return null;
  const headManifest = runGit(['show', `${head}:package.json`], { cwd });
  if (!headManifest.ok) return null;
  try {
    const after = JSON.parse(headManifest.stdout);
    for (const base of bases) {
      const baseManifest = runGit(['show', `${base}:package.json`], { cwd });
      if (!baseManifest.ok) return null;
      const classification = classifyRootManifestChange({
        before: JSON.parse(baseManifest.stdout),
        after,
      });
      if (classification.workspaceWide !== false) return classification;
    }
    return { kind: 'developer-quality-only', workspaceWide: false };
  } catch {
    return null;
  }
}

/** Resolve changes against every merge base and fail closed on unresolved history. */
export function classifyRange({ baseRef, head = 'HEAD', cwd, runGit = git } = {}) {
  const merge = runGit(['merge-base', '--all', baseRef, head], { cwd });
  const bases = merge.ok
    ? merge.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    : [];
  if (bases.length === 0) {
    return {
      ...failClosedCapabilities('Classifying as CODE so no required check is silently skipped.'),
      bases: [],
      files: [],
      error: `no merge base between ${baseRef} and ${head}.`,
    };
  }

  const files = new Set();
  for (const base of bases) {
    // `--name-only` emits only the destination when rename detection is active. Disable it so a
    // move out of a product-owned tree still contributes the deleted source path and cannot make
    // the corresponding capability job disappear.
    const diff = runGit(
      ['diff', '--name-only', '--no-renames', '--diff-filter=ACMRD', base, head],
      { cwd },
    );
    if (!diff.ok) {
      return {
        ...failClosedCapabilities('Classifying as CODE so no required check is silently skipped.'),
        bases,
        files: [],
        error: `git diff against merge base ${base} failed.`,
      };
    }
    for (const line of diff.stdout.split('\n')) {
      const file = line.trim();
      if (file) files.add(file);
    }
  }

  const sorted = [...files].sort();
  const rootManifestChange = classifyRootManifestFromGit({
    files: sorted,
    bases,
    head,
    cwd,
    runGit,
  });
  const { dependencyChanges, packageManifestChanges } = classifyManifestChangesFromGit({
    files: sorted,
    bases,
    head,
    cwd,
    runGit,
  });
  const hermeticChanges = classifyHermeticChangesFromTree({ files: sorted, cwd });
  const fullInput = sorted.some((file) =>
    isFullVerificationPath(file, { rootManifestChange, packageManifestChanges }),
  );
  const capabilityFiles = sorted.filter((file) => {
    const manifestChange = packageManifestChanges?.get(file);
    return manifestChange?.needsProductVerification !== false;
  });
  const capabilities = fullInput
    ? null
    : resolveCapabilityReachability(capabilityFiles, { cwd: cwd ?? process.cwd() });
  const buildMachineryChanges = sorted.some((file) =>
    isBuildMachineryPath(file, { rootManifestChange, packageManifestChanges }),
  );
  return {
    ...classifyFiles(sorted, {
      rootManifestChange,
      capabilities,
      dependencyChanges,
      hermeticChanges,
      packageManifestChanges,
      buildMachineryChanges,
    }),
    bases,
    files: sorted,
  };
}

function argValue(argv, flag) {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

export function main(argv = process.argv.slice(2), write = (text) => process.stdout.write(text)) {
  const baseRef = argValue(argv, '--base-ref');
  if (!baseRef) {
    process.stderr.write(
      'usage: classify-changed-paths.mjs --base-ref <ref> [--head <rev>]\n' +
        'Classifies a PR as code vs documentation-only. Prints `code=true|false`.\n',
    );
    process.exitCode = 1;
    return undefined;
  }

  const head = argValue(argv, '--head') ?? 'HEAD';
  const result = classifyRange({ baseRef, head });

  write(`merge base(s) vs ${baseRef}:\n`);
  for (const base of result.bases) write(`  ${base}\n`);
  if (result.error) write(`::error::changes: ${result.error} ${result.reason}\n`);
  else {
    write('changed files:\n');
    for (const file of result.files) write(`  ${file}\n`);
    write(`→ ${result.reason}\n`);
  }
  write(`code=${result.code}\n`);
  write(`product=${result.product}\n`);
  write(`tui=${result.tui}\n`);
  write(`examples=${result.examples}\n`);
  write(`windows=${result.windows}\n`);
  write(`cli=${result.cli}\n`);
  write(`payload_native=${result.payloadNative}\n`);
  write(`harness=${result.harness}\n`);
  write(`hermetic=${result.hermetic}\n`);
  write(`build_machinery=${result.buildMachinery}\n`);
  write(`workflow=${result.workflow}\n`);
  write(`dependencies=${result.dependencies}\n`);
  write(`full=${result.full}\n`);

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `code=${result.code}\nproduct=${result.product}\ntui=${result.tui}\nexamples=${result.examples}\nwindows=${result.windows}\ncli=${result.cli}\npayload_native=${result.payloadNative}\nharness=${result.harness}\nhermetic=${result.hermetic}\nbuild_machinery=${result.buildMachinery}\nworkflow=${result.workflow}\ndependencies=${result.dependencies}\nfull=${result.full}\n`,
    );
  }
  return result;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
