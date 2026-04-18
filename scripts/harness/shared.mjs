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

function resolveDefaultBaseRef() {
  const candidates = [];
  const envBaseRef = process.env.HARNESS_BASE_REF?.trim();
  const githubBaseRef = process.env.GITHUB_BASE_REF?.trim();

  if (envBaseRef) {
    candidates.push(envBaseRef);
  }
  if (githubBaseRef) {
    candidates.push(`origin/${githubBaseRef}`, githubBaseRef);
  }

  candidates.push('origin/develop', 'develop', 'origin/main', 'main');

  for (const candidate of candidates) {
    if (candidate && gitRefExists(candidate)) {
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
    scopes.push({
      kind,
      relativeDir,
      shortName: path.posix.basename(relativeDir),
      workspaceName: typeof packageJson.name === 'string' ? packageJson.name : relativeDir,
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

  const resolvedBaseRef =
    typeof baseRef === 'string' && baseRef.trim().length > 0
      ? baseRef.trim()
      : resolveDefaultBaseRef();

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

export function classifyScopeChanges(scope, files, forceFullVerification) {
  const hasSourceChanges = files.some((file) => file.startsWith(`${scope.relativeDir}/src/`));
  const hasTestChanges = files.some((file) => {
    return (
      file.includes('/__tests__/') ||
      file.endsWith('.test.ts') ||
      file.endsWith('.test.tsx') ||
      file.endsWith('.spec.ts') ||
      file.endsWith('.spec.tsx')
    );
  });
  const hasConfigChanges = files.some((file) => {
    return (
      file === `${scope.relativeDir}/package.json` || file === `${scope.relativeDir}/tsconfig.json`
    );
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
  const hasManifestChanges = files.some((file) => file === `${scope.relativeDir}/package.json`);

  return {
    hasSourceChanges,
    hasTestChanges,
    hasConfigChanges,
    hasDocsChanges,
    hasScenarioChanges,
    hasEntrypointChanges,
    hasManifestChanges,
    needsBuild: forceFullVerification || hasSourceChanges || hasConfigChanges,
    needsTest: forceFullVerification || hasSourceChanges || hasTestChanges || hasConfigChanges,
    needsLint: forceFullVerification || hasSourceChanges || hasTestChanges || hasConfigChanges,
    needsTypecheck:
      scope.hasTsconfig && (forceFullVerification || hasSourceChanges || hasConfigChanges),
  };
}
