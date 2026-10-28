import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
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

function entries(changes) {
  const parsed = [];
  for (let index = 0; index < changes.length - 1; index += 2)
    parsed.push({ status: changes[index], file: changes[index + 1] });
  return parsed;
}

function changesBetween(cwd, base, target = 'HEAD') {
  const comparison = git(cwd, 'merge-base', base, target);
  return command(
    'git',
    ['diff', '--name-status', '-z', '--no-renames', comparison, target],
    cwd,
    true,
  ).split('\0');
}

export function releaseMetadataCandidate(changes, projects) {
  const changed = entries(changes);
  const generatedWorkspaceFiles = new Set(
    projects.flatMap(({ dir }) => [`${dir}/package.json`, `${dir}/CHANGELOG.md`]),
  );
  const allowed = ({ status, file }) => {
    if (file === '.changeset/pre.json' || file === 'pnpm-lock.yaml') return status === 'M';
    if (file === 'devcontainer-features/src/robota/devcontainer-feature.json')
      return status === 'M';
    if (/^\.changeset\/[^/]+\.md$/u.test(file)) return ['M', 'D'].includes(status);
    return status === 'M' && generatedWorkspaceFiles.has(file);
  };
  const required = [
    '.changeset/pre.json',
    'pnpm-lock.yaml',
    'packages/agent-cli/package.json',
    'packages/agent-core/package.json',
    'devcontainer-features/src/robota/devcontainer-feature.json',
  ];
  return (
    changed.length > 0 &&
    changed.every(allowed) &&
    required.every((file) => changed.some((entry) => entry.file === file && entry.status === 'M'))
  );
}

export async function verifyGeneratedRelease({
  cwd = process.cwd(),
  base,
  target = 'HEAD',
  generateImpl,
}) {
  const root = mkdtempSync(path.join(tmpdir(), 'robota-release-version-'));
  const checkout = path.join(root, 'checkout');
  let attached = false;
  try {
    command('git', ['worktree', 'add', '--detach', '--quiet', checkout, base], cwd, false, 30_000);
    attached = true;
    if (generateImpl) await generateImpl(checkout);
    else {
      if (!existsSync(path.join(checkout, 'node_modules', '.bin', 'changeset')))
        command(
          pnpm,
          ['install', '--frozen-lockfile', '--ignore-scripts', '--filter', '.'],
          checkout,
          false,
          2 * 60_000,
        );
      command(
        process.execPath,
        [path.join(checkout, 'scripts/release/version.mjs'), '--workspace', checkout],
        checkout,
        false,
        3 * 60_000,
      );
    }
    const untracked = git(cwd, '-C', checkout, 'ls-files', '--others', '--exclude-standard');
    if (untracked) return false;
    const generated = command(
      'git',
      ['-C', checkout, 'diff', '--binary', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/'],
      cwd,
      true,
    );
    const expected = command(
      'git',
      [
        'diff',
        '--binary',
        '--no-ext-diff',
        '--src-prefix=a/',
        '--dst-prefix=b/',
        base,
        target,
        '--',
      ],
      cwd,
      true,
    );
    return generated === expected;
  } catch {
    return false;
  } finally {
    if (attached)
      try {
        command('git', ['worktree', 'remove', '--force', checkout], cwd, false, 30_000);
      } catch {
        // The verification already fails closed; prune removes a stale administrative entry later.
        try {
          command('git', ['worktree', 'prune'], cwd, false, 30_000);
        } catch {}
      }
    rmSync(root, { recursive: true, force: true });
  }
}

export function releaseMetadataPlan(
  changes,
  { projects = [], headRef, baseRef, releaseVerified = false, promotionVerified = false } = {},
) {
  const promotion = headRef === 'develop' && baseRef === 'main';
  if (
    promotion
      ? !promotionVerified
      : !releaseVerified || !releaseMetadataCandidate(changes, projects)
  )
    return undefined;
  return {
    full: false,
    developerDocs: false,
    releaseMetadata: true,
    promotion,
    reason: promotion ? 'protected develop release promotion' : 'generated release metadata',
    checks: [],
    build: [],
    docs: false,
    release: true,
  };
}

export async function verifyPromotionChecks({
  cwd = process.cwd(),
  base,
  headSha,
  repository,
  apiUrl = 'https://api.github.com',
  fetchImpl = fetch,
  verifyReleaseImpl = verifyGeneratedRelease,
}) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository ?? '')) return false;
  if (!/^[0-9a-f]{40}$/u.test(headSha ?? '')) return false;
  let endpoint;
  try {
    endpoint = new URL(apiUrl);
  } catch {
    return false;
  }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) return false;
  try {
    const comparison = git(cwd, 'merge-base', base, headSha);
    const commits = git(cwd, 'rev-list', '--first-parent', '--reverse', `${comparison}..${headSha}`)
      .split('\n')
      .filter(Boolean);
    if (!commits.length) return false;
    let generatedReleases = 0;
    for (const sha of commits) {
      const parents = git(cwd, 'show', '-s', '--format=%P', sha).split(' ').filter(Boolean);
      if (parents.length !== 2) return false;
      const reviewedHead = parents[1];
      const response = await fetchImpl(
        new URL(
          `repos/${repository}/commits/${reviewedHead}/check-runs?per_page=100`,
          `${endpoint.toString().replace(/\/$/u, '')}/`,
        ),
        {
          headers: { Accept: 'application/vnd.github+json' },
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!response.ok) return false;
      const runs = (await response.json()).check_runs ?? [];
      for (const name of ['pr-validation', 'security']) {
        if (!runs.some((run) => run.name === name && run.conclusion === 'success')) return false;
      }
      const before = JSON.parse(git(cwd, 'show', `${parents[0]}:packages/agent-cli/package.json`));
      const after = JSON.parse(git(cwd, 'show', `${sha}:packages/agent-cli/package.json`));
      if (before.version !== after.version) {
        if (!(await verifyReleaseImpl({ cwd, base: parents[0], target: sha }))) return false;
        generatedReleases += 1;
      }
    }
    return generatedReleases === 1;
  } catch {
    return false;
  }
}

export function selectScope({
  cwd = process.cwd(),
  event,
  base,
  headRef,
  baseRef,
  releaseVerified = false,
  promotionVerified = false,
}) {
  const all = workspaces(cwd);
  const full = (reason) => ({
    full: true,
    developerDocs: false,
    releaseMetadata: false,
    promotion: false,
    reason,
    checks: all.map((p) => p.dir),
    build: all.filter((p) => p.dir.startsWith('packages/') && p.scripts?.build).map((p) => p.dir),
    docs: true,
    release: true,
  });
  if (event !== 'pull_request') return full('push or manual dispatch');
  try {
    const comparison = git(cwd, 'merge-base', base, 'HEAD');
    const changes = command(
      'git',
      ['diff', '--name-status', '-z', '--no-renames', comparison, 'HEAD'],
      cwd,
      true,
    ).split('\0');
    const metadata = releaseMetadataPlan(changes, {
      projects: all,
      headRef,
      baseRef,
      releaseVerified,
      promotionVerified,
    });
    if (metadata) return metadata;
    const changed = new Set();
    let docs = false;
    let release = false;
    let developerDocs = false;
    for (let index = 0; index < changes.length - 1; index += 2) {
      const status = changes[index];
      const file = changes[index + 1];
      if (['AGENTS.md', 'HARNESS.md'].includes(file) && ['A', 'M'].includes(status)) {
        developerDocs = true;
        continue;
      }
      if (file.startsWith('content/')) {
        docs = true;
        continue;
      }
      const project = all.find((p) => file.startsWith(`${p.dir}/`));
      if (!project) return full(`unmapped input: ${file}`);
      if (file === `${project.dir}/package.json`) {
        // The eval example adds a test script; dependency/identity changes need the old graph too.
        if (status !== 'M' || !project.dir.startsWith('examples/') || !project.private)
          return full(`workspace manifest: ${file}`);
        const previous = JSON.parse(git(cwd, 'show', `${comparison}:${file}`));
        const omitScripts = ({ scripts, ...manifest }) => manifest;
        const { dir, ...manifest } = project;
        if (JSON.stringify(omitScripts(previous)) !== JSON.stringify(omitScripts(manifest)))
          return full(`workspace contract: ${file}`);
      }
      changed.add(project.dir);
      if (project.dir === 'apps/docs' || /^packages\/.*\/docs\//.test(file)) docs = true;
      if (!project.dir.startsWith('examples/') || !project.private) release = true;
    }
    if (docs) {
      if (!all.some((p) => p.dir === 'apps/docs')) return full('missing docs consumer');
      changed.add('apps/docs');
    }
    if (!changed.size)
      return developerDocs
        ? {
            full: false,
            developerDocs: true,
            releaseMetadata: false,
            promotion: false,
            reason: 'developer documents only',
            checks: [],
            build: [],
            docs: false,
            release: false,
          }
        : full('empty selection');
    const selectors = [...changed].flatMap((dir) => ['--filter', `...{${dir}}`]);
    const affected = workspaces(cwd, selectors);
    if (!affected.length || [...changed].some((dir) => !affected.some((p) => p.dir === dir)))
      return full('incomplete selection');
    const dependencies = workspaces(
      cwd,
      affected.flatMap((p) => ['--filter', `{${p.dir}}...`]),
    );
    if (affected.some((p) => !p.dir.startsWith('examples/') && p.dir !== 'apps/docs'))
      release = true;
    return {
      full: false,
      developerDocs: false,
      releaseMetadata: false,
      promotion: false,
      reason: 'affected workspaces and docs consumer',
      checks: affected.map((p) => p.dir),
      build: dependencies
        .filter((p) => p.dir.startsWith('packages/') && p.scripts?.build)
        .map((p) => p.dir),
      docs,
      release,
    };
  } catch (error) {
    return full(`scope fallback: ${error.message}`);
  }
}

export function assertGate(needs) {
  if (needs.scope?.result !== 'success') throw new Error('Scope selection did not succeed.');
  const plan = JSON.parse(needs.scope.outputs.plan);
  if (typeof plan.release !== 'boolean') throw new Error('Invalid scope plan.');
  assertDeveloperDocs(plan);
  assertReleaseMetadata(plan);
  for (const job of ['workspace-build', 'static-checks', 'tests', 'release-checks']) {
    const omitted =
      (job === 'release-checks' && (plan.release === false || plan.promotion === true)) ||
      (plan.developerDocs === true && ['workspace-build', 'static-checks'].includes(job)) ||
      (plan.releaseMetadata === true &&
        ['workspace-build', 'static-checks', 'tests'].includes(job));
    const expected = omitted ? 'skipped' : 'success';
    if (needs[job]?.result !== expected)
      throw new Error(`${job}: expected ${expected}, received ${needs[job]?.result}`);
  }
}

export function assertNativeGate(needs) {
  if (needs.scope?.result !== 'success') throw new Error('Native scope selection did not succeed.');
  const plan = JSON.parse(needs.scope.outputs.plan);
  if (typeof plan.developerDocs !== 'boolean') throw new Error('Invalid native scope plan.');
  assertDeveloperDocs(plan);
  assertReleaseMetadata(plan);
  const expected = plan.developerDocs || plan.releaseMetadata ? 'skipped' : 'success';
  if (needs['build-bun']?.result !== expected)
    throw new Error(`Native builds: expected ${expected}, received ${needs['build-bun']?.result}`);
}

function assertDeveloperDocs(plan) {
  if (plan.developerDocs === undefined || plan.developerDocs === false) return;
  if (
    plan.developerDocs !== true ||
    plan.full !== false ||
    plan.docs !== false ||
    plan.release !== false ||
    plan.releaseMetadata !== false ||
    plan.promotion !== false ||
    !Array.isArray(plan.checks) ||
    plan.checks.length ||
    !Array.isArray(plan.build) ||
    plan.build.length
  )
    throw new Error('Invalid developer document selection.');
}

function assertReleaseMetadata(plan) {
  if (plan.releaseMetadata === undefined || plan.releaseMetadata === false) {
    if (plan.promotion === true) throw new Error('A promotion must be release metadata.');
    return;
  }
  if (
    plan.releaseMetadata !== true ||
    plan.full !== false ||
    plan.developerDocs !== false ||
    plan.docs !== false ||
    plan.release !== true ||
    typeof plan.promotion !== 'boolean' ||
    !Array.isArray(plan.checks) ||
    plan.checks.length ||
    !Array.isArray(plan.build) ||
    plan.build.length
  )
    throw new Error('Invalid release metadata selection.');
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
    const promotion = process.env.CI_HEAD_REF === 'develop' && process.env.CI_BASE_REF === 'main';
    const promotionVerified = promotion
      ? await verifyPromotionChecks({
          cwd,
          base: process.env.CI_BASE,
          headSha: process.env.CI_HEAD_SHA,
          repository: process.env.CI_REPOSITORY,
          apiUrl: process.env.CI_API_URL,
        })
      : false;
    const changes = changesBetween(cwd, process.env.CI_BASE, process.env.CI_HEAD_SHA);
    const projects = workspaces(cwd);
    const releaseVerified =
      !promotion && releaseMetadataCandidate(changes, projects)
        ? await verifyGeneratedRelease({
            cwd,
            base: git(cwd, 'merge-base', process.env.CI_BASE, process.env.CI_HEAD_SHA),
            target: process.env.CI_HEAD_SHA,
          })
        : false;
    const plan = selectScope({
      cwd,
      event: process.env.CI_EVENT,
      base: process.env.CI_BASE,
      headRef: process.env.CI_HEAD_REF,
      baseRef: process.env.CI_BASE_REF,
      releaseVerified,
      promotionVerified,
    });
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `plan=${JSON.stringify(plan)}\nrelease=${plan.release}\ndeveloper_docs=${plan.developerDocs}\nrelease_metadata=${plan.releaseMetadata}\npromotion=${plan.promotion}\n`,
    );
    console.log(JSON.stringify(plan, null, 2));
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `Scope: ${plan.reason}\n\nChecks: ${plan.checks.join(', ')}\n\nBuild: ${plan.build.join(', ')}\n\nDocs: ${plan.docs}; release: ${plan.release}\n`,
      );
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
  assertDeveloperDocs(plan);
  if (kind === 'tests' && plan.developerDocs === true) {
    // Static checks are skipped for developer documents, but the language rule covers them too.
    run('lint:language');
    run('test:scripts');
    return;
  }
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
  if (kind === 'release') {
    run('exec', 'tsx', 'scripts/product/prepare-workflow-workspace.mjs');
    // GITHUB_ENV is available to subsequent steps only, so use the returned fixed fixture path here.
    const generated = path.join(process.env.RUNNER_TEMP, 'product-workspace');
    command(pnpm, ['install', '--frozen-lockfile'], generated, false, 10 * 60_000);
    command(pnpm, ['build'], generated, false, 10 * 60_000);
    command(
      'bash',
      ['scripts/publish/publish-packages.sh', '--skip-build', '--dry-run'],
      generated,
      false,
      10 * 60_000,
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
    run('lint');
    run('deps:check');
    if (plan.docs) run('--filter', './apps/docs', 'build');
  } else if (kind === 'tests') {
    run(
      '-r',
      ...filters(plan.checks),
      '--no-sort',
      '--workspace-concurrency=2',
      '--if-present',
      'run',
      'test',
    );
    run('test:scripts');
  } else throw new Error(`Unknown CI job: ${kind}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
