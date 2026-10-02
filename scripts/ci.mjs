import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
function command(executable, args, cwd, capture = false) {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
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

export function selectScope({ cwd = process.cwd(), event, base }) {
  const all = workspaces(cwd);
  const full = (reason) => ({
    full: true,
    developerDocs: false,
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
  for (const job of ['workspace-build', 'static-checks', 'tests', 'release-checks']) {
    const omitted =
      (job === 'release-checks' && plan.release === false) ||
      (plan.developerDocs === true && ['workspace-build', 'static-checks'].includes(job));
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
  const expected = plan.developerDocs ? 'skipped' : 'success';
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
    !Array.isArray(plan.checks) ||
    plan.checks.length ||
    !Array.isArray(plan.build) ||
    plan.build.length
  )
    throw new Error('Invalid developer document selection.');
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
    const plan = selectScope({ cwd, event: process.env.CI_EVENT, base: process.env.CI_BASE });
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `plan=${JSON.stringify(plan)}\nrelease=${plan.release}\ndeveloper_docs=${plan.developerDocs}\n`,
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
  const run = (...args) => command(pnpm, args, cwd);
  assertDeveloperDocs(plan);
  if (kind === 'tests' && plan.developerDocs === true) {
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
    command(pnpm, ['install', '--frozen-lockfile'], generated);
    command(pnpm, ['build'], generated);
    command(
      'bash',
      ['scripts/publish/publish-packages.sh', '--skip-build', '--dry-run'],
      generated,
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
    run('-r', ...filters(plan.checks), '--workspace-concurrency=1', '--if-present', 'run', 'test');
    run('test:scripts');
  } else throw new Error(`Unknown CI job: ${kind}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
