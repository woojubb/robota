#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  mkdtemp,
  readFile,
  readdir,
  mkdir,
  writeFile,
  cp,
  chmod,
  utimes,
  rm,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function run(command, args, options = {}) {
  const r = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 300_000,
    ...options,
  });
  if (r.error || r.status !== 0) {
    if (command === 'python3') throw new Error(r.stderr.slice(-2000));
    throw new Error(
      `${path.basename(command)} failed (${r.status ?? r.error?.code}); inspect redacted workflow command logs.`,
    );
  }
  return r.stdout.trim();
}
export function validateRelease({
  tag,
  sha,
  sourceSha,
  tagPrefix,
  cliVersion,
  authoredPin,
  featureVersion,
  id,
  namespace,
  repository,
  binaryRun,
  release,
  npmVersion,
}) {
  assert.match(sha, /^[a-f0-9]{40}$/);
  assert.equal(sourceSha, sha, 'Feature source must be the exact release tag commit');
  assert.equal(tag, `${tagPrefix}${cliVersion}`, 'Tag and selected CLI version differ');
  assert.equal(
    authoredPin,
    cliVersion,
    'Deliberately update the authored Feature CLI pin for this release',
  );
  assert.match(featureVersion, /^\d+\.\d+\.\d+$/);
  assert.equal(id, 'robota', 'Only the owner-confirmed product may publish in this namespace');
  assert.equal(namespace, 'woojubb/devcontainer-features', 'Owner-confirmed namespace differs');
  assert.equal(repository, 'woojubb/robota', 'Release repository differs');
  assert.equal(binaryRun.name, 'Release — Bun binaries');
  assert.equal(binaryRun.head_sha, sha, 'Native workflow source differs');
  assert.equal(binaryRun.conclusion, 'success', 'Native workflow is not successful');
  assert.notEqual(binaryRun.event, 'pull_request', 'PR validation cannot authorize publication');
  assert.equal(release.tag_name, tag);
  assert.equal(release.draft, false, 'Release is still a draft');
  for (const name of ['robota-linux-x64', 'robota-linux-arm64', 'SHA256SUMS.txt'])
    assert(
      release.assets.some((asset) => asset.name === name),
      `Missing released asset ${name}`,
    );
  assert.equal(npmVersion, cliVersion, 'Exact public npm CLI version is unavailable');
}
export async function validateBundle(directory) {
  const receipt = JSON.parse(await readFile(path.join(directory, 'feature-release.json'), 'utf8'));
  const meta = JSON.parse(
    await readFile(path.join(directory, 'devcontainer-feature.json'), 'utf8'),
  );
  assert.equal(meta.id, receipt.id);
  assert.equal(meta.version, receipt.featureVersion);
  assert.equal(meta.options.version.default, receipt.cliVersion);
  const digest = createHash('sha256');
  for (const name of (await readdir(directory))
    .filter((x) => x !== 'feature-release.json')
    .sort()) {
    assert(!name.includes('/') && !name.includes('..'));
    digest.update(name);
    digest.update('\0');
    digest.update(await readFile(path.join(directory, name)));
    digest.update('\0');
  }
  assert.equal(
    digest.digest('hex'),
    receipt.contentDigest,
    'Bundle receipt digest differs from actual contents',
  );
  return receipt;
}
export async function packageFeature(cli, directory, out) {
  const stage = path.join(out, 'normalized');
  await mkdir(out, { recursive: true });
  await cp(directory, stage, { recursive: true });
  for (const name of await readdir(stage)) {
    await chmod(path.join(stage, name), name.endsWith('.sh') ? 0o755 : 0o644);
    await utimes(path.join(stage, name), 0, 0);
  }
  await utimes(stage, 0, 0);
  run(cli, ['features', 'package', stage, '--output-folder', path.join(out, 'package')]);
  const archive = (await readdir(path.join(out, 'package'))).find((x) => x.endsWith('.tgz'));
  assert(archive, 'Official publisher did not package a Feature');
  const packaged = path.join(out, 'package', archive);
  const canonical = packaged + '.canonical';
  run('python3', [
    '-c',
    `import tarfile,sys
with tarfile.open(sys.argv[1]) as source, tarfile.open(sys.argv[2], 'w', format=tarfile.USTAR_FORMAT) as target:
 for member in sorted(source.getmembers(), key=lambda m:m.name):
  if not (member.isfile() or member.isdir()): raise ValueError('Only flat regular files/directories are allowed')
  member.uid=member.gid=0; member.uname=member.gname=''; member.mtime=0; member.pax_headers={}
  member.mode=0o755 if member.isdir() or member.name.endswith('.sh') else 0o644
  target.addfile(member, source.extractfile(member) if member.isfile() else None)
`,
    packaged,
    canonical,
  ]);
  await cp(canonical, packaged);
  await rm(canonical);
  const bytes = await readFile(packaged);
  return {
    stage,
    archive: path.join(out, 'package', archive),
    sha256: hash(bytes),
  };
}
function base(registry) {
  assert(/^[a-z0-9.:-]+$/.test(registry), 'Invalid registry');
  if (/^(localhost|127\.0\.0\.1):\d+$/.test(registry)) return `http://${registry}`;
  assert.equal(registry, 'ghcr.io', 'Only confirmed GHCR or disposable loopback registry allowed');
  return 'https://ghcr.io';
}
export async function ociGet(registry, route, credentials) {
  const origin = base(registry);
  const headers = { Accept: 'application/vnd.oci.image.manifest.v1+json' };
  let response = await fetch(`${origin}${route}`, {
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 401) {
    const challenge = response.headers.get('www-authenticate') ?? '';
    const realm = /realm="([^"]+)"/.exec(challenge)?.[1];
    assert(realm, 'Registry authentication challenge missing realm');
    const tokenUrl = new URL(realm);
    assert.equal(tokenUrl.origin, origin, 'Refusing cross-origin registry credential forwarding');
    for (const key of ['service', 'scope']) {
      const v = new RegExp(`${key}="([^"]+)"`).exec(challenge)?.[1];
      if (v) tokenUrl.searchParams.set(key, v);
    }
    const authHeaders = credentials
      ? {
          Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`,
        }
      : {};
    const tokenResponse = await fetch(tokenUrl, {
      headers: authHeaders,
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    assert(
      tokenResponse.ok,
      `Registry token request refused (${tokenResponse.status}); owner access may be required`,
    );
    const tokenBody = await tokenResponse.json();
    const token = tokenBody.token ?? tokenBody.access_token;
    assert(typeof token === 'string' && token.length > 0, 'Registry token response invalid');
    headers.Authorization = `Bearer ${token}`;
    response = await fetch(`${origin}${route}`, {
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
  }
  for (let count = 0; [301, 302, 303, 307, 308].includes(response.status); count++) {
    assert(count < 4, 'Too many registry blob redirects');
    const target = new URL(response.headers.get('location'), response.url);
    assert(
      target.protocol === 'https:' || target.origin === origin,
      'Refusing insecure cross-origin blob redirect',
    );
    // Signed blob storage URLs receive no registry Authorization or credentials.
    response = await fetch(target, {
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
  }
  return response;
}
export async function manifest(registry, repository, version, credentials) {
  const response = await ociGet(registry, `/v2/${repository}/manifests/${version}`, credentials);
  if (response.status === 404) {
    const body = await response.json();
    assert(
      body.errors?.some((x) => ['MANIFEST_UNKNOWN', 'NAME_UNKNOWN'].includes(x.code)),
      'Unrecognized 404; refusing to infer absence',
    );
    return undefined;
  }
  assert(
    response.ok,
    `OCI manifest refused (${response.status}); permissions/network are not absence`,
  );
  return {
    body: await response.json(),
    digest: response.headers.get('docker-content-digest'),
  };
}
export async function pullBundle(registry, repository, version, out, credentials) {
  const m = await manifest(registry, repository, version, credentials);
  if (!m) return undefined;
  assert.equal(m.body.layers.length, 1, 'Expected one Feature archive layer');
  const layer = m.body.layers[0];
  assert.match(layer.digest, /^sha256:[a-f0-9]{64}$/);
  const response = await ociGet(registry, `/v2/${repository}/blobs/${layer.digest}`, credentials);
  assert(
    response.ok,
    `Feature archive pull refused (${response.status}); anonymous package visibility may need owner action`,
  );
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(`sha256:${hash(bytes)}`, layer.digest);
  await mkdir(out, { recursive: true });
  const archive = path.join(out, 'feature.tgz');
  await writeFile(archive, bytes);
  const directory = path.join(out, 'contents');
  await mkdir(directory);
  run('python3', [
    '-c',
    `import tarfile,sys,os
with tarfile.open(sys.argv[1]) as archive:
 for entry in archive.getmembers():
  name=entry.name.removeprefix('./')
  if not (entry.isfile() or entry.isdir()): raise ValueError('Unsafe archive type')
  if name not in ('','.'): 
   if '/' in name or name in ('..',) or not entry.isfile(): raise ValueError('Unsafe Feature archive entry')
 for entry in archive.getmembers():
  if entry.isfile():
   target=os.path.join(sys.argv[2],entry.name.removeprefix('./'))
   with open(target, 'xb') as output: output.write(archive.extractfile(entry).read())
   os.chmod(target, entry.mode & 0o777)
`,
    archive,
    directory,
  ]);
  return {
    receipt: await validateBundle(directory),
    directory,
    digest: m.digest,
    archiveSha256: hash(bytes),
  };
}
export async function publishFeature({
  cli,
  oras,
  directory,
  registry,
  namespace,
  temp,
  credentials,
}) {
  const current = await validateBundle(directory);
  const repository = `${namespace}/${current.id}`;
  const existing = await pullBundle(
    registry,
    repository,
    current.featureVersion,
    path.join(temp, 'existing'),
    credentials,
  );
  if (existing && existing.receipt.contentDigest !== current.contentDigest)
    throw new Error(
      'Bump the authored Feature version before publishing changed contents or CLI pin.',
    );
  const packaged = await packageFeature(cli, directory, path.join(temp, 'prepared'));
  {
    const config = path.join(temp, 'publisher-docker');
    await mkdir(config);
    // Existing ephemeral workflow token is scoped only to this job, never written to repository/artifacts.
    if (credentials)
      await writeFile(
        path.join(config, 'config.json'),
        JSON.stringify({
          auths: {
            [registry]: {
              auth: Buffer.from(`${credentials.username}:${credentials.password}`).toString(
                'base64',
              ),
            },
          },
        }),
        { mode: 0o600 },
      );
    try {
      const metadata = JSON.parse(
        await readFile(path.join(directory, 'devcontainer-feature.json'), 'utf8'),
      );
      const configFile = path.join(temp, 'config.json');
      await writeFile(configFile, '{}');
      const authFile = path.join(config, 'config.json');
      if (!credentials) await writeFile(authFile, '{}');
      const registryArgs = [
        '--registry-config',
        authFile,
        ...(registry.startsWith('localhost:') ? ['--plain-http'] : []),
      ];
      if (!existing)
        run(
          oras,
          [
            'push',
            `${registry}/${repository}:${current.featureVersion}`,
            '--config',
            `${configFile}:application/vnd.devcontainers`,
            '--annotation',
            `dev.containers.metadata=${JSON.stringify(metadata)}`,
            '--annotation',
            'org.opencontainers.image.created=1970-01-01T00:00:00Z',
            ...registryArgs,
            `${path.basename(packaged.archive)}:application/vnd.devcontainers.layer.v1+tar`,
          ],
          {
            cwd: path.dirname(packaged.archive),
            env: { PATH: process.env.PATH, HOME: temp },
          },
        );
      for (const alias of [
        current.featureVersion.split('.').slice(0, 2).join('.'),
        current.featureVersion.split('.')[0],
        'latest',
      ]) {
        const previous = await pullBundle(
          registry,
          repository,
          alias,
          path.join(temp, `alias-${alias}`),
          credentials,
        );
        const tuple = (x) => x.split('.').map(Number);
        const a = tuple(current.featureVersion),
          b = tuple(previous?.receipt.featureVersion ?? '0.0.0');
        const newer = a.findIndex((x, i) => x !== b[i]);
        if (newer < 0 || a[newer] >= b[newer])
          run(
            oras,
            ['tag', `${registry}/${repository}:${current.featureVersion}`, alias, ...registryArgs],
            { env: { PATH: process.env.PATH, HOME: temp } },
          );
      }
    } finally {
      await rm(config, { recursive: true, force: true });
    }
  }
  // No auth argument or ambient Docker config is used for this independent read.
  let anonymous;
  try {
    anonymous = await pullBundle(
      registry,
      repository,
      current.featureVersion,
      path.join(temp, 'anonymous'),
    );
  } catch (cause) {
    throw new Error(
      'Anonymous OCI consumption failed. Authenticated push is not public delivery; owner must inspect package visibility/access. No settings were changed.',
      { cause },
    );
  }
  assert(anonymous, 'Anonymous OCI reference absent after publication');
  assert.equal(anonymous.receipt.contentDigest, current.contentDigest);
  if (!existing)
    assert.equal(
      anonymous.archiveSha256,
      packaged.sha256,
      'Published archive differs from deterministic package',
    );
  return {
    disposition: existing ? 'skip' : 'publish',
    reference: `${registry}/${repository}:${current.featureVersion}`,
    digest: anonymous.digest,
    archiveSha256: anonymous.archiveSha256,
    packageSha256: packaged.sha256,
  };
}

export function validateNativeJobs(jobs) {
  const binaries = jobs.filter((x) => x.name.startsWith('Build Bun /'));
  assert.equal(binaries.length, 5, 'Need exactly five matching native build jobs');
  assert.deepEqual(
    binaries.map((x) => x.name).sort(),
    ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'windows-x64']
      .map((target) => `Build Bun / configured / ${target}`)
      .sort(),
    'Native build target set differs',
  );
  assert(
    binaries.every((x) => x.status === 'completed' && x.conclusion === 'success'),
    'Native job incomplete/unsuccessful',
  );
  assert(
    jobs.some(
      (x) =>
        x.name === 'Publish verified Bun binaries' &&
        x.status === 'completed' &&
        x.conclusion === 'success',
    ),
    'Native publication job incomplete/unsuccessful',
  );
}

export async function readPublicNativeEvidence(repository, runId) {
  assert.equal(repository, 'woojubb/robota', 'Release repository differs');
  assert.match(String(runId), /^[1-9]\d*$/, 'Invalid native workflow run ID');
  async function get(suffix) {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/actions/runs/${runId}${suffix}`,
      {
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      },
    );
    assert(
      response.ok,
      `Public native metadata unavailable (${response.status}); refusing publication`,
    );
    return response.json();
  }
  const workflow = await get('');
  const page = await get('/jobs?per_page=100&filter=latest');
  assert(
    Array.isArray(page.jobs) && page.total_count === page.jobs.length,
    'Native workflow jobs incomplete; refusing publication',
  );
  return { workflow, jobs: page.jobs };
}

export async function validateLiveRelease({
  checkout,
  workspace,
  tag,
  runId,
  namespace,
  repository,
}) {
  const head = run('git', ['rev-parse', 'HEAD'], { cwd: checkout });
  assert.equal(
    run('git', ['status', '--porcelain'], { cwd: checkout }),
    '',
    'Release checkout must be clean',
  );
  const sourceSha = run('git', ['rev-parse', `${tag}^{commit}`], {
    cwd: checkout,
  });
  for (const file of [
    'devcontainer-features/src/robota/devcontainer-feature.json',
    'scripts/release/prepare-devcontainer-feature.mjs',
    'scripts/release/feature-publisher.mjs',
    'scripts/release/verify-published-feature.mjs',
  ])
    await readFile(path.join(checkout, file));
  const identity = JSON.parse(
    await readFile(path.join(workspace, '.product/identity.json'), 'utf8'),
  );
  const cli = JSON.parse(
    await readFile(path.join(workspace, 'packages/agent-cli/package.json'), 'utf8'),
  );
  const authored = JSON.parse(
    await readFile(
      path.join(checkout, 'devcontainer-features/src/robota/devcontainer-feature.json'),
      'utf8',
    ),
  );
  const { workflow, jobs } = await readPublicNativeEvidence(repository, runId);
  validateNativeJobs(jobs);
  const released = JSON.parse(
    run('gh', ['api', `repos/${repository}/releases/tags/${encodeURIComponent(tag)}`]),
  );
  const npm = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(cli.name)}/${encodeURIComponent(cli.version)}`,
    { redirect: 'error', signal: AbortSignal.timeout(30_000) },
  );
  assert(npm.ok, 'Exact public npm CLI version unavailable');
  const npmVersion = (await npm.json()).version;
  validateRelease({
    tag,
    sha: head,
    sourceSha,
    tagPrefix: process.env.PROJECT_RELEASE_TAG_PREFIX,
    cliVersion: cli.version,
    authoredPin: authored.options.version.default,
    featureVersion: authored.version,
    id: identity.identity.id,
    namespace,
    repository,
    binaryRun: { ...workflow, conclusion: 'success' },
    release: released,
    npmVersion,
  });
  assert.equal(identity.identity.repositoryUrl, `https://github.com/${repository}`);
  const assets = await mkdtemp(path.join(os.tmpdir(), 'feature-release-assets-'));
  try {
    run('gh', [
      'release',
      'download',
      tag,
      '--repo',
      repository,
      '--dir',
      assets,
      '--pattern',
      'robota-linux-x64',
      '--pattern',
      'robota-linux-arm64',
      '--pattern',
      'SHA256SUMS.txt',
    ]);
    const sums = await readFile(path.join(assets, 'SHA256SUMS.txt'), 'utf8');
    for (const name of ['robota-linux-x64', 'robota-linux-arm64']) {
      const expected = sums
        .split('\n')
        .find((x) => x.endsWith(`  ${name}`))
        ?.split(/\s+/)[0];
      assert.equal(
        hash(await readFile(path.join(assets, name))),
        expected,
        `Released checksum mismatch ${name}`,
      );
    }
  } finally {
    await rm(assets, { recursive: true, force: true });
  }
  return {
    tag,
    head,
    runId,
    cliVersion: cli.version,
    featureVersion: authored.version,
    namespace,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [command, input] = process.argv.slice(2);
  const options = JSON.parse(await readFile(input, 'utf8'));
  const temp = await mkdtemp(path.join(os.tmpdir(), 'feature-publish-'));
  try {
    if (command === 'release') {
      await validateLiveRelease(options);
      const { prepareFeature } = await import(
        path.join(options.checkout, 'scripts/release/prepare-devcontainer-feature.mjs')
      );
      const prepared = await prepareFeature({
        workspace: options.workspace,
        out: path.join(temp, 'feature'),
      });
      options.directory = prepared.directory;
    } else {
      assert.equal(command, 'publish');
      assert.match(
        options.registry,
        /^localhost:\d+$/,
        'Direct publish mode is only for disposable local-registry tests; GHCR requires release validation',
      );
    }
    const credentials = process.env.GITHUB_TOKEN
      ? {
          username: process.env.GITHUB_ACTOR,
          password: process.env.GITHUB_TOKEN,
        }
      : undefined;
    const receipt = await publishFeature({ ...options, temp, credentials });
    if (options.receiptFile) await writeFile(options.receiptFile, JSON.stringify(receipt, null, 2));
    console.log(JSON.stringify(receipt));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
