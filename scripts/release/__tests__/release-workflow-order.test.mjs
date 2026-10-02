import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { parse } from 'yaml';

const root = new URL('../../../.github/workflows/', import.meta.url);
function readWorkflow(name) {
  return parse(readFileSync(new URL(name, root), 'utf8')
    .replaceAll('__PROJECT_RELEASE_TAG_PREFIX__', 'release-')
    .replaceAll('__PRODUCT_ARTIFACT_PREFIX__', 'runtime-cli'));
}
const desktop = readWorkflow('release-desktop-app.yml');
const native = readWorkflow('release-bun-binaries.yml');
const codeql = readWorkflow('codeql.yml');
const tagging = readFileSync(new URL('release-tag-on-version-bump.yml', root), 'utf8');

function evaluate(expression, github, steps = {}) {
  const source = expression.replace(/^\s*\$\{\{/, '').replace(/\}\}\s*$/, '');
  // These workflow conditions use the JavaScript-compatible subset of GitHub expressions.
  return Function(
    'github',
    'steps',
    'startsWith',
    `return (${source});`,
  )(github, steps, (value, prefix) => typeof value === 'string' && value.startsWith(prefix));
}

function context(overrides = {}, inputs = {}) {
  return {
    event_name: 'workflow_run',
    repository: 'example/runtime',
    ref_name: 'main',
    event: {
      inputs,
      workflow_run: {
        conclusion: 'success',
        event: 'push',
        head_branch: 'release-3.0.0-beta.86',
        head_repository: { full_name: 'example/runtime' },
        ...overrides,
      },
    },
  };
}

it('cannot occupy the shared publisher queue before its native release dependency finishes', () => {
  expect(desktop.on.push).toBeUndefined();
  expect(desktop.on.workflow_run).toEqual({ workflows: [native.name], types: ['completed'] });
  expect(native.on.push.tags).toEqual(['**']);
  expect(tagging).toMatch(/want="release-bun-binaries\.yml"/);
});

it.each([
  { conclusion: 'failure' },
  { conclusion: 'cancelled' },
  { event: 'workflow_dispatch' },
  { head_repository: { full_name: 'someone/runtime' } },
])(
  'refuses an automatic installer publication for an unrelated or unsuccessful native run: %j',
  (run) => {
    expect(evaluate(desktop.jobs.desktop.if, context(run))).toBe(false);
  },
);

it('uses the successful native tag even though workflow_run executes on main', () => {
  const github = context();
  expect(evaluate(desktop.jobs.desktop.if, github)).toBe(true);
  for (const job of ['desktop', 'await-published-assets', 'verify-macos-artifacts']) {
    const resolve = desktop.jobs[job].steps.find((step) => step.name === 'Resolve release tag');
    expect(evaluate(resolve.env.INPUT_TAG, github)).toBe('release-3.0.0-beta.86');
  }
});

it('preserves explicit unpublished candidates and verification-only dispatches', () => {
  const candidate = context({}, { publish: 'false' });
  candidate.event_name = 'workflow_dispatch';
  expect(evaluate(desktop.jobs.desktop.if, candidate)).toBe(true);
  const verification = context({}, { verify_only: 'true' });
  verification.event_name = 'workflow_dispatch';
  expect(evaluate(desktop.jobs.desktop.if, verification)).toBe(false);
});

it('does not let read-only verification hold the native publisher queue', () => {
  const github = context({}, { verify_only: 'true', tag: 'release-3.0.0-beta.86' });
  github.event_name = 'workflow_dispatch';
  const render = (group) =>
    group.replace(/\$\{\{([\s\S]*?)\}\}/g, (_match, source) => evaluate(source, github));
  expect(render(desktop.concurrency.group)).not.toBe(render(native.concurrency.group));
});

it('fails a manual published build immediately when any native payload is absent', () => {
  const preflight = desktop.jobs.desktop.steps.find(
    (step) => step.name === 'Require the native release before publishing installers',
  );
  expect(preflight).toBeDefined();
  expect(evaluate(preflight.if, context({}, { publish: 'false' }))).toBe(false);
  expect(evaluate(preflight.if, context({}, { publish: 'true' }))).toBe(true);
  const expression = native.jobs['build-bun'].strategy.matrix.target;
  const targets = Function('github', 'fromJSON', `return (${expression.slice(3, -2)});`)(
    { event_name: 'workflow_dispatch' }, JSON.parse,
  );
  const names = targets.map((target) => `runtime-cli-${target}${target.startsWith('windows') ? '.exe' : ''}`);
  names.push('SHA256SUMS.txt');
  const run = (assets) =>
    spawnSync('bash', ['-c', 'gh() { printf "%s\\n" "$FIXTURE_ASSETS"; };\n' + preflight.run], {
      encoding: 'utf8',
      cwd: fileURLToPath(new URL('../../../', import.meta.url)),
    env: { PATH: process.env.PATH, TAG: 'release-3.0.0-beta.86', PRODUCT_ARTIFACT_PREFIX: 'runtime-cli', FIXTURE_ASSETS: assets.join('\n') },
    });
  expect(run(names).status).toBe(0);
  const missing = run(names.filter((name) => name !== 'runtime-cli-darwin-arm64'));
  expect(missing.status).toBe(1);
  expect(missing.stdout).toMatch(/release-bun-binaries\.yml/);
  for (const dottedName of ['runtime-cli-windows-x64.exe', 'SHA256SUMS.txt']) {
    const lookalike = run(
      names.map((name) => (name === dottedName ? name.replace('.', '_') : name)),
    );
    expect(lookalike.status).toBe(1);
    expect(lookalike.stdout).toContain(`Native release asset ${dottedName} is missing`);
  }
});

// Execute the publishing step's real shell guard, without checking out or publishing anything.
it.each(['cedar-v', 'amber-v', 'v', 'runtime.release-'])(
  'accepts the selected release prefix %s and rejects another product tag', (prefix) => {
    const resolve = native.jobs['publish-bun'].steps.find((step) => step.name === 'Resolve release tag');
    const run = (tag) => spawnSync('bash', ['-c', resolve.run], {
      encoding: 'utf8', env: { PATH: process.env.PATH, INPUT_TAG: tag, REF_NAME: '',
        PROJECT_RELEASE_TAG_PREFIX: prefix, GITHUB_OUTPUT: '/dev/null' },
    });
    expect(run(`${prefix}3.0.0-beta.86`).status).toBe(0);
    expect(run('another-product-3.0.0-beta.86').status).toBe(1);
  },
);

it('refuses automatic installer publication for a tag outside the selected product', () => {
  const guard = desktop.jobs.desktop.steps.find((step) => step.name === 'Validate configured release tag');
  const run = (tag) => spawnSync('bash', ['-c', guard.run], {
    encoding: 'utf8', env: { PATH: process.env.PATH, TAG: tag, PROJECT_RELEASE_TAG_PREFIX: 'cedar-v' },
  });
  expect(run('cedar-v3.0.0-beta.86').status).toBe(0);
  expect(run('amber-v3.0.0-beta.86').status).toBe(1);
  expect(run('develop').status).toBe(1);
});

it('carries the release repository into publication from a generated workspace without Git metadata', () => {
  const step = desktop.jobs.desktop.steps.find((step) => step.name === 'Publish installers to the GitHub Release');
  const repository = step.env.GH_REPO === undefined ? undefined : evaluate(step.env.GH_REPO, context());
  const result = spawnSync('bash', ['-c', 'gh() { while [ "$#" -gt 0 ]; do if [ "$1" = --repo ]; then test "$2" = "example/runtime"; return; fi; shift; done; return 1; };\n' + step.run], {
    cwd: '/tmp', encoding: 'utf8', env: { PATH: process.env.PATH, GH_REPO: repository,
      TAG: 'release-1.0.0', NOTES: '/tmp/notes', ASSETS: 'release/*.dmg', MANIFEST: 'release/checksums.txt' },
  });
  expect(result.status).toBe(0);
});

it('does not require product release configuration or credentials when the version is unchanged', () => {
  const workflow = readWorkflow('release-tag-on-version-bump.yml');
  const steps = workflow.jobs['tag-on-bump'].steps;
  const resolve = steps.find((step) => step.name === 'Resolve the version change');
  const version = JSON.parse(readFileSync(new URL('../../../packages/agent-cli/package.json', import.meta.url), 'utf8')).version;
  const temp = mkdtempSync(join(tmpdir(), 'unchanged-release-'));
  const output = join(temp, 'output');
  try {
    writeFileSync(output, '');
    const result = spawnSync('bash', ['-c', 'git() { printf "%s\\n" "$PREVIOUS_MANIFEST"; };\n' + resolve.run], {
      cwd: fileURLToPath(new URL('../../../', import.meta.url)), encoding: 'utf8',
      env: { PATH: process.env.PATH, GITHUB_OUTPUT: output, PREVIOUS_MANIFEST: JSON.stringify({ version }) },
    });
    expect(result.status).toBe(0);
    expect(readFileSync(output, 'utf8')).toContain('bumped=false');
    const github = context();
    github.event_name = 'push';
    const outputs = { resolve: { outputs: { bumped: 'false' } }, push: { outputs: { pushed: 'false' } } };
    for (const step of steps.slice(steps.indexOf(resolve) + 1)) {
      expect(step.if, step.name ?? step.uses ?? step.run).toBeDefined();
      expect(evaluate(step.if, github, outputs)).toBe(false);
    }
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

it.each([['true', undefined], ['false', 'true']])(
  'requires explicit release configuration for bump=%s dry_run=%s', (bumped, dryRun) => {
    const workflow = readWorkflow('release-tag-on-version-bump.yml');
    const steps = workflow.jobs['tag-on-bump'].steps;
    const github = context({}, { dry_run: dryRun });
    github.event_name = dryRun ? 'workflow_dispatch' : 'push';
    const selection = steps.find((step) => step.name === 'Generate selected product workspace');
    expect(evaluate(selection.if, github, { resolve: { outputs: { bumped } } })).toBe(true);
    const result = spawnSync('bash', ['-c', selection.run], { encoding: 'utf8', env: { PATH: process.env.PATH } });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('PRODUCT_BUILD_ENV');
    const tag = steps.find((step) => step.name === 'Resolve configured release tag');
    const invalid = spawnSync('bash', ['-c', tag.run], { encoding: 'utf8', env: { PATH: process.env.PATH, CUR: '1.0.0', TAG_PREFIX: '' } });
    expect(invalid.status).toBe(1);
    expect(invalid.stdout).toContain('PROJECT_RELEASE_TAG_PREFIX');
  },
);

it.each([
  { private: false, owner: { type: 'User' }, expected: true },
  { private: true, owner: { type: 'User' }, expected: false },
  { private: false, owner: { type: 'Organization' }, expected: true },
  { private: true, owner: { type: 'Organization' }, expected: true },
])('preserves supported CodeQL targets and excludes personal private repositories: %j', ({ expected, ...repository }) => {
  const condition = codeql.jobs.analyze.if;
  const selected = condition === undefined ? true : evaluate(condition, { event: { repository } });
  expect(selected).toBe(expected);
});
