import { spawnSync } from 'node:child_process';
import { appendFileSync, readdirSync, promises as fs } from 'node:fs';
import path from 'node:path';

import { createBoundedGitRefExists } from './git-base-ref-resolution.mjs';

export const WORKSPACE_ROOT = process.cwd();
const PNPM_WORKSPACE_PATH = path.join(WORKSPACE_ROOT, 'pnpm-workspace.yaml');

export async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function readJson(targetPath) {
  return JSON.parse(await fs.readFile(targetPath, 'utf8'));
}

export async function readText(targetPath) {
  return fs.readFile(targetPath, 'utf8');
}

/**
 * Every `.mjs` under a directory, RECURSIVELY, as paths relative to it.
 *
 * HARNESS-067: `scripts/harness/lib/` holds shared modules that a top-level read left outside both
 * harness floors — a hardcoded scope or a module doing work on import would have gone uncounted
 * there. Shared rather than copied for the same reason `escapeForRegExp` is: two ratchets that must
 * agree on what a harness script IS will otherwise diverge silently, and this diff already had to fix
 * the identical blind spot in both. `__tests__` is excluded — a test may name what it tests.
 */
export function harnessScripts(dir, prefix = '') {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) found.push(...harnessScripts(path.join(dir, entry.name), relative));
    else if (entry.name.endsWith('.mjs')) found.push(relative);
  }
  return found;
}

/**
 * Escape a value for literal use inside a `RegExp`.
 *
 * HARNESS-067 needs this in more than one place: a pattern built from the CONFIGURED npm scope is the
 * fix for a hardcoded one, and the scope contains `/`, which is inert here but `.` and `-` in other
 * configured values are not. It lived privately in `check-agent-server-boundary.mjs`; a second caller
 * is when a private helper becomes a shared one rather than a copy.
 */
export function escapeForRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function hasCanonicalSpecReference(content) {
  return (
    content.includes('`SPEC.md`') ||
    content.includes('](SPEC.md)') ||
    content.includes('](./SPEC.md)')
  );
}

export async function readWorkspacePatterns() {
  const content = await fs.readFile(PNPM_WORKSPACE_PATH, 'utf8');
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) =>
      line
        .slice(2)
        .trim()
        .replace(/^['"]|['"]$/g, ''),
    );
}

function parseGitStatusFiles(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const payload = line.slice(3).trim();
      if (payload.includes(' -> ')) {
        return payload.split(' -> ').at(-1) ?? payload;
      }
      return payload;
    });
}

function parseGitDiffFiles(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function resolveGitBaseRef(explicitBaseRef = null, env = process.env, options = {}) {
  return resolveBaseRef({
    explicitBaseRef,
    env,
    refExists: options.refExists ?? createBoundedGitRefExists({ cwd: WORKSPACE_ROOT, ...options }),
  });
}

export function resolveBaseRef({ explicitBaseRef = null, env = process.env, refExists }) {
  const trimmedExplicitBaseRef = typeof explicitBaseRef === 'string' ? explicitBaseRef.trim() : '';
  if (trimmedExplicitBaseRef) {
    return trimmedExplicitBaseRef;
  }

  const candidates = [];
  const envBaseRef = env.HARNESS_BASE_REF?.trim();
  const githubBaseRef = env.GITHUB_BASE_REF?.trim();

  if (envBaseRef) {
    candidates.push(envBaseRef);
  }
  if (githubBaseRef) {
    candidates.push(`origin/${githubBaseRef}`, githubBaseRef);
  }

  candidates.push('origin/develop', 'develop', 'origin/main', 'main');

  for (const candidate of candidates) {
    if (candidate && refExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

export async function listWorkspaceScopes() {
  const scopes = [];
  const patterns = await readWorkspacePatterns();
  const rootNames = Array.from(new Set(patterns.map((pattern) => pattern.split('/')[0])));

  for (const rootName of rootNames) {
    // `examples/*` are workspace members only so pnpm links @robota-sdk/* to local
    // source for drift-detecting typecheck. They are NOT scannable scopes (no SPEC.md,
    // not published), so the harness scans skip them.
    if (rootName === 'examples') {
      continue;
    }
    // `scratch` is the dev-tooling home for disposable live-verification scripts
    // (INFRA-023): committed skeleton only, src/ gitignored — not a scannable scope.
    if (rootName === 'scratch') {
      continue;
    }
    if (!(await pathExists(path.join(WORKSPACE_ROOT, rootName)))) {
      continue;
    }

    await collectScopes(rootName, rootName === 'apps' ? 'app' : 'package', scopes, patterns);
  }

  return scopes
    .filter(
      (scope, index, values) =>
        values.findIndex((value) => value.relativeDir === scope.relativeDir) === index,
    )
    .map((scope, _index, values) => {
      const workspaceNames = new Set(values.map((value) => value.workspaceName));
      return {
        ...scope,
        workspaceDependencies: scope.dependencyNames.filter((name) => workspaceNames.has(name)),
      };
    })
    .sort((left, right) => left.relativeDir.localeCompare(right.relativeDir));
}

function matchesWorkspacePattern(relativeDir, pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]+');
  return new RegExp(`^${escaped}$`).test(relativeDir);
}

async function collectScopes(relativeDir, kind, scopes, patterns) {
  const absoluteDir = path.join(WORKSPACE_ROOT, relativeDir);
  const packageJsonPath = path.join(absoluteDir, 'package.json');

  if (
    (await pathExists(packageJsonPath)) &&
    patterns.some((pattern) => matchesWorkspacePattern(relativeDir, pattern))
  ) {
    const packageJson = await readJson(packageJsonPath);
    const dependencyNames = listPackageDependencyNames(packageJson);
    scopes.push({
      kind,
      relativeDir,
      shortName: path.posix.basename(relativeDir),
      workspaceName: typeof packageJson.name === 'string' ? packageJson.name : relativeDir,
      dependencyNames,
      scripts:
        typeof packageJson.scripts === 'object' && packageJson.scripts !== null
          ? packageJson.scripts
          : {},
      hasTsconfig: await pathExists(path.join(absoluteDir, 'tsconfig.json')),
    });
  }

  const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) {
      continue;
    }
    await collectScopes(path.posix.join(relativeDir, entry.name), kind, scopes, patterns);
  }
}

function listPackageDependencyNames(packageJson) {
  return [
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
    ...Object.keys(packageJson.peerDependencies ?? {}),
    ...Object.keys(packageJson.optionalDependencies ?? {}),
  ];
}

export function parseScopeArgs(argv) {
  const options = {
    scopeTokens: [],
    dryRun: false,
    skipBuild: false,
    skipTests: false,
    skipLint: false,
    skipTypecheck: false,
    includeScenarios: false,
    skipRecordCheck: false,
    skipRepositoryChecks: false,
    skipRepositoryCheckNames: [],
    skipDependentScopes: false,
    reportFile: null,
    reportFormat: null,
    baseRef: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case '--':
        break;
      case '--scope': {
        const value = argv[index + 1];
        if (!value) {
          throw new Error('--scope requires a value');
        }
        options.scopeTokens.push(value);
        index += 1;
        break;
      }
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--skip-build':
        options.skipBuild = true;
        break;
      case '--skip-tests':
        options.skipTests = true;
        break;
      case '--skip-lint':
        options.skipLint = true;
        break;
      case '--skip-typecheck':
        options.skipTypecheck = true;
        break;
      case '--include-scenarios':
        options.includeScenarios = true;
        break;
      case '--skip-record-check':
        options.skipRecordCheck = true;
        break;
      case '--skip-repository-checks':
        options.skipRepositoryChecks = true;
        break;
      case '--skip-repository-check': {
        const value = argv[index + 1];
        if (!value) {
          throw new Error('--skip-repository-check requires a value');
        }
        options.skipRepositoryCheckNames.push(value);
        index += 1;
        break;
      }
      case '--skip-dependent-scopes':
        options.skipDependentScopes = true;
        break;
      case '--report-file': {
        const value = argv[index + 1];
        if (!value) {
          throw new Error('--report-file requires a value');
        }
        options.reportFile = value;
        index += 1;
        break;
      }
      case '--report-format': {
        const value = argv[index + 1];
        if (!value) {
          throw new Error('--report-format requires a value');
        }
        if (value !== 'markdown' && value !== 'json') {
          throw new Error('--report-format must be one of: markdown, json');
        }
        options.reportFormat = value;
        index += 1;
        break;
      }
      case '--base-ref': {
        const value = argv[index + 1];
        if (!value) {
          throw new Error('--base-ref requires a value');
        }
        options.baseRef = value;
        index += 1;
        break;
      }
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  return options;
}

/**
 * `process.env` with hook-inherited `GIT_*` variables stripped. A git hook (husky pre-push) exports
 * `GIT_DIR`/`GIT_INDEX_FILE`/`GIT_WORK_TREE` etc., which redirect EVERY child `git` call to the hook's
 * repository REGARDLESS of cwd — git-fixture tests inside a spawned suite then mutate the real checkout
 * (observed 2026-07-24: rogue fixture commits + `core.bare=true` pollution during the parallel wave).
 * Harness children always operate on their explicit cwd, so the redirect vars must never propagate.
 */
export function envWithoutGitVars(base = process.env) {
  return Object.fromEntries(Object.entries(base).filter(([key]) => !key.startsWith('GIT_')));
}

/**
 * Append markdown to the GitHub Actions JOB SUMMARY, so what a job actually covered is readable
 * from the run page rather than only from the middle of a log.
 *
 * INFRA-060 D4. `build: success` and `quality: success` read identically whether the job verified
 * every package or none of them; the fact that a PR verified NOTHING was recoverable only by
 * opening the log. Writing to `$GITHUB_STEP_SUMMARY` needs no workflow change — any step's process
 * can append to it — so the harness surfaces its own coverage instead of the workflow describing it.
 *
 * Returns false (and writes nothing) outside Actions, which is every local run.
 */
export function appendJobSummary(markdown) {
  const target = process.env.GITHUB_STEP_SUMMARY;
  if (!target) {
    return false;
  }

  appendFileSync(target, markdown.endsWith('\n') ? markdown : `${markdown}\n`, 'utf8');
  return true;
}

export function runCommand(command, args, workdir, dryRun, envOverrides = {}) {
  const rendered = [command, ...args].join(' ');
  process.stdout.write(`> (${path.relative(WORKSPACE_ROOT, workdir) || '.'}) ${rendered}\n`);

  if (dryRun) {
    return { status: 0 };
  }

  const result = spawnSync(command, args, {
    cwd: workdir,
    stdio: 'inherit',
    encoding: 'utf8',
    env: {
      ...envWithoutGitVars(),
      ...envOverrides,
    },
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: ${rendered}`);
  }

  return result;
}

/**
 * The files this change touches: the UNION of the uncommitted working-tree entries and the branch's
 * diff against its base ref.
 *
 * FAIL-CLOSED (INFRA-048-C). When NO base ref can be resolved, this throws. It used to return `[]`,
 * which is indistinguishable from a branch that genuinely changed nothing — so `harness:plan`
 * printed "Changed files: 0" and `harness:verify` exited 0 having verified nothing, on a branch
 * carrying real source changes. An empty list is still returned for the legitimate case (base
 * resolved, diff ran, no files differ); only "could not compute" throws.
 *
 * UNION, not either/or (INFRA-056). This used to RETURN EARLY on the working-tree entries whenever
 * the tree was dirty, and never consult the base diff at all. CI never takes that path — it checks
 * out clean, so its plan always comes from `origin/<base>...HEAD` — which made every local
 * "same command CI runs" claim hold only for a clean tree, and fail SILENTLY and in the
 * UNDER-counting direction otherwise: one dirty untracked scratch file was enough for a branch full
 * of package-source commits to plan zero package scopes, print "No package or app scope detected"
 * and exit 0. A dirty tree therefore no longer excuses base-ref resolution either; a change set
 * computed from half the inputs is exactly the "success over ground it never covered" shape
 * INFRA-048 closed for the other half.
 */
export function detectChangedFiles(baseRef = null) {
  const result = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: WORKSPACE_ROOT,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error('Unable to read changed files from git status.');
  }

  const workingTreeFiles = parseGitStatusFiles(result.stdout);
  const resolvedBaseRef = resolveGitBaseRef(baseRef);

  if (!resolvedBaseRef) {
    throw new Error(
      'Unable to resolve a base ref to diff against (tried --base-ref, $HARNESS_BASE_REF, ' +
        'origin/$GITHUB_BASE_REF, $GITHUB_BASE_REF, origin/develop, develop, origin/main, main). ' +
        'Refusing to report a change set from a base that could not be resolved — an empty list ' +
        'reads as "nothing to verify" (INFRA-048) and the working-tree entries alone under-count ' +
        'every commit already on the branch (INFRA-056). ' +
        'Pass --base-ref <ref>, or fetch the base branch.',
    );
  }

  const diffResult = spawnSync(
    'git',
    ['diff', '--name-only', '--diff-filter=ACMRD', `${resolvedBaseRef}...HEAD`],
    {
      cwd: WORKSPACE_ROOT,
      encoding: 'utf8',
    },
  );

  if (diffResult.status !== 0) {
    throw new Error(`Unable to read changed files from git diff against ${resolvedBaseRef}.`);
  }

  return [...new Set([...workingTreeFiles, ...parseGitDiffFiles(diffResult.stdout)])];
}

export function resolveRequestedScopes(scopeTokens, scopes) {
  const resolved = [];

  for (const token of scopeTokens) {
    const matches = scopes.filter((scope) => {
      return (
        scope.relativeDir === token || scope.workspaceName === token || scope.shortName === token
      );
    });

    if (matches.length === 0) {
      throw new Error(`Unknown scope: ${token}`);
    }

    if (matches.length > 1) {
      throw new Error(
        `Ambiguous scope: ${token}. Use one of: ${matches.map((scope) => scope.relativeDir).join(', ')}`,
      );
    }

    const match = matches[0];
    if (!resolved.some((scope) => scope.relativeDir === match.relativeDir)) {
      resolved.push(match);
    }
  }

  return resolved;
}

export function mapFilesToScopes(files, scopes) {
  const byScope = new Map();

  for (const scope of scopes) {
    byScope.set(scope.relativeDir, []);
  }

  for (const file of files) {
    for (const scope of scopes) {
      if (file === scope.relativeDir || file.startsWith(`${scope.relativeDir}/`)) {
        byScope.get(scope.relativeDir)?.push(file);
        break;
      }
    }
  }

  return byScope;
}

const PACKAGE_DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];
const PACKAGE_PUBLIC_SURFACE_FIELDS = ['exports', 'main', 'module', 'types', 'typings', 'bin'];
const PACKAGE_SCRIPT_OR_BUILD_FIELDS = [
  'scripts',
  'engines',
  'type',
  'files',
  'sideEffects',
  'tsup',
  'tsupConfig',
];
const PACKAGE_PUBLISH_METADATA_FIELDS = [
  'name',
  'version',
  'description',
  'license',
  'author',
  'contributors',
  'homepage',
  'repository',
  'bugs',
  'keywords',
  'private',
  'publishConfig',
];

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function valuesEqual(left, right) {
  return stableJson(left) === stableJson(right);
}

function changedManifestKeys(before, after) {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return Array.from(keys).filter((key) => !valuesEqual(before?.[key], after?.[key]));
}

export function classifyPackageManifestChange({ before, after }) {
  const changedKeys = changedManifestKeys(before, after);
  const hasVersionOnlyChanges = changedKeys.length === 1 && changedKeys[0] === 'version';
  const hasDependencyChanges = changedKeys.some((key) => PACKAGE_DEPENDENCY_FIELDS.includes(key));
  const hasPublicSurfaceChanges = changedKeys.some((key) =>
    PACKAGE_PUBLIC_SURFACE_FIELDS.includes(key),
  );
  const hasScriptOrBuildChanges = changedKeys.some((key) =>
    PACKAGE_SCRIPT_OR_BUILD_FIELDS.includes(key),
  );
  const hasPublishMetadataChanges =
    changedKeys.length > 0 &&
    changedKeys.every((key) => PACKAGE_PUBLISH_METADATA_FIELDS.includes(key)) &&
    !hasVersionOnlyChanges;
  const hasUnknownManifestChanges = changedKeys.some((key) => {
    return ![
      ...PACKAGE_DEPENDENCY_FIELDS,
      ...PACKAGE_PUBLIC_SURFACE_FIELDS,
      ...PACKAGE_SCRIPT_OR_BUILD_FIELDS,
      ...PACKAGE_PUBLISH_METADATA_FIELDS,
    ].includes(key);
  });
  const needsSourceHeavyChecks =
    hasDependencyChanges ||
    hasPublicSurfaceChanges ||
    hasScriptOrBuildChanges ||
    hasUnknownManifestChanges;

  let kind = 'none';
  if (hasVersionOnlyChanges) {
    kind = 'version-only';
  } else if (hasDependencyChanges) {
    kind = 'dependency';
  } else if (hasPublicSurfaceChanges) {
    kind = 'public-surface';
  } else if (hasScriptOrBuildChanges) {
    kind = 'script-or-build';
  } else if (hasPublishMetadataChanges) {
    kind = 'publish-metadata';
  } else if (hasUnknownManifestChanges) {
    kind = 'unknown';
  }

  return {
    kind,
    changedKeys,
    hasVersionOnlyChanges,
    hasDependencyChanges,
    hasPublicSurfaceChanges,
    hasScriptOrBuildChanges,
    hasPublishMetadataChanges,
    hasUnknownManifestChanges,
    needsSourceHeavyChecks,
  };
}

const DEVELOPER_QUALITY_SCRIPT_NAMES = new Set(['lint:fix', 'lint:fix:staged']);

function isDeveloperQualityScript(name) {
  return DEVELOPER_QUALITY_SCRIPT_NAMES.has(name) || name.startsWith('harness:');
}

export function classifyRootManifestChange({ before, after }) {
  const changedKeys = changedManifestKeys(before, after);
  const changedScriptKeys =
    changedKeys.length === 1 && changedKeys[0] === 'scripts'
      ? changedManifestKeys(before?.scripts ?? {}, after?.scripts ?? {})
      : [];
  const developerQualityOnly =
    changedScriptKeys.length > 0 && changedScriptKeys.every((key) => isDeveloperQualityScript(key));

  return {
    kind: developerQualityOnly ? 'developer-quality-only' : 'workspace-wide',
    changedKeys,
    changedScriptKeys,
    workspaceWide: !developerQualityOnly,
  };
}

function readGitFile(ref, file) {
  const result = spawnSync('git', ['show', `${ref}:${file}`], {
    cwd: WORKSPACE_ROOT,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    return null;
  }

  return result.stdout;
}

export async function collectPackageManifestChanges({ scopes, changedFiles, baseRef }) {
  const resolvedBaseRef = resolveGitBaseRef(baseRef);
  const manifestChangesByScope = new Map();

  if (!resolvedBaseRef) {
    return manifestChangesByScope;
  }

  for (const scope of scopes) {
    const manifestFile = `${scope.relativeDir}/package.json`;
    if (!changedFiles.includes(manifestFile)) {
      continue;
    }

    const beforeText = readGitFile(resolvedBaseRef, manifestFile);
    if (!beforeText) {
      continue;
    }

    const afterPath = path.join(WORKSPACE_ROOT, manifestFile);
    const after = (await pathExists(afterPath)) ? await readJson(afterPath) : {};
    const before = JSON.parse(beforeText);
    manifestChangesByScope.set(scope.relativeDir, classifyPackageManifestChange({ before, after }));
  }

  return manifestChangesByScope;
}

export async function collectRootManifestChange({ changedFiles, baseRef }) {
  if (!changedFiles.includes('package.json')) {
    return null;
  }

  const resolvedBaseRef = resolveGitBaseRef(baseRef);
  if (!resolvedBaseRef) {
    return { kind: 'unclassified-workspace-wide', workspaceWide: true };
  }

  try {
    const beforeText = readGitFile(resolvedBaseRef, 'package.json');
    if (!beforeText) {
      return { kind: 'unclassified-workspace-wide', workspaceWide: true };
    }
    const afterPath = path.join(WORKSPACE_ROOT, 'package.json');
    if (!(await pathExists(afterPath))) {
      return { kind: 'workspace-wide', workspaceWide: true };
    }
    return classifyRootManifestChange({
      before: JSON.parse(beforeText),
      after: await readJson(afterPath),
    });
  } catch {
    return { kind: 'unclassified-workspace-wide', workspaceWide: true };
  }
}

function isTestFile(file) {
  return (
    file.includes('/__tests__/') ||
    file.endsWith('.test.ts') ||
    file.endsWith('.test.tsx') ||
    file.endsWith('.spec.ts') ||
    file.endsWith('.spec.tsx')
  );
}

export function classifyScopeChanges(scope, files, forceFullVerification, options = {}) {
  const hasTestChanges = files.some((file) => {
    return (
      fileBelongsToScopePath(file, scope.relativeDir) &&
      (isTestFile(file) || file.includes('/test/'))
    );
  });
  const hasSourceChanges = files.some((file) => {
    return file.startsWith(`${scope.relativeDir}/src/`) && !isTestFile(file);
  });
  const manifestChange = options.manifestChange ?? null;
  const hasPackageManifestChanges = files.some(
    (file) => file === `${scope.relativeDir}/package.json`,
  );
  const unknownPackageManifestChange = hasPackageManifestChanges && !manifestChange;
  const hasDependencyManifestChanges = Boolean(manifestChange?.hasDependencyChanges);
  const hasPublicSurfaceManifestChanges = Boolean(manifestChange?.hasPublicSurfaceChanges);
  const hasScriptOrBuildManifestChanges = Boolean(manifestChange?.hasScriptOrBuildChanges);
  const hasVersionOnlyManifestChanges = Boolean(manifestChange?.hasVersionOnlyChanges);
  const hasPublishMetadataManifestChanges = Boolean(manifestChange?.hasPublishMetadataChanges);
  const hasSourceHeavyManifestChanges =
    unknownPackageManifestChange || Boolean(manifestChange?.needsSourceHeavyChecks);
  const hasConfigChanges =
    unknownPackageManifestChange ||
    hasScriptOrBuildManifestChanges ||
    files.some((file) => {
      return file === `${scope.relativeDir}/tsconfig.json`;
    });
  const hasDocsChanges = files.some((file) => {
    return (
      file.startsWith(`${scope.relativeDir}/docs/`) ||
      file === `${scope.relativeDir}/README.md` ||
      file === `${scope.relativeDir}/CHANGELOG.md`
    );
  });
  const hasScenarioChanges = files.some((file) => {
    return file.includes('/examples/') || file.includes('/scenario');
  });
  const hasEntrypointChanges = files.some((file) => {
    return (
      file === `${scope.relativeDir}/src/index.ts` || file === `${scope.relativeDir}/src/index.tsx`
    );
  });
  const hasManifestChanges = hasPackageManifestChanges;
  const needsBuild =
    forceFullVerification || hasSourceChanges || hasConfigChanges || hasSourceHeavyManifestChanges;
  const needsTypecheck =
    scope.hasTsconfig &&
    (forceFullVerification ||
      hasSourceChanges ||
      hasTestChanges ||
      hasConfigChanges ||
      hasSourceHeavyManifestChanges);

  return {
    hasSourceChanges,
    hasTestChanges,
    hasConfigChanges,
    hasDocsChanges,
    hasScenarioChanges,
    hasEntrypointChanges,
    hasManifestChanges,
    hasVersionOnlyManifestChanges,
    hasDependencyManifestChanges,
    hasPublicSurfaceManifestChanges,
    hasScriptOrBuildManifestChanges,
    hasPublishMetadataManifestChanges,
    hasSourceHeavyManifestChanges,
    needsBuild,
    needsTest: forceFullVerification || hasSourceChanges || hasTestChanges || hasConfigChanges,
    needsLint: forceFullVerification || hasSourceChanges || hasTestChanges || hasConfigChanges,
    needsTypecheck,
  };
}

function fileBelongsToScopePath(file, relativeDir) {
  return file === relativeDir || file.startsWith(`${relativeDir}/`);
}
