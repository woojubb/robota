import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { parse } from 'yaml';

const root = new URL('../../../.github/workflows/', import.meta.url);
function readWorkflow(name) {
  return parse(
    readFileSync(new URL(name, root), 'utf8')
      .replaceAll('__PROJECT_RELEASE_TAG_PREFIX__', 'release-')
      .replaceAll('__PRODUCT_ARTIFACT_PREFIX__', 'runtime-cli'),
  );
}
const desktop = readWorkflow('release-desktop-app.yml');
const native = readWorkflow('release-bun-binaries.yml');
const codeql = readWorkflow('codeql.yml');
const image = readWorkflow('release-image.yml');
const publish = readWorkflow('publish.yml');
const tagging = readFileSync(new URL('release-tag-on-version-bump.yml', root), 'utf8');
function requiredStepIndex(steps, name) {
  const index = steps.findIndex((step) => step.name === name);
  if (index < 0) throw new Error(`Required release step missing: ${name}`);
  return index;
}

it.each([
  {
    os: 'Linux',
    maintainer: 'Example Product <maintainer@example.com>',
    author: { name: 'Example Product' },
  },
  { os: 'Linux', maintainer: '', author: { name: 'Example Product', email: 'legacy@example.com' } },
  {
    os: 'macOS',
    maintainer: 'Example Product <maintainer@example.com>',
    author: { name: 'Example Product' },
  },
  {
    os: 'Windows',
    maintainer: 'Example Product <maintainer@example.com>',
    author: { name: 'Example Product' },
  },
])(
  'packages $os with the selected maintainer and preserves platform signing options',
  ({ os, maintainer, author }) => {
    const step = desktop.jobs.desktop.steps.find(
      (step) => step.name === 'Package the desktop app (bundles the runtime)',
    );
    expect(step.env.LINUX_PACKAGE_MAINTAINER).toBe('${{ vars.PRODUCT_LINUX_MAINTAINER }}');
    const temp = mkdtempSync(join(tmpdir(), 'desktop-maintainer-'));
    const fixture = join(temp, 'builder.cjs');
    try {
      writeFileSync(
        fixture,
        `
      const { createRequire } = require('node:module');
      const appRequire = createRequire(process.env.APP_MANIFEST);
      const builderRequire = createRequire(appRequire.resolve('electron-builder'));
      const FpmTarget = builderRequire('app-builder-lib/out/targets/FpmTarget.js').default;
      const args = process.argv.slice(2);
      const option = args.find(arg => arg.startsWith('--config.linux.maintainer='));
      const target = {
        options: option ? { maintainer: option.slice('--config.linux.maintainer='.length) } : {},
        packager: {
          info: { metadata: { author: JSON.parse(process.env.FIXTURE_AUTHOR) } },
          appInfo: { linuxPackageName: 'example-product', computePackageUrl: async () => 'https://example.com' },
        },
      };
      (async () => {
        const metadata = process.env.RUNNER_OS === 'Linux'
          ? await FpmTarget.prototype.computeFpmMetaInfoOptions.call(target) : {};
        console.log(JSON.stringify({ args, maintainer: metadata.maintainer }));
      })().catch(error => { console.error(error.message); process.exitCode = 1; });
    `,
      );
      const result = spawnSync(
        'bash',
        ['-c', 'pnpm() { "$FIXTURE_NODE" "$FIXTURE_BUILDER" "$@"; };\n' + step.run],
        {
          encoding: 'utf8',
          env: {
            PATH: process.env.PATH,
            RUNNER_OS: os,
            LINUX_PACKAGE_MAINTAINER: maintainer,
            FIXTURE_NODE: process.execPath,
            FIXTURE_BUILDER: fixture,
            FIXTURE_AUTHOR: JSON.stringify(author),
            APP_MANIFEST: fileURLToPath(
              new URL('../../../apps/agent-app/package.json', import.meta.url),
            ),
          },
        },
      );
      expect(result.status, result.stderr).toBe(0);
      const actual = JSON.parse(result.stdout);
      const args = ['--filter', './apps/agent-app', 'dist:app'];
      if (os === 'macOS') args.push('--config.forceCodeSigning=true');
      if (os === 'Linux' && maintainer) args.push(`--config.linux.maintainer=${maintainer}`);
      expect(actual.args).toEqual(args);
      if (os === 'Linux')
        expect(actual.maintainer).toBe(maintainer || 'Example Product <legacy@example.com>');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  },
);

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

it('independently builds installers from a bound tag with separate release concurrency', () => {
  expect(desktop.on.push.tags).toEqual(['**']);
  expect(desktop.on.workflow_run).toBeUndefined();
  expect(native.on.push.tags).toEqual(['**']);
  expect(desktop.concurrency.group).toContain('desktop-assets-');
  expect(native.concurrency.group).toContain('native-assets-');
  const steps = desktop.jobs.desktop.steps;
  const index = (name) => requiredStepIndex(steps, name);
  for (const required of [
    'Bind published installers to protected main history',
    'Validate configured release tag',
    'Exercise the packaged runtime',
  ]) {
    expect(() =>
      requiredStepIndex(
        steps.filter((step) => step.name !== required),
        required,
      ),
    ).toThrow('Required release step missing');
  }
  expect(index('Bind published installers to protected main history')).toBeLessThan(
    index('Install dependencies'),
  );
  expect(index('Validate configured release tag')).toBeLessThan(
    index('Compile the host CLI binary'),
  );
  expect(index('Compile the host CLI binary')).toBeLessThan(
    index('Package the desktop app (bundles the runtime)'),
  );
  expect(index('Exercise the packaged runtime')).toBeLessThan(
    index('Publish installers to the GitHub Release'),
  );
  const publish = steps[index('Publish installers to the GitHub Release')];
  expect(publish.run).toMatch(/gh release create[\s\S]+\|\|[\s\S]+gh release view/u);
  expect(publish.run).toContain('gh release upload');
  expect(publish.env.MANIFEST).toContain('SHA256SUMS-desktop-');
  expect(
    native.jobs['publish-bun'].steps.find((step) => step.name === 'Publish all six assets once')
      .run,
  ).toContain('SHA256SUMS.txt');
  expect(tagging).not.toMatch(/\bsleep\s+\d+/u);
});

it('recovers when another release job creates the same tag during desktop publication', () => {
  const step = desktop.jobs.desktop.steps.find(
    (item) => item.name === 'Publish installers to the GitHub Release',
  );
  const fixture = mkdtempSync(join(tmpdir(), 'release-create-race-'));
  try {
    const trace = join(fixture, 'trace');
    const shell =
      `gh() {
      printf '%s\\n' "$*" >> "$TRACE";
      if [ "$2" = view ]; then
        if [ ! -f "$TRACE.viewed" ]; then touch "$TRACE.viewed"; return 1; fi
        return 0
      fi
      if [ "$2" = create ]; then return 1; fi
      return 0
    }\n` + step.run;
    const result = spawnSync('bash', ['-c', shell], {
      cwd: fixture,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        TRACE: trace,
        TAG: 'release-1',
        GH_REPO: 'owner/repo',
        NOTES: 'notes',
        ASSETS: 'desktop.dmg',
        MANIFEST: 'SHA256SUMS-desktop-macos.txt',
      },
    });
    expect(result.status, result.stderr).toBe(0);
    const calls = readFileSync(trace, 'utf8');
    expect(calls).toContain('release create release-1');
    expect(calls).toContain('release upload release-1');
    expect(calls).toContain('SHA256SUMS-desktop-macos.txt');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

it('starts the image only after npm publication and never polls between workflows', () => {
  expect(image.on.push).toBeUndefined();
  expect(image.on.workflow_run).toEqual({ workflows: [publish.name], types: ['completed'] });
  const github = context({
    event: 'workflow_dispatch',
    head_branch: 'main',
    head_repository: { full_name: 'example/runtime' },
  });
  expect(evaluate(image.jobs.resolve.if, github)).toBe(true);
  for (const workflow of [
    tagging,
    readFileSync(new URL('publish.yml', root), 'utf8'),
    readFileSync(new URL('release-image.yml', root), 'utf8'),
    readFileSync(new URL('release-desktop-app.yml', root), 'utf8'),
  ]) {
    expect(workflow).not.toMatch(/\ballow-runner-wait\b/u);
    expect(workflow).not.toMatch(/\bsleep\s+\d+/u);
    expect(workflow).not.toContain('360');
  }
});

it('bounds every local workflow job with a small timeout', () => {
  for (const name of [
    'ci.yml',
    'ci-check.yml',
    'codeql.yml',
    'gitleaks.yml',
    'publish.yml',
    'release-bun-binaries.yml',
    'release-desktop-app.yml',
    'release-image.yml',
    'release-tag-on-version-bump.yml',
  ]) {
    const workflow = readWorkflow(name);
    for (const [jobName, job] of Object.entries(workflow.jobs)) {
      if (job.uses) continue;
      expect(job['timeout-minutes'], `${name}:${jobName}`).toBeDefined();
      const rendered = String(job['timeout-minutes']);
      expect(rendered, `${name}:${jobName}`).not.toContain('360');
      for (const number of rendered.match(/\d+/gu) ?? []) {
        expect(Number(number), `${name}:${jobName}`).toBeLessThanOrEqual(60);
      }
    }
  }
});

it('uses the selected tag for each independent desktop job', () => {
  for (const job of ['desktop', 'await-published-assets', 'verify-macos-artifacts']) {
    const resolve = desktop.jobs[job].steps.find((step) => step.name === 'Resolve release tag');
    expect(resolve.env.INPUT_TAG).toBe('${{ github.event.inputs.tag }}');
    expect(resolve.env.REF_NAME).toBe('${{ github.ref_name }}');
    expect(resolve.run).toContain('${INPUT_TAG:-$REF_NAME}');
  }
});

it('removes unpublished candidate controls and preserves verification-only dispatches', () => {
  expect(desktop.on.workflow_dispatch.inputs.publish).toBeUndefined();
  expect(desktop.on.workflow_dispatch.inputs.source_ref).toBeUndefined();
  expect(desktop.on.workflow_dispatch.inputs.candidate_platform).toBeUndefined();
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

it('verifies published native and desktop artifacts before macOS acceptance', () => {
  const job = desktop.jobs['await-published-assets'];
  const check = job.steps.find((step) => step.name === 'Require every macOS asset');
  expect(check).toBeDefined();
  expect(check.run).toContain('darwin-arm64');
  expect(check.run).toContain('darwin-x64');
  expect(check.run).toContain('SHA256SUMS.txt');
  expect(check.run).toContain('\\.dmg');
  expect(desktop.jobs['verify-macos-artifacts'].needs).toEqual(['await-published-assets']);
});

// Execute the publishing step's real shell guard, without checking out or publishing anything.
it.each(['cedar-v', 'amber-v', 'v', 'runtime.release-'])(
  'accepts the selected release prefix %s and rejects another product tag',
  (prefix) => {
    const resolve = native.jobs['publish-bun'].steps.find(
      (step) => step.name === 'Resolve release tag',
    );
    const run = (tag) =>
      spawnSync('bash', ['-c', resolve.run], {
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH,
          INPUT_TAG: tag,
          REF_NAME: '',
          PROJECT_RELEASE_TAG_PREFIX: prefix,
          GITHUB_OUTPUT: '/dev/null',
        },
      });
    expect(run(`${prefix}3.0.0-beta.86`).status).toBe(0);
    expect(run('another-product-3.0.0-beta.86').status).toBe(1);
  },
);

it('refuses automatic installer publication for a tag outside the selected product', () => {
  const guard = desktop.jobs.desktop.steps.find(
    (step) => step.name === 'Validate configured release tag',
  );
  const run = (tag) =>
    spawnSync('bash', ['-c', guard.run], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, TAG: tag, PROJECT_RELEASE_TAG_PREFIX: 'cedar-v' },
    });
  expect(run('cedar-v3.0.0-beta.86').status).toBe(0);
  expect(run('amber-v3.0.0-beta.86').status).toBe(1);
  expect(run('develop').status).toBe(1);
});

it('carries the release repository into publication from a generated workspace without Git metadata', () => {
  const step = desktop.jobs.desktop.steps.find(
    (step) => step.name === 'Publish installers to the GitHub Release',
  );
  const repository =
    step.env.GH_REPO === undefined ? undefined : evaluate(step.env.GH_REPO, context());
  const result = spawnSync(
    'bash',
    [
      '-c',
      'gh() { while [ "$#" -gt 0 ]; do if [ "$1" = --repo ]; then test "$2" = "example/runtime"; return; fi; shift; done; return 1; };\n' +
        step.run,
    ],
    {
      cwd: '/tmp',
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        GH_REPO: repository,
        TAG: 'release-1.0.0',
        NOTES: '/tmp/notes',
        ASSETS: 'release/*.dmg',
        MANIFEST: 'release/checksums.txt',
      },
    },
  );
  expect(result.status).toBe(0);
});

it('does not require product release configuration or credentials when the version is unchanged', () => {
  const workflow = readWorkflow('release-tag-on-version-bump.yml');
  const steps = workflow.jobs['tag-on-bump'].steps;
  const resolve = steps.find((step) => step.name === 'Resolve the version change');
  const version = JSON.parse(
    readFileSync(new URL('../../../packages/agent-cli/package.json', import.meta.url), 'utf8'),
  ).version;
  const temp = mkdtempSync(join(tmpdir(), 'unchanged-release-'));
  const output = join(temp, 'output');
  try {
    writeFileSync(output, '');
    const result = spawnSync(
      'bash',
      ['-c', 'git() { printf "%s\\n" "$PREVIOUS_MANIFEST"; };\n' + resolve.run],
      {
        cwd: fileURLToPath(new URL('../../../', import.meta.url)),
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH,
          GITHUB_OUTPUT: output,
          PREVIOUS_MANIFEST: JSON.stringify({ version }),
        },
      },
    );
    expect(result.status).toBe(0);
    expect(readFileSync(output, 'utf8')).toContain('bumped=false');
    const github = context();
    github.event_name = 'push';
    const outputs = {
      resolve: { outputs: { bumped: 'false' } },
      push: { outputs: { pushed: 'false' } },
    };
    for (const step of steps.slice(steps.indexOf(resolve) + 1)) {
      expect(step.if, step.name ?? step.uses ?? step.run).toBeDefined();
      expect(evaluate(step.if, github, outputs)).toBe(false);
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

it.each([
  ['true', undefined],
  ['false', 'true'],
])('requires explicit release configuration for bump=%s dry_run=%s', (bumped, dryRun) => {
  const workflow = readWorkflow('release-tag-on-version-bump.yml');
  const steps = workflow.jobs['tag-on-bump'].steps;
  const github = context({}, { dry_run: dryRun });
  github.event_name = dryRun ? 'workflow_dispatch' : 'push';
  const selection = steps.find((step) => step.name === 'Generate selected product workspace');
  expect(evaluate(selection.if, github, { resolve: { outputs: { bumped } } })).toBe(true);
  const result = spawnSync('bash', ['-c', selection.run], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH },
  });
  expect(result.status).toBe(1);
  expect(result.stdout).toContain('PRODUCT_BUILD_ENV');
  const tag = steps.find((step) => step.name === 'Resolve configured release tag');
  const invalid = spawnSync('bash', ['-c', tag.run], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, CUR: '1.0.0', TAG_PREFIX: '' },
  });
  expect(invalid.status).toBe(1);
  expect(invalid.stdout).toContain('PROJECT_RELEASE_TAG_PREFIX');
});

it.each([
  { private: false, owner: { type: 'User' }, expected: true },
  { private: true, owner: { type: 'User' }, expected: false },
  { private: false, owner: { type: 'Organization' }, expected: true },
  { private: true, owner: { type: 'Organization' }, expected: true },
])(
  'preserves supported CodeQL targets and excludes personal private repositories: %j',
  ({ expected, ...repository }) => {
    const condition = codeql.jobs.analyze.if;
    const selected =
      condition === undefined ? true : evaluate(condition, { event: { repository } });
    expect(selected).toBe(expected);
  },
);
