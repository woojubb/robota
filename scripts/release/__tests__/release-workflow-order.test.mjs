import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { parse } from 'yaml';

const root = new URL('../../../.github/workflows/', import.meta.url);
const desktop = parse(readFileSync(new URL('release-desktop-app.yml', root), 'utf8'));
const native = parse(readFileSync(new URL('release-bun-binaries.yml', root), 'utf8'));
const tagging = readFileSync(new URL('release-tag-on-version-bump.yml', root), 'utf8');

function evaluate(expression, github) {
  const source = expression.replace(/^\s*\$\{\{/, '').replace(/\}\}\s*$/, '');
  // These workflow conditions use the JavaScript-compatible subset of GitHub expressions.
  return Function(
    'github',
    'startsWith',
    `return (${source});`,
  )(github, (value, prefix) => typeof value === 'string' && value.startsWith(prefix));
}

function context(overrides = {}, inputs = {}) {
  return {
    event_name: 'workflow_run',
    repository: 'woojubb/robota',
    ref_name: 'main',
    event: {
      inputs,
      workflow_run: {
        conclusion: 'success',
        event: 'push',
        head_branch: 'v3.0.0-beta.86',
        head_repository: { full_name: 'woojubb/robota' },
        ...overrides,
      },
    },
  };
}

it('cannot occupy the shared publisher queue before its native release dependency finishes', () => {
  expect(desktop.on.push).toBeUndefined();
  expect(desktop.on.workflow_run).toEqual({ workflows: [native.name], types: ['completed'] });
  expect(native.on.push.tags).toEqual(['v*']);
  expect(tagging).toMatch(/want="release-bun-binaries\.yml"/);
});

it.each([
  { conclusion: 'failure' },
  { conclusion: 'cancelled' },
  { event: 'workflow_dispatch' },
  { head_branch: 'develop' },
  { head_repository: { full_name: 'someone/robota' } },
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
    expect(evaluate(resolve.env.INPUT_TAG, github)).toBe('v3.0.0-beta.86');
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
  const github = context({}, { verify_only: 'true', tag: 'v3.0.0-beta.86' });
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
  const names = native.jobs['build-bun'].strategy.matrix.include.map((target) => target.binary);
  names.push('SHA256SUMS.txt');
  const run = (assets) =>
    spawnSync('bash', ['-c', 'gh() { printf "%s\\n" "$FIXTURE_ASSETS"; };\n' + preflight.run], {
      encoding: 'utf8',
      cwd: fileURLToPath(new URL('../../../', import.meta.url)),
      env: { PATH: process.env.PATH, TAG: 'v3.0.0-beta.86', FIXTURE_ASSETS: assets.join('\n') },
    });
  expect(run(names).status).toBe(0);
  const missing = run(names.filter((name) => name !== 'robota-darwin-arm64'));
  expect(missing.status).toBe(1);
  expect(missing.stdout).toMatch(/release-bun-binaries\.yml/);
});
