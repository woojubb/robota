import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { makeTemp } from '../../harness/__tests__/make-temp.mjs';
import { publishVerifiedArtifacts } from '../publish.mjs';
import { prepareReleaseArtifacts } from '../publish-set.mjs';

it('binds dry-run and OTP publication to the same verified tarball without directory repacking', async () => {
  const root = makeTemp('robota-publish-command-');
  const tarballPath = path.join(root, 'package.tgz');
  writeFileSync(tarballPath, 'verified archive fixture');
  const artifact = {
    packageName: '@example/package',
    version: '1.2.3',
    tarballPath,
    sha256: createHash('sha256').update('verified archive fixture').digest('hex'),
  };
  const calls = [];
  const run = async (args) => {
    calls.push(args);
  };
  await publishVerifiedArtifacts([artifact], {
    packageNames: ['@example/package'],
    dryRun: true,
    run,
  });
  await publishVerifiedArtifacts([artifact], {
    packageNames: ['@example/package'],
    otp: 'test-otp',
    run,
  });
  expect(calls).toEqual([
    ['publish', tarballPath, '--no-git-checks', '--dry-run'],
    ['publish', tarballPath, '--no-git-checks', '--otp', 'test-otp'],
  ]);
  writeFileSync(tarballPath, 'changed after verification');
  await expect(
    publishVerifiedArtifacts([artifact], {
      packageNames: ['@example/package'],
      otp: 'test-otp',
      run,
    }),
  ).rejects.toThrow(/changed/);
  expect(calls).toHaveLength(2);
});

it('rejects an invalid publish CLI request before any package manager command', () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL('../publish-cli.mjs', import.meta.url)),
      'publish',
      'missing.json',
      'unrecognized-mode',
      '@example/package',
    ],
    { encoding: 'utf8' },
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('usage:');
});

it('waits for every started publish before aggregating failures and never starts the next batch', async () => {
  const root = makeTemp('robota-publish-batch-');
  const contents = 'verified archive fixture';
  const sha256 = createHash('sha256').update(contents).digest('hex');
  const artifacts = Array.from({ length: 5 }, (_, index) => {
    const tarballPath = path.join(root, `${index}.tgz`);
    writeFileSync(tarballPath, contents);
    return { packageName: `@example/package-${index}`, tarballPath, sha256 };
  });
  const calls = [];
  const releases = [];
  const firstFailure = new Error('first publisher failed');
  const secondFailure = new Error('second publisher failed');
  const run = (args) => {
    calls.push(args);
    if (calls.length === 1) throw firstFailure;
    return new Promise((resolve, reject) => {
      const failure = calls.length === 2 ? secondFailure : undefined;
      releases.push(() => (failure ? reject(failure) : resolve()));
    });
  };
  let settled = false;
  const outcome = publishVerifiedArtifacts(artifacts, {
    packageNames: artifacts.map((artifact) => artifact.packageName),
    dryRun: true,
    run,
  }).then(
    () => {
      settled = true;
    },
    (error) => {
      settled = true;
      return error;
    },
  );
  await new Promise((resolve) => setImmediate(resolve));
  const settledBeforeChildren = settled;
  releases[0]();
  releases[1]();
  await new Promise((resolve) => setImmediate(resolve));
  const settledBeforeLastChild = settled;
  releases[2]();
  const failure = await outcome;
  expect(settledBeforeChildren).toBe(false);
  expect(settledBeforeLastChild).toBe(false);
  expect(calls.map((args) => args[1])).toEqual(
    artifacts.slice(0, 4).map((artifact) => artifact.tarballPath),
  );
  expect(failure).toBeInstanceOf(AggregateError);
  expect(failure.errors.map((error) => error.cause)).toEqual([firstFailure, secondFailure]);
  expect(failure.message).toContain('@example/package-0');
  expect(failure.message).toContain('@example/package-1');
});

it('starts the next batch only after the successful current batch settles', async () => {
  const root = makeTemp('robota-publish-success-batch-');
  const contents = 'verified archive fixture';
  const sha256 = createHash('sha256').update(contents).digest('hex');
  const artifacts = Array.from({ length: 5 }, (_, index) => {
    const tarballPath = path.join(root, `${index}.tgz`);
    writeFileSync(tarballPath, contents);
    return { packageName: `@example/package-${index}`, tarballPath, sha256 };
  });
  const calls = [];
  const releases = [];
  const publication = publishVerifiedArtifacts(artifacts, {
    packageNames: artifacts.map((artifact) => artifact.packageName),
    dryRun: true,
    run: (args) => {
      calls.push(args[1]);
      if (calls.length <= 4)
        return new Promise((resolve) => {
          releases.push(resolve);
        });
      return Promise.resolve();
    },
  });
  releases[0]();
  releases[1]();
  releases[2]();
  await new Promise((resolve) => setImmediate(resolve));
  const beforeLastChild = [...calls];
  releases[3]();
  await publication;
  expect(beforeLastChild).toEqual(artifacts.slice(0, 4).map((artifact) => artifact.tarballPath));
  expect(calls).toEqual(artifacts.map((artifact) => artifact.tarballPath));
});

it.each([
  { label: 'empty selection', packageNames: [] },
  { label: 'duplicate selection', packageNames: ['@example/package', '@example/package'] },
  { label: 'empty name', packageNames: [''] },
  { label: 'blank name', packageNames: [' '] },
])('rejects $label before publisher side effects', async ({ packageNames }) => {
  const root = makeTemp('robota-publish-selection-');
  const contents = 'verified archive fixture';
  const tarballPath = path.join(root, 'package.tgz');
  writeFileSync(tarballPath, contents);
  const artifacts = ['@example/package', '', ' '].map((packageName) => ({
    packageName,
    tarballPath,
    sha256: createHash('sha256').update(contents).digest('hex'),
  }));
  const calls = [];
  await expect(
    publishVerifiedArtifacts(artifacts, {
      packageNames,
      dryRun: true,
      run: async (args) => {
        calls.push(args);
      },
    }),
  ).rejects.toThrow(/nonempty unique package set/);
  expect(calls).toEqual([]);
});

it('prepares only exact selected public package versions before the OTP boundary', async () => {
  const root = makeTemp('robota-publish-set-');
  writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
  for (const [name, isPrivate] of [
    ['public', false],
    ['private', true],
  ]) {
    mkdirSync(path.join(root, 'packages', name), { recursive: true });
    writeFileSync(
      path.join(root, 'packages', name, 'package.json'),
      JSON.stringify({
        name: `@example/${name}`,
        version: '1.2.3',
        ...(isPrivate ? { private: true } : {}),
      }),
    );
  }
  const calls = [];
  const pack = async (packageRoot, options) => {
    calls.push({ packageRoot, options });
    return { packageName: '@example/public' };
  };
  const selected = await prepareReleaseArtifacts({
    root,
    destination: path.join(root, 'archives'),
    packageNames: ['@example/public'],
    pack,
  });
  expect(selected).toEqual([{ packageName: '@example/public' }]);
  expect(calls).toHaveLength(1);
  await expect(
    prepareReleaseArtifacts({
      root,
      destination: path.join(root, 'archives'),
      packageNames: ['@example/public', '@example/private'],
      pack,
    }),
  ).rejects.toThrow(/private/);
  expect(calls).toHaveLength(1);
});
