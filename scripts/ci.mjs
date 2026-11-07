import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
function command(executable, args, cwd, capture = false, timeout = 60_000) {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
    timeout,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `${executable} ${args.join(' ')} failed: ${result.error?.message ?? result.stderr ?? result.status}`,
    );
  return result.stdout;
}
const git = (cwd, ...args) => command('git', args, cwd, true).trimEnd();
const filters = (dirs) => dirs.flatMap((dir) => ['--filter', `./${dir}`]);

export function workspaces(cwd, selectors = []) {
  cwd = realpathSync(cwd);
  const projects = JSON.parse(
    command(pnpm, ['-r', ...selectors, 'list', '--depth', '-1', '--json'], cwd, true),
  );
  return projects
    .filter((project) => project.path !== cwd)
    .map((project) => {
      const dir = path.relative(cwd, project.path).split(path.sep).join('/');
      if (!/^(packages|apps|examples)\/[\w/-]+$/.test(dir) && dir !== 'scratch')
        throw new Error(`Unexpected workspace path: ${dir}`);
      return { ...JSON.parse(readFileSync(path.join(project.path, 'package.json'), 'utf8')), dir };
    });
}

const FULL_PLAN_DOCUMENT = 'ARCHITECTURE.md';
const NATIVE_WORKSPACES = new Set([
  'apps/agent-app',
  'packages/agent-cli',
]);
const SDK_WINDOWS_WORKSPACES = new Set(['agent-executor', 'agent-file-authority', 'agent-keyring',
  'agent-node-lock', 'agent-process', 'agent-tools', 'agent-transport-link',
  'agent-ui-terminal'].map((name) => `packages/${name}`));
const WINDOWS_WORKSPACES = new Set([...NATIVE_WORKSPACES, ...SDK_WINDOWS_WORKSPACES, 'packages/agent-local-host']);
const PRODUCT_WORKSPACES = new Set(['agent-cli', 'agent-gui-web', 'agent-local-host',
  'agent-organization-host', 'agent-provider-replay'].map((name) => `packages/${name}`));
const needsNative = (plan) => plan.full || plan.checks.some((dir) => NATIVE_WORKSPACES.has(dir));
const needsWindows = (plan) => plan.full || plan.windows === true;
const needsSdkWindows = (plan) => plan.full || (needsWindows(plan) && (plan.windowsChecks?.length ?? 0) > 0);

export function isDeveloperDocument(file) {
  if (file === FULL_PLAN_DOCUMENT) return false;
  return /^[^/]+\.md$/.test(file) || /^\.changeset\/[^/]+\.md$/.test(file) ||
    /^(?:\.agents|\.claude)\/.*\.md$/.test(file) ||
    /^(?:packages|examples)\/[^/]+\/(?:README\.md|CHANGELOG\.md|docs\/.*\.md)$/.test(file);
}

function withoutImporters(lock, changed) {
  let importers = false;
  let skip = false;
  return lock.split('\n').filter((line) => {
    if (/^\S/u.test(line)) {
      importers = line === 'importers:';
      skip = false;
    } else if (importers && /^  \S/u.test(line)) {
      const match = /^  (?:'([^']+)'|"([^"]+)"|([^:]+)):$/u.exec(line);
      if (!match) throw new Error('Unexpected lockfile importer');
      skip = changed.has(match[1] ?? match[2] ?? match[3]);
    }
    return !skip;
  }).join('\n').trimEnd();
}

function onlyLinkedWorkspaceRangesChanged(previous, current) {
  const normalize = (manifest) => {
    const copy = structuredClone(manifest);
    delete copy.version;
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'])
      for (const [name, range] of Object.entries(copy[section] ?? {}))
        if (range === 'workspace:*' || range === 'workspace:^') copy[section][name] = 'workspace:linked';
    return JSON.stringify(copy);
  };
  return normalize(previous) === normalize(current);
}

export function selectScope({
  cwd = process.cwd(),
  event,
  base,
}) {
  const all = workspaces(cwd);
  let windowsChecks = [];
  const full = (reason) => ({
    full: true,
    developerDocs: false,
    reason,
    checks: all.map((p) => p.dir),
    windowsChecks,
    build: all.filter((p) => p.dir.startsWith('packages/') && p.scripts?.build).map((p) => p.dir),
    docs: true,
  });
  if (event !== 'pull_request' && event !== 'push') return full('manual dispatch');
  try {
    if (process.env.CI_REUSE_MAIN === 'true') {
      const main = git(cwd, 'rev-parse', 'refs/remotes/origin/main');
      if (main === process.env.CI_HEAD_SHA &&
          git(cwd, 'merge-base', base, main) === base &&
          git(cwd, 'rev-parse', 'HEAD^{tree}') === git(cwd, 'rev-parse', `${main}^{tree}`))
        return { full: false, developerDocs: false, reuseMain: true,
          reason: 'fast-forward backmerge of reviewed main', checks: [], build: [], docs: false };
    }
    const comparison = git(cwd, 'merge-base', base, 'HEAD');
    const changes = command(
      'git',
      ['diff', '--name-status', '-z', '--no-renames', comparison, 'HEAD'],
      cwd,
      true,
    ).split('\0');
    const sdkManifestNeedsWindows = (project, status) => {
      if (status !== 'M') return true;
      try {
        const previous = JSON.parse(git(cwd, 'show', `${comparison}:${project.dir}/package.json`));
        const { dir, ...current } = project;
        return !onlyLinkedWorkspaceRangesChanged(previous, current);
      } catch { return true; }
    };
    windowsChecks = all.filter((p) => p.dir.startsWith('packages/') && !PRODUCT_WORKSPACES.has(p.dir) &&
      changes.some((file, index) => {
        if (index % 2 !== 1 || !file.startsWith(`${p.dir}/`) || isDeveloperDocument(file)) return false;
        return file !== `${p.dir}/package.json` || sdkManifestNeedsWindows(p, changes[index - 1]);
      })).map((p) => p.dir);
    const changed = new Set();
    const manifests = new Set();
    const changedFiles = [];
    let lockChanged = false;
    let docs = false;
    let developerDocs = false;
    let windows = false;
    for (let index = 0; index < changes.length - 1; index += 2) {
      const status = changes[index];
      const file = changes[index + 1];
      if (file === 'pnpm-lock.yaml' && status === 'M') {
        lockChanged = true;
        continue;
      }
      if (file === FULL_PLAN_DOCUMENT) return full('runtime-platform lists: ARCHITECTURE.md');
      if (isDeveloperDocument(file)) {
        developerDocs = true;
        continue;
      }
      if (file.startsWith('content/')) {
        docs = true;
        continue;
      }
      const project = all.find((p) => file.startsWith(`${p.dir}/`));
      if (!project) return full(`unmapped input: ${file}`);
      windows ||= WINDOWS_WORKSPACES.has(project.dir) || /(?:windows|win32)/i.test(file);
      if (file === `${project.dir}/package.json` && project.dir.startsWith('packages/') &&
          !PRODUCT_WORKSPACES.has(project.dir) && sdkManifestNeedsWindows(project, status)) windows = true;
      changedFiles.push(`:(literal)${file}`);
      if (file === `${project.dir}/package.json`) {
        if (status !== 'M') return full(`workspace manifest: ${file}`);
        const previous = JSON.parse(git(cwd, 'show', `${comparison}:${file}`));
        if (previous.name !== project.name)
          return full(`workspace identity: ${file}`);
        manifests.add(project.dir);
      }
      changed.add(project.dir);
      if (project.dir === 'apps/docs' || /^packages\/.*\/docs\//.test(file)) docs = true;
    }
    if (lockChanged && (!manifests.size ||
        withoutImporters(git(cwd, 'show', `${comparison}:pnpm-lock.yaml`), manifests) !==
        withoutImporters(readFileSync(path.join(cwd, 'pnpm-lock.yaml'), 'utf8'), manifests)))
      return full('shared lockfile resolution changed');
    if (!windows && changedFiles.length) {
      const scan = spawnSync('git', ['grep', '-iqIE',
        '(^|[^[:alnum:]_])(windows|win32|powershell)([^[:alnum:]_]|$)|process[.]platform|os[.]platform',
        comparison, 'HEAD', '--', ...changedFiles], { cwd });
      if (scan.status === 0) windows = true;
      else if (scan.status !== 1) return full('Windows scope scan failed');
    }
    if (docs) {
      if (!all.some((p) => p.dir === 'apps/docs')) return full('missing docs consumer');
      changed.add('apps/docs');
    }
    if (!changed.size)
      return {
        full: false,
        developerDocs: true,
        reason: developerDocs ? 'developer documents only' : 'topology-only ancestry',
        checks: [],
        build: [],
        docs: false,
      };
    const selectors = [...changed].flatMap((dir) => ['--filter', `...{${dir}}`]);
    const affected = workspaces(cwd, selectors);
    if (!affected.length || [...changed].some((dir) => !affected.some((p) => p.dir === dir)))
      return full('incomplete selection');
    const dependencies = workspaces(
      cwd,
      affected.flatMap((p) => ['--filter', `{${p.dir}}...`]),
    );
    return {
      full: false,
      developerDocs: false,
      reason: 'affected workspaces and docs consumer',
      checks: affected.map((p) => p.dir),
      windowsChecks,
      windows,
      build: dependencies
        .filter((p) => p.dir.startsWith('packages/') && p.scripts?.build)
        .map((p) => p.dir),
      docs,
    };
  } catch (error) {
    return full(`scope fallback: ${error.message}`);
  }
}

export function assertGate(needs) {
  if (needs.scope?.result !== 'success') throw new Error('Scope selection did not succeed.');
  const plan = JSON.parse(needs.scope.outputs.plan);
  if (typeof plan.full !== 'boolean' || !Array.isArray(plan.checks)) throw new Error('Invalid scope plan.');
  assertSkippedPlan(plan);
  for (const job of ['workspace-build', 'static-checks', 'tests']) {
    const omitted = plan.developerDocs === true || plan.reuseMain === true;
    const expected = omitted ? 'skipped' : 'success';
    if (needs[job]?.result !== expected)
      throw new Error(`${job}: expected ${expected}, received ${needs[job]?.result}`);
  }
}

export function assertNativeGate(needs) {
  if (needs.scope?.result !== 'success') throw new Error('Native scope selection did not succeed.');
  const plan = JSON.parse(needs.scope.outputs.plan);
  if (typeof plan.developerDocs !== 'boolean' || typeof plan.full !== 'boolean' || !Array.isArray(plan.checks))
    throw new Error('Invalid native scope plan.');
  assertSkippedPlan(plan);
  const expected = needsNative(plan) ? 'success' : 'skipped';
  if (needs['build-bun']?.result !== expected)
    throw new Error(`Native builds: expected ${expected}, received ${needs['build-bun']?.result}`);
  const sdkExpected = needsSdkWindows(plan) && !needsNative(plan) ? 'success' : 'skipped';
  if (needs['sdk-windows']?.result !== sdkExpected)
    throw new Error(`Windows SDK checks: expected ${sdkExpected}, received ${needs['sdk-windows']?.result}`);
}

function assertSkippedPlan(plan) {
  if (plan.developerDocs !== undefined && typeof plan.developerDocs !== 'boolean')
    throw new Error('Invalid developer document selection.');
  if (plan.developerDocs !== true && plan.reuseMain !== true) return;
  if ((plan.reuseMain === true && plan.developerDocs !== false) || plan.full !== false ||
      plan.docs !== false || !Array.isArray(plan.checks) || plan.checks.length ||
      !Array.isArray(plan.build) || plan.build.length)
    throw new Error('Invalid skipped-check selection.');
}

export function assertBuild(metadata, plan, sha, cwd = process.cwd()) {
  if (
    metadata.sha !== sha ||
    JSON.stringify(metadata.build) !== JSON.stringify(plan.build) ||
    metadata.product !== 'cedar'
  ) {
    throw new Error('Build artifact does not match this revision, selection, and product.');
  }
  for (const dir of plan.build)
    if (!existsSync(path.join(cwd, dir, 'dist')))
      throw new Error(`Missing build output: ${dir}/dist`);
}

async function main() {
  const cwd = process.cwd();
  const kind = process.argv[2];
  if (kind === 'scope') {
    const plan = selectScope({
      cwd,
      event: process.env.CI_EVENT,
      base: process.env.CI_BASE,
    });
    let followup = true;
    try {
      followup = process.env.CI_EVENT !== 'push' || !/\n  schedule:\s*\n/.test(git(cwd, 'show', 'refs/remotes/origin/main:.github/workflows/native-windows-ci.yml'));
    } catch { /* Keep develop validation until the schedule is available on main. */ }
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `plan=${JSON.stringify(plan)}\nnative=${needsNative(plan)}\nwindows=${needsWindows(plan)}\nsdk_windows=${needsSdkWindows(plan)}\nfollowup=${followup}\ndeveloper_docs=${plan.developerDocs}\nreuse_main=${plan.reuseMain === true}\n`,
    );
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  if (kind === 'gate') {
    assertGate(JSON.parse(process.env.CI_NEEDS));
    return;
  }
  if (kind === 'native-gate') {
    assertNativeGate(JSON.parse(process.env.CI_NEEDS));
    return;
  }
  const plan = JSON.parse(process.env.CI_PLAN);
  const run = (...args) => command(pnpm, args, cwd, false, 20 * 60_000);
  assertSkippedPlan(plan);
  const archive = path.join(process.env.RUNNER_TEMP, 'workspace-build.tgz');
  if (kind === 'build') {
    if (plan.build.length) run('-r', ...filters(plan.build), 'run', 'build');
    writeFileSync(
      '.ci-build.json',
      JSON.stringify({ sha: git(cwd, 'rev-parse', 'HEAD'), build: plan.build, product: 'cedar' }),
    );
    command(
      'tar',
      ['-czf', archive, '.ci-build.json', ...plan.build.map((dir) => `${dir}/dist`)],
      cwd,
    );
    return;
  }
  command('tar', ['-xzf', archive], cwd);
  assertBuild(
    JSON.parse(readFileSync('.ci-build.json', 'utf8')),
    plan,
    git(cwd, 'rev-parse', 'HEAD'),
  );
  if (kind === 'static') {
    run(
      '-r',
      ...filters(plan.checks),
      '--workspace-concurrency=-1',
      '--if-present',
      'run',
      'typecheck',
    );
    const lintDirs = plan.full ? ['packages', 'apps'] : plan.checks.filter((dir) =>
      dir.startsWith('packages/') || dir.startsWith('apps/'));
    if (lintDirs.length)
      run('exec', 'eslint', ...lintDirs, '--ext', '.ts,.tsx', '--cache', '--no-error-on-unmatched-pattern');
    run('lint:language');
    run('lint:platform');
    run('harness:browser-proof');
    run('deps:check');
    if (plan.docs) run('--filter', './apps/docs', 'build');
  } else if (/^tests-cli-[1-4]$/.test(kind)) {
    if (plan.checks.includes('packages/agent-cli'))
      run('--filter', './packages/agent-cli', 'exec', 'vitest', 'run', '--passWithNoTests',
        `--shard=${kind.at(-1)}/4`);
  } else if (/^tests-rest-[123]$/.test(kind)) {
    const shard = Number(kind.at(-1)) - 1;
    const remaining = plan.checks.filter((dir) => dir !== 'packages/agent-cli')
      .filter((_, index) => index % 3 === shard);
    if (remaining.length)
      run('-r', ...filters(remaining), '--no-sort', '--workspace-concurrency=2',
        '--if-present', 'run', 'test');
    if (plan.full && shard === 0) run('test:scripts');
  } else throw new Error(`Unknown CI job: ${kind}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
