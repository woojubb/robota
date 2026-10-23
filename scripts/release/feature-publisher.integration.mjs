// Explicit controlled integration (never part of ordinary repository tests):
// FEATURE_DEVCONTAINER_CLI=/absolute/pinned-cli-0.89.0 FEATURE_ORAS_CLI=/absolute/oras-1.3.0
// FEATURE_BUNDLE_DIR=/absolute/prepared-bundle LOCAL_REGISTRY=localhost:PORT
// node --test scripts/release/feature-publisher.integration.mjs
// The caller owns the disposable registry lifecycle; temporary publication files are removed here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, cp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import {
  validateRelease,
  validateBundle,
  packageFeature,
  publishFeature,
  manifest,
} from './feature-publisher.mjs';
const cli = process.env.FEATURE_DEVCONTAINER_CLI;
const oras = process.env.FEATURE_ORAS_CLI;
const directory = process.env.FEATURE_BUNDLE_DIR;
assert(
  cli && oras && directory && process.env.LOCAL_REGISTRY,
  'Explicit pinned tool, prepared bundle and disposable registry paths required',
);
assert.match(
  process.env.LOCAL_REGISTRY,
  /^localhost:\d+$/,
  'Only disposable loopback integration registry allowed',
);
const source = 'a'.repeat(40);
const release = {
  tag: 'v3.0.0-beta.96',
  sha: source,
  sourceSha: source,
  tagPrefix: 'v',
  cliVersion: '3.0.0-beta.96',
  authoredPin: '3.0.0-beta.96',
  featureVersion: '1.0.0',
  id: 'robota',
  namespace: 'woojubb/devcontainer-features',
  repository: 'woojubb/robota',
  binaryRun: {
    name: 'Release — Bun binaries',
    head_sha: source,
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
test('release requires exact source/tag, explicit pin, native success, assets/npm/confirmed namespace', () => {
  validateRelease(release);
  for (const mutation of [
    { sourceSha: 'b'.repeat(40) },
    { tag: 'v3.0.0-beta.97' },
    { authoredPin: 'latest' },
    { namespace: 'someone/other' },
    { npmVersion: '3.0.0-beta.95' },
    { binaryRun: { ...release.binaryRun, conclusion: 'failure' } },
    { binaryRun: { ...release.binaryRun, event: 'pull_request' } },
    { release: { ...release.release, assets: [] } },
  ])
    assert.throws(() => validateRelease({ ...release, ...mutation }));
});
test('official packages are deterministic across separately normalized copies', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'feature-package-test-'));
  try {
    const a = await packageFeature(cli, directory, path.join(root, 'a'));
    await new Promise((r) => setTimeout(r, 1100));
    const b = await packageFeature(cli, directory, path.join(root, 'b'));
    assert.equal(a.sha256, b.sha256);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('bundle digest detects modified shell bytes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'feature-modify-test-'));
  try {
    await cp(directory, root, { recursive: true });
    await writeFile(path.join(root, 'launch.sh'), 'modified');
    await assert.rejects(validateBundle(root), /digest differs/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('registry authentication/network failure never means missing artifact', async () => {
  const server = createServer((req, res) => res.writeHead(403).end('denied'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    await assert.rejects(
      manifest(`127.0.0.1:${server.address().port}`, 'fixture/robota', '1.0.0'),
      /403/,
    );
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});
test('only typed OCI not-found permits initial publication', async () => {
  let proper = false;
  const server = createServer((req, res) => {
    res
      .writeHead(404, { 'Content-Type': 'application/json' })
      .end(
        JSON.stringify(
          proper ? { errors: [{ code: 'MANIFEST_UNKNOWN' }] } : { message: 'proxy error' },
        ),
      );
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const registry = `127.0.0.1:${server.address().port}`;
    await assert.rejects(manifest(registry, 'fixture/robota', '1.0.0'), /Unrecognized 404/);
    proper = true;
    assert.equal(await manifest(registry, 'fixture/robota', '1.0.0'), undefined);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});
test(
  'real local OCI: publish, anonymous pull, identical retry, changed-version refusal',
  { skip: !process.env.LOCAL_REGISTRY },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'feature-oci-test-'));
    const namespace = `fixture/test-${process.pid}-${Date.now()}`;
    try {
      const first = await publishFeature({
        cli,
        oras,
        directory,
        registry: process.env.LOCAL_REGISTRY,
        namespace,
        temp: path.join(root, 'first'),
      });
      assert.equal(first.disposition, 'publish');
      assert(first.digest.startsWith('sha256:'));
      const retry = await publishFeature({
        cli,
        oras,
        directory,
        registry: process.env.LOCAL_REGISTRY,
        namespace,
        temp: path.join(root, 'retry'),
      });
      assert.equal(retry.disposition, 'skip');
      assert.equal(retry.digest, first.digest);
      const changed = path.join(root, 'changed');
      await cp(directory, changed, { recursive: true });
      const receipt = JSON.parse(
        await readFile(path.join(changed, 'feature-release.json'), 'utf8'),
      );
      receipt.cliVersion = '3.0.0-beta.97';
      const metadata = JSON.parse(
        await readFile(path.join(changed, 'devcontainer-feature.json'), 'utf8'),
      );
      metadata.options.version.default = receipt.cliVersion;
      await writeFile(
        path.join(changed, 'devcontainer-feature.json'),
        JSON.stringify(metadata) + '\n',
      );
      // Recompute a legitimate changed-bundle receipt: guard must reject even a valid replacement.
      const { createHash } = await import('node:crypto');
      const { readdir } = await import('node:fs/promises');
      const digest = createHash('sha256');
      for (const name of (await readdir(changed))
        .filter((x) => x !== 'feature-release.json')
        .sort()) {
        digest.update(name);
        digest.update('\0');
        digest.update(await readFile(path.join(changed, name)));
        digest.update('\0');
      }
      receipt.contentDigest = digest.digest('hex');
      await writeFile(path.join(changed, 'feature-release.json'), JSON.stringify(receipt));
      await assert.rejects(
        publishFeature({
          cli,
          oras,
          directory: changed,
          registry: process.env.LOCAL_REGISTRY,
          namespace,
          temp: path.join(root, 'changed-run'),
        }),
        /Bump the authored/,
      );
      console.log(JSON.stringify({ localOci: first, identicalRetry: retry }));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test('real local OCI: retry repairs partial aliases and older versions cannot move latest backwards', async () => {
  const { spawnSync } = await import('node:child_process');
  const { createHash } = await import('node:crypto');
  const { readdir } = await import('node:fs/promises');
  const root = await mkdtemp(path.join(os.tmpdir(), 'feature-alias-test-'));
  const namespace = `fixture/aliases-${process.pid}-${Date.now()}`;
  const registry = process.env.LOCAL_REGISTRY;
  const publish = (bundle, temp) =>
    publishFeature({
      cli,
      oras,
      directory: bundle,
      registry,
      namespace,
      temp: path.join(root, temp),
    });
  try {
    const old = await publish(directory, 'old');
    const newer = path.join(root, 'newer');
    await cp(directory, newer, { recursive: true });
    const metadata = JSON.parse(
      await readFile(path.join(newer, 'devcontainer-feature.json'), 'utf8'),
    );
    metadata.version = '2.0.0';
    await writeFile(path.join(newer, 'devcontainer-feature.json'), JSON.stringify(metadata));
    const receipt = JSON.parse(await readFile(path.join(newer, 'feature-release.json'), 'utf8'));
    receipt.featureVersion = '2.0.0';
    const digest = createHash('sha256');
    for (const name of (await readdir(newer)).filter((x) => x !== 'feature-release.json').sort()) {
      digest.update(name);
      digest.update('\0');
      digest.update(await readFile(path.join(newer, name)));
      digest.update('\0');
    }
    receipt.contentDigest = digest.digest('hex');
    await writeFile(path.join(newer, 'feature-release.json'), JSON.stringify(receipt));
    const next = await publish(newer, 'next');
    const config = path.join(root, 'empty-docker.json');
    await writeFile(config, '{}');
    const tag = spawnSync(
      oras,
      ['tag', old.reference, 'latest', '--registry-config', config, '--plain-http'],
      { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: root } },
    );
    assert.equal(tag.status, 0, tag.stderr);
    const repaired = await publish(newer, 'repair');
    assert.equal(repaired.disposition, 'skip');
    assert.equal((await manifest(registry, `${namespace}/robota`, 'latest')).digest, next.digest);
    await publish(directory, 'older-retry');
    assert.equal((await manifest(registry, `${namespace}/robota`, 'latest')).digest, next.digest);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
