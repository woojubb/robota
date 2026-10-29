import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const fixtures = [];
const version = '3.0.0-beta.93';

afterAll(() => {
  for (const fixture of fixtures) rmSync(fixture, { recursive: true, force: true });
});

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function makeFixture({ failure = '', trusted = false } = {}) {
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
  writeJson(path.join(directory, 'package.json'), { private: true, packageManager: 'pnpm@8.15.4' });
  writeFileSync(path.join(directory, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
  const preFile = path.join(directory, '.changeset/pre.json');
  writeJson(preFile, { mode: 'pre', tag: 'beta', changesets: [] });
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
  copyFileSync(
    path.join(root, 'scripts/publish/publish-tarballs.mjs'),
    path.join(directory, 'scripts/publish/publish-tarballs.mjs'),
  );
  writeFileSync(
    path.join(directory, 'registry-fixture.mjs'),
    `
    import fs from 'node:fs';
    globalThis.fetch = async (url) => {
      const name = decodeURIComponent(String(url)).split('/').slice(-2).join('/');
      const mode = process.env.FIXTURE_REGISTRY_MODE || 'missing';
      if (mode === 'forbidden' || (mode === 'missing' && name.endsWith('cedar-new'))) return { ok: false, status: mode === 'forbidden' ? 403 : 404 };
      const records = fs.readFileSync(process.env.PACK_RECORD, 'utf8').trim().split('\\n').map(JSON.parse);
      const item = records.find(entry => entry.name === name);
      const integrity = mode === 'conflict' ? 'sha512-other' : 'sha512-' + item?.sha512;
      return {ok: true, status: 200, json: async () => ({ versions: mode === 'unpublished' ? {} : { '${version}': {dist: {integrity}} } }) };
    };
  `,
  );
  for (const relative of [
    'scripts/harness/check-publish-safety.mjs',
    'scripts/harness/check-sdk-public-surface.mjs',
    'scripts/publish/verify-tarballs.mjs',
  ])
    writeFileSync(path.join(directory, relative), '\n');

  const npmStub = `#!/usr/bin/env node
const fs = require('node:fs');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const args = process.argv.slice(2);
const records = () => fs.existsSync(process.env.PUBLISH_RECORD)
  ? fs.readFileSync(process.env.PUBLISH_RECORD, 'utf8').trim().split('\\n').filter(Boolean).map(JSON.parse)
  : [];
const accepted = (name, wanted = '${version}') => records().some((entry) =>
  entry.accepted && entry.name === name && entry.version === wanted);
const splitSpec = (spec) => {
  const at = spec.lastIndexOf('@');
  return at > 0 ? { name: spec.slice(0, at), version: spec.slice(at + 1) } : { name: spec };
};
if (args[0] === 'whoami') { console.log('fixture-user'); process.exit(0); }
if (args[0] === 'view') {
  const spec = splitSpec(args[1]);
  if (args[2] === 'name') {
    if (spec.name === '@robota-sdk/cedar-new') process.exit(1);
    console.log(spec.name); process.exit(0);
  }
  if (args[2] === 'version') {
    if (accepted(spec.name, spec.version)) console.log(spec.version);
    else process.exit(1);
    process.exit(0);
  }
  if (args[2] === 'dist-tags.latest') {
    if (accepted(spec.name)) console.log('${version}');
    process.exit(0);
  }
}
if (args[0] === 'publish') {
  const tarball = args[1];
  const manifest = JSON.parse(execFileSync('tar', ['-xzOf', tarball, 'package/package.json'], { encoding: 'utf8' }));
  const otp = args.find((value) => value.startsWith('--otp='))?.slice('--otp='.length);
  let ok = process.env.FIXTURE_FAILURE !== 'publish';
  if (process.env.FIXTURE_FAILURE === 'second') ok = manifest.name !== '@robota-sdk/cedar-new';
  if (process.env.FIXTURE_FAILURE === 'otp') ok = otp === '222222';
  const sha512 = crypto.createHash('sha512').update(fs.readFileSync(tarball)).digest('base64');
  fs.appendFileSync(process.env.PUBLISH_RECORD, JSON.stringify({
    name: manifest.name, version: manifest.version, tarball, sha512, args, otp, accepted: ok,
  }) + '\\n');
  if (!ok) {
    process.stderr.write(process.env.FIXTURE_FAILURE === 'otp' ? 'npm error code EOTP\\n' : 'npm error code EFAIL\\n');
    process.exit(1);
  }
  console.log('+ ' + manifest.name + '@' + manifest.version);
  process.exit(0);
}
process.stderr.write('Unexpected npm fixture command: ' + args.join(' ') + '\\n');
process.exit(98);
`;
  const pnpmStub = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const args = process.argv.slice(2);
if (args[0] === 'build') process.exit(0);
if (args[0] === '-r' && args.includes('list')) {
  console.log(JSON.stringify(['amber-existing', 'cedar-new'].map(name => ({
    name: '@robota-sdk/' + name, version: '${version}', private: false,
    path: process.cwd() + '/packages/' + name,
  }))));
  process.exit(0);
}
if (args[0] === 'pack') {
  const destination = args[args.indexOf('--pack-destination') + 1];
  const manifest = require(path.join(process.cwd(), 'package.json'));
  const stage = fs.mkdtempSync(path.join(process.env.TMPDIR, 'pack-stage-'));
  fs.mkdirSync(path.join(stage, 'package'));
  fs.copyFileSync(path.join(process.cwd(), 'package.json'), path.join(stage, 'package/package.json'));
  const filename = manifest.name.replace('@', '').replace('/', '-') + '-' + manifest.version + '.tgz';
  const tarball = path.join(destination, filename);
  execFileSync('tar', ['-czf', tarball, '-C', stage, 'package']);
  const sha512 = crypto.createHash('sha512').update(fs.readFileSync(tarball)).digest('base64');
  fs.appendFileSync(process.env.PACK_RECORD, JSON.stringify({ name: manifest.name, tarball, sha512 }) + '\\n');
  fs.rmSync(stage, { recursive: true, force: true });
  process.exit(0);
}
process.stderr.write('Unexpected pnpm fixture command: ' + args.join(' ') + '\\n');
process.exit(98);
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
  return {
    directory,
    preFile,
    preBytes: readFileSync(preFile),
    record: path.join(directory, 'publish-record.jsonl'),
    packRecord: path.join(directory, 'pack-record.jsonl'),
    failure,
    trusted,
  };
}

function lines(file) {
  return existsSync(file)
    ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
    : [];
}

function run(fixture, { failure = fixture.failure, args = [], registryMode = 'missing' } = {}) {
  const result = spawnSync(
    'bash',
    [
      path.join(fixture.directory, 'scripts/publish/publish-packages.sh'),
      '--skip-build',
      ...(fixture.trusted ? ['--trusted'] : []),
      ...args,
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
        PUBLISH_RECORD: fixture.record,
        PACK_RECORD: fixture.packRecord,
        FIXTURE_FAILURE: failure,
        FIXTURE_REGISTRY_MODE: registryMode,
        NODE_OPTIONS: `--import=${path.join(fixture.directory, 'registry-fixture.mjs')}`,
      },
    },
  );
  return { ...result, output: result.stdout + result.stderr, records: lines(fixture.record) };
}

it('publishes the exact reviewed tarballs under latest without touching prerelease state', () => {
  const fixture = makeFixture();
  const result = run(fixture);
  expect(result.status, result.output).toBe(0);
  const packed = Object.fromEntries(lines(fixture.packRecord).map((entry) => [entry.name, entry]));
  expect(result.records).toHaveLength(2);
  for (const record of result.records) {
    expect(record.accepted).toBe(true);
    expect(record.args).toContain('latest');
    expect(record.tarball).toBe(packed[record.name].tarball);
    expect(record.sha512).toBe(packed[record.name].sha512);
  }
  expect(readFileSync(fixture.preFile)).toEqual(fixture.preBytes);
  expect(existsSync(path.join(fixture.directory, '.changeset/.publish-prestate-lock'))).toBe(false);
});

it('retries idempotently by skipping a tarball published before a later failure', () => {
  const fixture = makeFixture({ failure: 'second' });
  expect(run(fixture).status).toBe(1);
  const repeated = run(fixture, { failure: '' });
  expect(repeated.status, repeated.output).toBe(0);
  expect(repeated.records.filter((entry) => entry.name.endsWith('amber-existing'))).toHaveLength(1);
  expect(repeated.records.filter((entry) => entry.name.endsWith('cedar-new'))).toHaveLength(2);
  expect(repeated.output).toContain('already exists');
});

it('refuses trusted publication when a package has never been published', () => {
  const fixture = makeFixture({ trusted: true });
  const result = run(fixture);
  expect(result.status).not.toBe(0);
  expect(result.output).toContain('first publication requires owner setup');
  expect(result.records).toEqual([]);
});

it.each(['forbidden', 'conflict'])(
  'refuses trusted %s registry evidence before any write',
  (registryMode) => {
    const result = run(makeFixture({ trusted: true }), { registryMode });
    expect(result.status).not.toBe(0);
    expect(result.records).toEqual([]);
  },
);

it('skips already published trusted tarballs only when their integrity matches', () => {
  const result = run(makeFixture({ trusted: true }), { registryMode: 'matching' });
  expect(result.status, result.output).toBe(0);
  expect(result.records).toEqual([]);
  expect(result.output).toContain('already published with matching integrity');
});

it('passes an explicit OTP to each exact tarball', () => {
  const fixture = makeFixture({ failure: 'otp' });
  const result = run(fixture, { args: ['--otp=222222'] });
  expect(result.status, result.output).toBe(0);
  expect(result.records.map(({ otp }) => otp)).toEqual(['222222', '222222']);
});

it('never prompts without a terminal and fails as npm reports', () => {
  const fixture = makeFixture({ failure: 'otp' });
  const result = run(fixture);
  expect(result.status).toBe(1);
  expect(result.output).not.toContain('🔑');
  expect(result.output).toContain('EOTP');
});
