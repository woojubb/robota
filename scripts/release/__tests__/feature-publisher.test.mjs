import { test, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import * as publisher from '../feature-publisher.mjs';

afterEach(() => vi.unstubAllGlobals());

test('reads public native evidence without inheriting tokens or following redirects', async () => {
  const requests = [];
  vi.stubGlobal('fetch', async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      json: async () =>
        url.includes('/jobs?') ? { total_count: 0, jobs: [] } : { head_sha: 'a'.repeat(40) },
    };
  });
  await publisher.readPublicNativeEvidence('woojubb/robota', '123');
  expect(requests).toHaveLength(2);
  for (const { url, options } of requests) {
    expect(url).toMatch(/^https:\/\/api\.github\.com\/repos\/woojubb\/robota\/actions\/runs\/123/);
    expect(options.headers.Authorization).toBeUndefined();
    expect(options.credentials).toBe('omit');
    expect(options.redirect).toBe('error');
  }
});

test('Feature publishing stays release-only behind native publication with only scoped package write', () => {
  const workflow = parse(
    readFileSync(
      new URL('../../../.github/workflows/release-bun-binaries.yml', import.meta.url),
      'utf8',
    ),
  );
  const job = workflow.jobs['publish-devcontainer-feature'];
  expect(workflow.permissions).toEqual({ contents: 'read' });
  expect(job.permissions).toEqual({ contents: 'read', packages: 'write' });
  expect(job.needs).toEqual(['build-bun', 'publish-bun']);
  const condition = Function('github', 'needs', 'cancelled', `return (${job.if.slice(3, -2)});`);
  for (const event of ['push', 'workflow_dispatch', 'pull_request']) {
    for (const result of ['success', 'failure', 'cancelled', 'skipped']) {
      expect(condition({ event_name: event }, { 'publish-bun': { result } }, () => false)).toBe(
        event !== 'pull_request' && result === 'success',
      );
    }
  }
  expect(
    condition({ event_name: 'push' }, { 'publish-bun': { result: 'success' } }, () => true),
  ).toBe(false);
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';

const sha = 'a'.repeat(40);
const release = {
  tag: 'v3.0.0-beta.96',
  sha,
  sourceSha: sha,
  tagPrefix: 'v',
  cliVersion: '3.0.0-beta.96',
  authoredPin: '3.0.0-beta.96',
  featureVersion: '1.0.0',
  id: 'robota',
  namespace: 'woojubb/devcontainer-features',
  repository: 'woojubb/robota',
  binaryRun: {
    name: 'Release — Bun binaries',
    head_sha: sha,
    conclusion: 'success',
    event: 'push',
  },
  release: {
    tag_name: 'v3.0.0-beta.96',
    draft: false,
    assets: ['robota-linux-x64', 'robota-linux-arm64', 'SHA256SUMS.txt'].map((name) => ({ name })),
  },
  npmVersion: '3.0.0-beta.96',
};
test('refuses wrong source, pin, tag, product, repository, npm, native result and assets', () => {
  publisher.validateRelease(release);
  for (const mutation of [
    { sourceSha: 'b'.repeat(40) },
    { tag: 'v3.0.0-beta.97' },
    { authoredPin: 'latest' },
    { namespace: 'someone/other' },
    { id: 'other' },
    { repository: 'someone/robota' },
    { npmVersion: '3.0.0-beta.95' },
    { featureVersion: 'latest' },
    { binaryRun: { ...release.binaryRun, head_sha: 'b'.repeat(40) } },
    { binaryRun: { ...release.binaryRun, conclusion: 'failure' } },
    { binaryRun: { ...release.binaryRun, event: 'pull_request' } },
    { release: { ...release.release, assets: [] } },
    { release: { ...release.release, draft: true } },
  ])
    assert.throws(() => publisher.validateRelease({ ...release, ...mutation }));
});

test('native evidence requires each distinct successful target and completed binary publisher', () => {
  const jobs = ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'windows-x64'].map(
    (target) => ({
      name: `Build Bun / configured / ${target}`,
      status: 'completed',
      conclusion: 'success',
    }),
  );
  jobs.push({ name: 'Publish verified Bun binaries', status: 'completed', conclusion: 'success' });
  publisher.validateNativeJobs(jobs);
  assert.throws(() => publisher.validateNativeJobs(jobs.slice(1)));
  assert.throws(
    () => publisher.validateNativeJobs(jobs.map((job, i) => (i === 0 ? jobs[1] : job))),
    /target set/,
  );
  assert.throws(() =>
    publisher.validateNativeJobs(
      jobs.map((job, i) => (i === 0 ? { ...job, conclusion: 'failure' } : job)),
    ),
  );
  assert.throws(() =>
    publisher.validateNativeJobs(
      jobs.map((job, i) => (i === 5 ? { ...job, status: 'in_progress' } : job)),
    ),
  );
});

test('public metadata refusal and incomplete pagination stop release validation', async () => {
  vi.stubGlobal('fetch', async () => ({ ok: false, status: 403 }));
  await assert.rejects(publisher.readPublicNativeEvidence('woojubb/robota', '123'), /403/);
  await assert.rejects(publisher.readPublicNativeEvidence('someone/other', '123'), /repository/);
  await assert.rejects(publisher.readPublicNativeEvidence('woojubb/robota', '../other'), /run ID/);
  vi.stubGlobal('fetch', async () => ({
    ok: true,
    json: async () => ({ total_count: 101, jobs: [] }),
  }));
  await assert.rejects(publisher.readPublicNativeEvidence('woojubb/robota', '123'), /incomplete/);
});

test('old release tag without same-tag publisher cannot proceed to external evidence', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'feature-old-tag-'));
  const git = (args) => {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  };
  try {
    git(['init', '--quiet']);
    await writeFile(path.join(root, 'README'), 'old source');
    git(['add', '.']);
    git([
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.com',
      'commit',
      '--quiet',
      '-m',
      'old tag',
    ]);
    git(['tag', 'v3.0.0-beta.96']);
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await assert.rejects(
      publisher.validateLiveRelease({
        checkout: root,
        workspace: root,
        tag: 'v3.0.0-beta.96',
        runId: '123',
        namespace: release.namespace,
        repository: release.repository,
      }),
      /ENOENT/,
    );
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function bundle(root) {
  await writeFile(
    path.join(root, 'devcontainer-feature.json'),
    JSON.stringify({
      id: 'robota',
      version: '1.0.0',
      options: { version: { default: '3.0.0-beta.96' } },
    }),
  );
  await writeFile(path.join(root, 'install.sh'), '#!/bin/sh\nexit 0\n');
  const digest = createHash('sha256');
  for (const name of (await readdir(root)).sort()) {
    digest.update(name);
    digest.update('\0');
    digest.update(await readFile(path.join(root, name)));
    digest.update('\0');
  }
  await writeFile(
    path.join(root, 'feature-release.json'),
    JSON.stringify({
      id: 'robota',
      featureVersion: '1.0.0',
      cliVersion: '3.0.0-beta.96',
      contentDigest: digest.digest('hex'),
    }),
  );
}
test('bundle digest detects changed install bytes before registry access', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'feature-bundle-'));
  try {
    await bundle(root);
    await publisher.validateBundle(root);
    await writeFile(path.join(root, 'install.sh'), 'changed');
    await assert.rejects(publisher.validateBundle(root), /digest differs/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function withRegistry(handler, body) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await body(`127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
test('only typed absence permits initial publication; denied and proxy failures refuse', async () => {
  for (const [status, body, expected] of [
    [403, 'denied', /403/],
    [404, JSON.stringify({ message: 'proxy404' }), /Unrecognized 404/],
  ]) {
    await withRegistry(
      (_req, res) => res.writeHead(status).end(body),
      (registry) =>
        assert.rejects(publisher.manifest(registry, 'fixture/robota', '1.0.0'), expected),
    );
  }
  await withRegistry(
    (_req, res) =>
      res.writeHead(404).end(JSON.stringify({ errors: [{ code: 'MANIFEST_UNKNOWN' }] })),
    async (registry) =>
      assert.equal(await publisher.manifest(registry, 'fixture/robota', '1.0.0'), undefined),
  );
});
test('registry credentials never follow a cross-origin token challenge', async () => {
  await withRegistry(
    (_req, res) =>
      res
        .writeHead(401, {
          'www-authenticate': 'Bearer realm="https://other.example/token",service="fixture"',
        })
        .end(),
    (registry) =>
      assert.rejects(
        publisher.ociGet(registry, '/v2/fixture/manifests/1', {
          username: 'fixture',
          password: 'synthetic',
        }),
        /cross-origin/,
      ),
  );
});
test('corrupt OCI layer digest refuses before archive extraction', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'feature-corrupt-'));
  try {
    await withRegistry(
      (req, res) =>
        res.end(
          req.url.includes('/manifests/')
            ? JSON.stringify({ layers: [{ digest: `sha256:${'0'.repeat(64)}` }] })
            : 'corrupted',
        ),
      (registry) => assert.rejects(publisher.pullBundle(registry, 'fixture/robota', '1.0.0', root)),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('signed blob redirects receive neither registry bearer nor basic credentials', async () => {
  const requests = [];
  vi.stubGlobal('fetch', async (url, options) => {
    requests.push({ url: String(url), headers: { ...options.headers } });
    if (requests.length === 1)
      return {
        status: 401,
        headers: new Headers({
          'www-authenticate': 'Bearer realm="http://localhost:1234/token",service="fixture"',
        }),
      };
    if (requests.length === 2)
      return { ok: true, json: async () => ({ token: 'synthetic-bearer' }) };
    if (requests.length === 3)
      return {
        status: 307,
        url: 'http://localhost:1234/v2/fixture/blobs/sha256:fixture',
        headers: new Headers({ location: 'https://storage.example/signed-blob' }),
      };
    return { status: 200, ok: true };
  });
  await publisher.ociGet('localhost:1234', '/v2/fixture/blobs/sha256:fixture', {
    username: 'fixture',
    password: 'synthetic-password',
  });
  expect(requests[1].headers.Authorization).toMatch(/^Basic /);
  expect(requests[2].headers.Authorization).toBe('Bearer synthetic-bearer');
  expect(requests[3]).toEqual({ url: 'https://storage.example/signed-blob', headers: {} });
});

import { verifyPublished } from '../verify-published-feature.mjs';
test('failed anonymous consumer preserves complete child diagnostics and cleans its resources', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'feature-consumer-failure-'));
  const oldPath = process.env.PATH;
  const oldHost = process.env.DOCKER_HOST;
  try {
    const bin = path.join(root, 'bin');
    await mkdir(bin);
    const docker = path.join(bin, 'docker');
    await writeFile(
      docker,
      '#!/bin/sh\nprintf "%s\\n" "$DOCKER_HOST $*" >> "' +
        root +
        '/docker-calls"\ncase "$1" in context) printf "%s\\n" "unix:///tmp/fixture-docker.sock";; run) found="$(docker-credential-robota-anonymous get)"; [ "$found" = "credentials not found in native keychain" ] || exit 43; listed="$(docker-credential-robota-anonymous list)"; [ "$listed" = "{}" ] || exit 44;; esac\n',
      { mode: 0o755 },
    );
    const cli = path.join(bin, 'devcontainer');
    await writeFile(
      cli,
      '#!/bin/sh\nprintf "%s\\n" "FULL_DIAGNOSTIC_BEFORE_TRAILING_STACK" >&2\ncat "$DOCKER_CONFIG/config.json"\ncat "$3/.devcontainer/devcontainer.json" >&2\nexit 42\n',
      { mode: 0o755 },
    );
    process.env.PATH = bin + path.delimiter + oldPath;
    process.env.DOCKER_HOST = 'unix:///tmp/feature-explicit-test.sock';
    const receiptFile = path.join(root, 'receipt.json');
    await assert.rejects(
      verifyPublished({
        reference: 'localhost:1234/fixture/robota:1.0.0',
        digest: 'sha256:' + 'a'.repeat(64),
        cli,
        checkout: root,
        tempParent: root,
        receiptFile,
      }),
      /devcontainer failed/,
    );
    const receipt = JSON.parse(await readFile(receiptFile, 'utf8'));
    expect(receipt.normalAndCustomSlashBeforeAndAfterRebuild).toBe(false);
    const generatedConfig = JSON.parse(
      receipt.invocations
        .find((x) => x.command === cli)
        .stderr.split('\n')
        .find((line) => line.startsWith('{')),
    );
    expect(generatedConfig.updateRemoteUserUID).toBe(false);
    expect(JSON.parse(receipt.invocations.find((x) => x.command === cli).stdout)).toEqual({
      credsStore: 'robota-anonymous',
    });
    expect(receipt.invocations.find((x) => x.command === cli).stderr).toContain(
      'FULL_DIAGNOSTIC_BEFORE_TRAILING_STACK',
    );
    const calls = await readFile(path.join(root, 'docker-calls'), 'utf8');
    expect(calls).toContain('unix:///tmp/feature-explicit-test.sock network create');
    expect(calls).not.toContain('context inspect');
    expect(calls).toContain('network rm feature-consumer-');
    expect((await readdir(root)).filter((x) => x.startsWith('feature-anonymous-'))).toEqual([]);
  } finally {
    process.env.PATH = oldPath;
    if (oldHost === undefined) delete process.env.DOCKER_HOST;
    else process.env.DOCKER_HOST = oldHost;
    await rm(root, { recursive: true, force: true });
  }
});
