import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { parse } from 'yaml';

const root = new URL('../../../', import.meta.url);
const workflows = new URL('../../../.github/workflows/', import.meta.url);
const readWorkflow = (name) => parse(readFileSync(new URL(name, workflows), 'utf8'));
const stepIndex = (steps, predicate) => steps.findIndex(predicate);
function expectStepBefore(steps, first, second) {
  const firstIndex = stepIndex(steps, first);
  const secondIndex = stepIndex(steps, second);
  expect(firstIndex).toBeGreaterThanOrEqual(0);
  expect(secondIndex).toBeGreaterThanOrEqual(0);
  expect(firstIndex).toBeLessThan(secondIndex);
}

it('binds an SDK tag to the selected package and its own version', () => {
  const dir = mkdtempSync(join(tmpdir(), 'package-release-tag-'));
  try {
    for (const [name, version, isPrivate] of [
      ['agent-core', '1.2.3', false], ['agent-keyring', '4.5.6', false], ['agent-cli', '9.0.0', false],
      ['private-package', '1.0.0', true],
    ]) {
      const pkg = join(dir, 'packages', name);
      mkdirSync(pkg, { recursive: true });
      writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: `@robota-sdk/${name}`, version, private: isPrivate }));
    }
    const script = readWorkflow('publish.yml').jobs.prepare.steps.find(
      (step) => step.name === 'Validate the tag and canonical product identity before publication',
    ).run;
    const run = (selected, tag, component = 'sdk') => spawnSync('bash', ['-c', script], {
      cwd: dir, encoding: 'utf8', env: { ...process.env, RELEASE_COMPONENT: component,
        RELEASE_PACKAGE: selected, TAG: tag, PRODUCT_PACKAGE_SCOPE: '@robota-sdk',
        PROJECT_RELEASE_TAG_PREFIX: 'v', PROJECT_NPM_REGISTRY_URL: 'https://registry.example',
        PRODUCT_CONFIG_SHA256: 'a'.repeat(64) },
    });
    expect(run('agent-core', 'sdk-agent-core-v1.2.3').status).toBe(0);
    expect(run('agent-keyring', 'sdk-agent-keyring-v4.5.6').status).toBe(0);
    expect(run('', 'v9.0.0', 'cli').status).toBe(0);
    expect(run('agent-core', 'sdk-agent-core-v4.5.6').status).not.toBe(0);
    expect(run('agent-keyring', 'sdk-agent-core-v1.2.3').status).not.toBe(0);
    expect(run('../agent-core', 'sdk-agent-core-v1.2.3').status).not.toBe(0);
    expect(run('private-package', 'sdk-private-package-v1.0.0').status).not.toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('binds an independent app tag to its desktop version and schedules its verification', () => {
  const dir = mkdtempSync(join(tmpdir(), 'app-release-tag-'));
  try {
    mkdirSync(join(dir, 'apps/agent-app'), { recursive: true });
    writeFileSync(join(dir, 'apps/agent-app/package.json'), JSON.stringify({ version: '4.5.6' }));
    const workflow = readWorkflow('release-desktop-app.yml');
    const script = workflow.jobs.desktop.steps.find((step) => step.name === 'Validate configured release tag').run;
    const run = (tag) => spawnSync('bash', ['-c', script], { cwd: dir, encoding: 'utf8', env: {
      ...process.env, TAG: tag, PRODUCT_WORKSPACE: dir, PROJECT_RELEASE_TAG_PREFIX: 'v', GITHUB_ENV: join(dir, 'env'),
    } });
    expect(run('app-v4.5.6').status).toBe(0);
    expect(run('app-v4.5.7').status).not.toBe(0);
    expect(run('sdk-agent-core-v4.5.6').status).not.toBe(0);
    for (const job of ['desktop', 'await-published-assets']) {
      const resolveTag = workflow.jobs[job].steps.find((step) => step.name === 'Resolve release tag').run;
      const resolve = (event, tag) => spawnSync('bash', ['-c', resolveTag], { cwd: dir, encoding: 'utf8', env: {
        ...process.env, GITHUB_EVENT_NAME: event, INPUT_TAG: tag, REF_NAME: tag, GITHUB_OUTPUT: join(dir, 'output'),
      } });
      expect(resolve('push', 'app-v4.5.6').status).toBe(0);
      expect(resolve('workflow_dispatch', 'app-v4.5.6').status).not.toBe(0);
      expect(resolve('workflow_dispatch', 'v4.5.6').status).toBe(0);
    }
    const condition = workflow.jobs['await-published-assets'].if.slice(3, -2);
    const evaluate = Function('github', 'needs', 'cancelled', 'startsWith', `return (${condition});`);
    const event = { event_name: 'push', ref: 'refs/tags/app-v4.5.6', event: { inputs: {} } };
    const passes = (desktop) => evaluate(event, { desktop: { result: desktop } }, () => false, (value, prefix) => value.startsWith(prefix));
    expect(passes('success')).toBe(true);
    expect(passes('failure')).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('admits release effects only after binding them to reviewed source', () => {
  const publish = readWorkflow('publish.yml');
  expect(publish.concurrency.group).toBe("npm-publish-${{ inputs.component }}-${{ inputs.package || 'agent-cli' }}");
  expect(publish.on.workflow_dispatch.inputs.tag.required).toBe(true);
  expect(publish.on.workflow_dispatch.inputs.product_env).toBeUndefined();
  expect(publish.jobs.publish.permissions.contents).toBe('read');
  const prepareSteps = publish.jobs.prepare.steps;
  const publishSteps = publish.jobs.publish.steps;
  for (const steps of [prepareSteps, publishSteps]) {
    expect(
      steps.find((step) => step.uses === 'actions/checkout@v7').with['persist-credentials'],
    ).toBe(false);
  }
  expectStepBefore(
    prepareSteps,
    (step) => step.name === 'Bind publication to the release tag and protected main',
    (step) => step.uses === 'pnpm/action-setup@v6',
  );
  expectStepBefore(
    prepareSteps,
    (step) => step.name === 'Validate the tag and canonical product identity before publication',
    (step) => step.name === 'Prepare the configured product packages once',
  );
  expect(publish.jobs.publish.needs).toBe('prepare');
  expect(
    publishSteps.find((step) => step.uses === 'actions/download-artifact@v7').with['artifact-ids'],
  ).toBe('${{ needs.prepare.outputs.artifact_id }}');
  expectStepBefore(
    publishSteps,
    (step) => step.name === 'Restore the exact prepared publication',
    (step) => step.name === 'Publish only missing packages from the retained tarballs',
  );
  const restore = publishSteps.find(
    (step) => step.name === 'Restore the exact prepared publication',
  ).run;
  expect(restore).toContain('data.RELEASE_SOURCE_COMMIT !== process.env.GITHUB_SHA');
  expect(restore).toContain('data.RELEASE_TAG !== process.env.TAG');
  expect(
    publishSteps.some((step) => step.name === 'Preserve the tag-bound registry integrity manifest'),
  ).toBe(true);
  expect(publishSteps.some((step) => step.name === 'Attest the durable release receipt')).toBe(
    true,
  );
  expect(publish.jobs.receipt.permissions.contents).toBe('write');
  expect(publish.jobs.receipt.needs).toBe('publish');
  const receiptPublish = publish.jobs.receipt.steps.find(
    (step) => step.name === 'Preserve the attested receipt with the release',
  ).run;
  expect(receiptPublish).toContain('gh release create');
  expect(receiptPublish).toMatch(/gh release create[\s\S]+\|\|[\s\S]+gh release view/u);

  const image = readWorkflow('release-image.yml');
  const imageCondition = Function('github', `return (${image.jobs.resolve.if.slice(3, -2)});`);
  const event = (title) => ({ event_name: 'workflow_run', repository: 'owner/repo', event: {
    workflow_run: { conclusion: 'success', display_title: title, event: 'workflow_dispatch',
      head_branch: 'main', head_repository: { full_name: 'owner/repo' } },
  } });
  expect(imageCondition(event('Publish SDK to npm'))).toBe(false);
  expect(imageCondition(event('Publish CLI to npm'))).toBe(true);
  const resolveSteps = image.jobs.resolve.steps;
  expectStepBefore(
    resolveSteps,
    (step) => step.name === 'Bind the published source before executing repository dependencies',
    (step) => step.uses === 'pnpm/action-setup@v6',
  );
  expect(
    resolveSteps.some(
      (step) => step.name === 'Verify npm is the tarball published from this exact tag',
    ),
  ).toBe(true);
  const productGeneration = resolveSteps.find(
    (step) => step.name === 'Generate selected product workspace',
  );
  expect(productGeneration.run).toContain('--github-env "$GITHUB_ENV"');
  const integrity = resolveSteps.find(
    (step) => step.name === 'Verify npm is the tarball published from this exact tag',
  );
  expect(integrity.run).toContain('--source-ref refs/heads/main');
  expect(integrity.run).toContain('--source-digest "$tag_commit"');
  expect(integrity.run).toContain('dependencyNames?.length !== 1');
  expect(image.jobs.image.needs).toBe('resolve');
  expect(image.jobs.image.steps.find((step) => step.uses === 'actions/checkout@v7').with.ref).toBe(
    '${{ needs.resolve.outputs.commit }}',
  );

  const native = readWorkflow('release-bun-binaries.yml');
  expect(native.on.push.tags).toContain('!sdk-*');
  expect(native.on.push.tags).toContain('!app-*');
  const nativeSteps = native.jobs['build-bun'].steps;
  expectStepBefore(
    nativeSteps,
    (step) => step.name === 'Bind a release build to protected main history',
    (step) => step.name === 'Install dependencies',
  );
  const nativePublish = native.jobs['publish-bun'].steps.find(
    (step) => step.name === 'Publish all six assets once',
  ).run;
  expect(nativePublish).toMatch(/gh release create[\s\S]+\|\|[\s\S]+gh release view/u);

  const desktop = readWorkflow('release-desktop-app.yml');
  expect(desktop.on.push.tags).toContain('!sdk-*');
  expect(desktop.on.workflow_dispatch.inputs.publish).toBeUndefined();
  expect(desktop.on.workflow_dispatch.inputs.source_ref).toBeUndefined();
  const desktopSteps = desktop.jobs.desktop.steps;
  expectStepBefore(
    desktopSteps,
    (step) => step.name === 'Bind published installers to protected main history',
    (step) => step.name === 'Install dependencies',
  );
  const productCheckout = desktopSteps.find((step) => step.uses === 'actions/checkout@v7');
  expect(productCheckout.with['persist-credentials']).toBe(false);

  const tagger = readWorkflow('release-tag-on-version-bump.yml');
  for (const workflow of [publish, image, native, desktop, tagger]) {
    expect(JSON.stringify(workflow)).toContain('+refs/heads/main:refs/remotes/origin/main');
  }

  const dockerfile = readFileSync(
    new URL('../../../docker/robota/Dockerfile', import.meta.url),
    'utf8',
  );
  expect(dockerfile).toContain('npm ci --omit=dev --ignore-scripts');
  expect(dockerfile).toContain('ROBOTA_LOCK_SHA256');
  expect(dockerfile).toContain('validate-release-lock.mjs');
  expect(dockerfile).not.toContain(
    'npm install --omit=dev --no-audit --no-fund "@robota-sdk/agent-cli@',
  );
});

it('rejects registry image locks that change digest, root, version, integrity, or registry', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'release-lock-validator-'));
  try {
    const lockPath = join(scratch, 'package-lock.json');
    const packagePath = join(scratch, 'package.json');
    const valid = {
      name: 'robota-release-image',
      lockfileVersion: 3,
      packages: {
        '': {
          name: 'robota-release-image',
          dependencies: { '@robota-sdk/agent-cli': '1.2.3' },
        },
        'node_modules/@robota-sdk/agent-cli': {
          version: '1.2.3',
          resolved: 'https://registry.npmjs.org/@robota-sdk/agent-cli/-/agent-cli-1.2.3.tgz',
          integrity: 'sha512-dGVzdA==',
        },
      },
    };
    const run = (lock, expectedDigest) => {
      const bytes = Buffer.from(`${JSON.stringify(lock)}\n`);
      writeFileSync(lockPath, bytes);
      return spawnSync(
        process.execPath,
        [
          fileURLToPath(
            new URL('../../../docker/robota/validate-release-lock.mjs', import.meta.url),
          ),
          lockPath,
          packagePath,
        ],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            ROBOTA_VERSION: '1.2.3',
            ROBOTA_LOCK_SHA256: expectedDigest ?? createHash('sha256').update(bytes).digest('hex'),
          },
        },
      );
    };

    expect(run(valid).status).toBe(0);
    expect(JSON.parse(readFileSync(packagePath, 'utf8')).dependencies).toEqual({
      '@robota-sdk/agent-cli': '1.2.3',
    });
    expect(run(valid, '0'.repeat(64)).status).toBe(1);
    const extraRoot = structuredClone(valid);
    extraRoot.packages[''].dependencies.extra = '1.0.0';
    expect(run(extraRoot).status).toBe(1);
    const wrongVersion = structuredClone(valid);
    wrongVersion.packages['node_modules/@robota-sdk/agent-cli'].version = '9.9.9';
    expect(run(wrongVersion).status).toBe(1);
    const redirected = structuredClone(valid);
    redirected.packages['node_modules/@robota-sdk/agent-cli'].resolved =
      'https://attacker.example/agent-cli.tgz';
    expect(run(redirected).status).toBe(1);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

it('generates a release manifest only when registry and reviewed tarball integrity match', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'release-integrity-'));
  try {
    const pack = join(scratch, 'pack');
    const payload = join(scratch, 'payload', 'package');
    const bin = join(scratch, 'bin');
    mkdirSync(pack, { recursive: true });
    mkdirSync(payload, { recursive: true });
    mkdirSync(bin);
    const fetchStub = join(scratch, 'fetch-stub.mjs');
    writeFileSync(
      fetchStub,
      `
      globalThis.fetch = async () => ({
        ok: process.env.FIXTURE_HTTP !== 'fail', status: 403,
        json: async () => ({ versions: { '1.2.3': { dist: { integrity: process.env.FIXTURE_INTEGRITY } } },
          'dist-tags': { latest: process.env.FIXTURE_LATEST || '1.2.3' } })
      });
    `,
    );
    writeFileSync(
      join(payload, 'package.json'),
      JSON.stringify({ name: '@robota-sdk/agent-cli', version: '1.2.3' }),
    );
    const tarball = join(pack, 'agent-cli.tgz');
    execFileSync('tar', ['-czf', tarball, '-C', join(scratch, 'payload'), 'package']);
    const integrity = `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`;
    const npm = join(bin, 'npm');
    writeFileSync(
      npm,
      `#!/bin/sh
if [ "$1" = view ]; then
  printf "%s\\n" "$FIXTURE_INTEGRITY"
elif [ "$1" = install ]; then
  node -e 'const fs=require("fs"); const pkg=require("./package.json"); const [name,version]=Object.entries(pkg.dependencies)[0]; fs.writeFileSync("package-lock.json", JSON.stringify({name:pkg.name,lockfileVersion:3,packages:{"":{name:pkg.name,dependencies:pkg.dependencies},["node_modules/"+name]:{version,integrity:process.env.FIXTURE_LOCK_INTEGRITY || process.env.FIXTURE_INTEGRITY}}}));'
else
  exit 2
fi
`,
    );
    chmodSync(npm, 0o755);
    const output = join(scratch, 'manifest.json');
    const lockOutput = join(scratch, 'package-lock.json');
    const run = (published, extra = {}) =>
      spawnSync(
        process.execPath,
        [
          fileURLToPath(new URL('../../publish/generate-integrity-manifest.mjs', import.meta.url)),
          pack,
          output,
        ],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            PROJECT_NPM_REGISTRY_URL: 'https://registry.example',
            RELEASE_TAG: 'v1.2.3',
            RELEASE_SOURCE_COMMIT: 'a'.repeat(40),
            PRODUCT_CONFIG_SHA256: 'b'.repeat(64),
            PRODUCT_PACKAGE_SCOPE: '@robota-sdk',
            RELEASE_VERSION: '1.2.3',
            RELEASE_INSTALL_LOCK: lockOutput,
            FIXTURE_INTEGRITY: published,
            NODE_OPTIONS: `--import=${fetchStub}`,
            ...extra,
          },
        },
      );
    expect(run('sha512-wrong').status).toBe(1);
    expect(run(integrity, { FIXTURE_LATEST: '0.9.0' }).status).toBe(1);
    expect(run(integrity, { FIXTURE_HTTP: 'fail' }).status).toBe(1);
    expect(run(integrity, { FIXTURE_LOCK_INTEGRITY: 'sha512-other' }).status).toBe(1);
    const success = run(integrity);
    expect(success.status, success.stderr).toBe(0);
    expect(JSON.parse(readFileSync(output, 'utf8'))).toMatchObject({
      tag: 'v1.2.3',
      sourceCommit: 'a'.repeat(40),
      productConfigSha256: 'b'.repeat(64),
      packageScope: '@robota-sdk',
      registry: 'https://registry.example',
      packages: [{ name: '@robota-sdk/agent-cli', version: '1.2.3', integrity }],
    });
    expect(
      JSON.parse(readFileSync(lockOutput, 'utf8')).packages['node_modules/@robota-sdk/agent-cli'],
    ).toMatchObject({ version: '1.2.3', integrity });
    const firstLock = readFileSync(lockOutput);
    const repeated = run(integrity);
    expect(repeated.status, repeated.stderr).toBe(0);
    expect(readFileSync(lockOutput)).toEqual(firstLock);
    expect(run(integrity, { RELEASE_COMPONENT: 'sdk' }).status).toBe(1);
    writeFileSync(join(payload, 'package.json'), JSON.stringify({ name: '@robota-sdk/agent-core', version: '1.2.3' }));
    execFileSync('tar', ['-czf', tarball, '-C', join(scratch, 'payload'), 'package']);
    const sdkIntegrity = `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`;
    const sdk = run(sdkIntegrity, { RELEASE_COMPONENT: 'sdk', RELEASE_PACKAGE: 'agent-core' });
    expect(sdk.status, sdk.stderr).toBe(0);
    expect(JSON.parse(readFileSync(lockOutput, 'utf8')).packages['node_modules/@robota-sdk/agent-core'])
      .toMatchObject({ version: '1.2.3', integrity: sdkIntegrity });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
