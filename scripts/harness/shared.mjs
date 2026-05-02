import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

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

function gitRefExists(ref) {
  const result = spawnSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], {
    cwd: WORKSPACE_ROOT,
    stdio: 'ignore',
    encoding: 'utf8',
  });
  return result.status === 0;
}

export function resolveGitBaseRef(explicitBaseRef = null) {
  return resolveBaseRef({
    explicitBaseRef,
    env: process.env,
    refExists: gitRefExists,
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
      ...process.env,
      ...envOverrides,
    },
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: ${rendered}`);
  }

  return result;
}

export function detectChangedFiles(baseRef = null) {
  const result = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: WORKSPACE_ROOT,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error('Unable to read changed files from git status.');
  }

  const workingTreeFiles = parseGitStatusFiles(result.stdout);
  if (workingTreeFiles.length > 0) {
    return workingTreeFiles;
  }

  const resolvedBaseRef = resolveGitBaseRef(baseRef);

  if (!resolvedBaseRef) {
    return [];
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

  return parseGitDiffFiles(diffResult.stdout);
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
