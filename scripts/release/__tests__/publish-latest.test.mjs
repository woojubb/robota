import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const changesetsCli = path.join(root, 'node_modules/@changesets/cli/bin.js');
const fixtures = [];
const version = '3.0.0-beta.93';

afterAll(() => {
  for (const fixture of fixtures) rmSync(fixture, { recursive: true, force: true });
});

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function makeFixture({ prerelease = true, failure = '', trusted = false } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'robota-publish-latest-'));
  fixtures.push(directory);
  for (const relative of [
    '.changeset',
    'bin',
    'packages/agent-core',
    'packages/amber-existing',
    'packages/cedar-new',
    'scripts/harness',
    'scripts/publish',
  ])
    mkdirSync(path.join(directory, relative), { recursive: true });

  writeJson(path.join(directory, 'package.json'), {
    name: 'robota-publish-fixture',
    private: true,
    packageManager: 'pnpm@8.15.4',
    workspaces: ['packages/*'],
  });
  writeFileSync(path.join(directory, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
  writeFileSync(
    path.join(directory, 'pnpm-lock.yaml'),
    "lockfileVersion: '6.0'\nimporters:\n  .: {}\n",
  );
  writeJson(path.join(directory, '.changeset/config.json'), {
    changelog: '@changesets/cli/changelog',
    commit: false,
    fixed: [],
    linked: [],
    access: 'public',
    baseBranch: 'main',
    updateInternalDependencies: 'patch',
    ignore: [],
  });
  const preFile = path.join(directory, '.changeset/pre.json');
  if (prerelease)
    writeJson(preFile, {
      mode: 'pre',
      tag: 'beta',
      initialVersions: {
        '@robota-sdk/amber-existing': '3.0.0-beta.92',
        '@robota-sdk/cedar-new': '3.0.0-beta.92',
      },
      changesets: [],
    });
  writeJson(path.join(directory, 'packages/agent-core/package.json'), {
    name: '@robota-sdk/agent-core',
    version,
    private: true,
  });
  for (const name of ['amber-existing', 'cedar-new'])
    writeJson(path.join(directory, `packages/${name}/package.json`), {
      name: `@robota-sdk/${name}`,
      version,
      private: false,
    });
  copyFileSync(
    path.join(root, 'scripts/publish/publish-packages.sh'),
    path.join(directory, 'scripts/publish/publish-packages.sh'),
  );
  for (const relative of [
    'scripts/harness/check-publish-safety.mjs',
    'scripts/harness/check-sdk-public-surface.mjs',
    'scripts/publish/verify-tarballs.mjs',
  ])
    writeFileSync(path.join(directory, relative), '\n');

  const npmStub = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const version = '${version}';
if (args[0] === 'whoami') { process.stdout.write('fixture-user\\n'); process.exit(0); }
if (args[0] === 'info') {
  if (args[1].startsWith('@robota-sdk/cedar-new')) process.exit(1);
  if (args[1] === '@robota-sdk/amber-existing') {
    process.stdout.write(JSON.stringify({ name: args[1], version: '3.0.0-beta.92', versions: ['3.0.0-beta.92'], 'dist-tags': { beta: '3.0.0-beta.92' } }) + '\\n');
    process.exit(0);
  }
  process.exit(1);
}
if (args[0] === 'view') {
  if (args[2] === 'name') {
    if (args[1] === '@robota-sdk/cedar-new') process.exit(1);
    process.stdout.write(args[1] + '\\n'); process.exit(0);
  }
  if (args[2] === 'dist-tags.latest') {
    const records = fs.existsSync(process.env.PUBLISH_RECORD)
      ? fs.readFileSync(process.env.PUBLISH_RECORD, 'utf8').trim().split('\\n').filter(Boolean).map(JSON.parse) : [];
    if (records.some(({ cwd, args: publishArgs }) => cwd.endsWith('/' + args[1].split('/').at(-1)) && publishArgs[publishArgs.indexOf('--tag') + 1] === 'latest')) {
      process.stdout.write(version + '\\n');
    }
    process.exit(0);
  }
}
process.stderr.write('Unexpected npm fixture command\\n'); process.exit(98);
`;
  const pnpmStub = `#!/usr/bin/env node
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
if (args[0] === '--version') { process.stdout.write('8.15.4\\n'); process.exit(0); }
if (args[0] === 'build' || args[0] === 'pack') process.exit(0);
if (args[0] === '-r' && args.includes('list')) {
  process.stdout.write(JSON.stringify(['amber-existing', 'cedar-new'].map(name => ({
    name: '@robota-sdk/' + name, version: '${version}', private: false,
    path: process.cwd() + '/packages/' + name,
  }))));
  process.exit(0);
}
if (args[0] === 'changeset') {
  fs.writeFileSync(process.env.CHANGESET_ARGS_RECORD, JSON.stringify(args) + '\\n');
  const result = spawnSync(process.execPath, [process.env.CHANGESETS_CLI, ...args.slice(1)], {
    stdio: 'inherit', env: { ...process.env, PUBLISH_WRAPPER_PID: String(process.ppid) },
  });
  process.exit(result.status ?? 1);
}
if (args[0] === 'publish') {
  fs.appendFileSync(process.env.PUBLISH_RECORD, JSON.stringify({ cwd: process.cwd(), args }) + '\\n');
  if (process.env.FIXTURE_FAILURE === 'signal') {
    try {
      fs.writeFileSync(process.env.SIGNAL_SENT, 'sent', { flag: 'wx' });
      process.kill(Number(process.env.PUBLISH_WRAPPER_PID), 'SIGTERM');
      setTimeout(() => process.kill(Number(process.env.PUBLISH_WRAPPER_PID), 'SIGTERM'), 40);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    setTimeout(() => {
      fs.appendFileSync(process.env.CHILD_DONE, JSON.stringify({
        prePresent: fs.existsSync(process.env.PRE_STATE_FILE),
        lockPresent: fs.existsSync(process.env.PRE_STATE_LOCK),
      }) + '\\n');
      process.stdout.write('{}\\n');
      process.exit(0);
    }, 500);
  } else if (process.env.FIXTURE_FAILURE === 'publish') {
    process.stderr.write(JSON.stringify({ error: { code: 'EFAIL', summary: 'synthetic publish failure' } }) + '\\n');
    process.exit(1);
  } else {
    process.stdout.write('{}\\n'); process.exit(0);
  }
}
if (args[0] !== 'publish') {
  process.stderr.write('Unexpected pnpm fixture command\\n'); process.exit(98);
}
`;
  for (const [name, content] of [
    ['npm', npmStub],
    ['pnpm', pnpmStub],
    ['sleep', '#!/bin/sh\nexit 0\n'],
  ]) {
    const file = path.join(directory, 'bin', name);
    writeFileSync(file, content);
    chmodSync(file, 0o755);
  }
  const git = spawnSync('git', ['init', '-q'], { cwd: directory, encoding: 'utf8' });
  if (git.status !== 0) throw new Error(git.stderr);
  return {
    directory,
    preFile,
    lock: path.join(directory, '.changeset/.publish-prestate-lock'),
    record: path.join(directory, 'publish-record.jsonl'),
    changesetArgsRecord: path.join(directory, 'changeset-args.json'),
    childDone: path.join(directory, 'child-done.txt'),
    signalSent: path.join(directory, 'signal-sent.txt'),
    failure,
    trusted,
    before: prerelease ? readFileSync(preFile) : undefined,
  };
}

function run(fixture) {
  const result = spawnSync(
    'bash',
    [
      path.join(fixture.directory, 'scripts/publish/publish-packages.sh'),
      '--skip-build',
      ...(fixture.trusted ? ['--trusted'] : []),
    ],
    {
      cwd: fixture.directory,
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        PATH: [
          path.join(fixture.directory, 'bin'),
          path.dirname(process.execPath),
          '/usr/bin',
          '/bin',
        ].join(':'),
        TMPDIR: fixture.directory,
        PRODUCT_PACKAGE_SCOPE: '@robota-sdk',
        PROJECT_REPOSITORY_URL: 'https://github.com/robota/fixture',
        PROJECT_NPM_REGISTRY_URL: 'https://registry.npmjs.org/',
        PROJECT_PACKAGE_ACCESS: 'public',
        CHANGESETS_CLI: changesetsCli,
        CHANGESET_ARGS_RECORD: fixture.changesetArgsRecord,
        PUBLISH_RECORD: fixture.record,
        CHILD_DONE: fixture.childDone,
        SIGNAL_SENT: fixture.signalSent,
        PRE_STATE_FILE: fixture.preFile,
        PRE_STATE_LOCK: fixture.lock,
        FIXTURE_FAILURE: fixture.failure,
      },
    },
  );
  const records = existsSync(fixture.record)
    ? readFileSync(fixture.record, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
    : [];
  const tags = Object.fromEntries(
    records.map(({ cwd, args }) => [path.basename(cwd), args[args.indexOf('--tag') + 1]]),
  );
  return { ...result, records, tags };
}

function expectRestored(fixture) {
  if (fixture.before) expect(readFileSync(fixture.preFile)).toEqual(fixture.before);
  else expect(existsSync(fixture.preFile)).toBe(false);
  expect(existsSync(fixture.lock)).toBe(false);
}

it('publishes both new and prerelease-only packages under latest with the pinned Changesets CLI', () => {
  const fixture = makeFixture();
  const result = run(fixture);
  expect(result.tags).toEqual({ 'amber-existing': 'latest', 'cedar-new': 'latest' });
  expect(result.status).toBe(0);
  expect(JSON.parse(readFileSync(fixture.changesetArgsRecord, 'utf8'))).toEqual([
    'changeset',
    'publish',
    '--no-git-tag',
    '--tag',
    'latest',
  ]);
  expect(result.stdout).toContain('Published 3.0.0-beta.93');
  expectRestored(fixture);
});

it('restores exact prerelease bytes after Changesets publication fails', () => {
  const fixture = makeFixture({ failure: 'publish' });
  const result = run(fixture);
  expect(result.status).toBe(1);
  expect(result.records.length).toBeGreaterThan(0);
  expectRestored(fixture);
});

it('keeps prerelease state hidden until publishing finishes after repeated termination', () => {
  const fixture = makeFixture({ failure: 'signal' });
  const result = run(fixture);
  expect(result.status).toBe(143);
  expect(result.records).toHaveLength(2);
  expect(result.tags).toEqual({ 'amber-existing': 'latest', 'cedar-new': 'latest' });
  expect(readFileSync(fixture.childDone, 'utf8').trim().split('\n').map(JSON.parse)).toEqual([
    { prePresent: false, lockPresent: true },
    { prePresent: false, lockPresent: true },
  ]);
  expectRestored(fixture);
});

it('refuses a concurrent publisher without moving prerelease state', () => {
  const fixture = makeFixture();
  mkdirSync(fixture.lock);
  const result = run(fixture);
  expect(result.status).not.toBe(0);
  expect(result.records).toEqual([]);
  expect(existsSync(fixture.changesetArgsRecord)).toBe(false);
  expect(readFileSync(fixture.preFile)).toEqual(fixture.before);
});

it('publishes latest and leaves no state behind when prerelease metadata is absent', () => {
  const fixture = makeFixture({ prerelease: false });
  const result = run(fixture);
  expect(result.status).toBe(0);
  expect(result.tags).toEqual({ 'amber-existing': 'latest', 'cedar-new': 'latest' });
  expectRestored(fixture);
});

it('keeps trusted publication from attempting a never-published package', () => {
  const fixture = makeFixture({ trusted: true });
  const result = run(fixture);
  expect(result.status).not.toBe(0);
  expect(result.stdout).toContain('Never published');
  expect(result.records).toEqual([]);
  expect(existsSync(fixture.changesetArgsRecord)).toBe(false);
  expectRestored(fixture);
});
