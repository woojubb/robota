#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
export async function verifyPublished({
  reference,
  digest,
  cli,
  checkout,
  tempParent = os.tmpdir(),
  receiptFile,
}) {
  assert.match(digest, /^sha256:[a-f0-9]{64}$/);
  const root = await mkdtemp(path.join(tempParent, 'feature-anonymous-'));
  const name = `feature-consumer-${process.pid}-${Date.now()}`;
  const resources = [];
  const volumes = [];
  const invocations = [];
  function call(command, args, env, cwd) {
    const r = spawnSync(command, args, {
      encoding: 'utf8',
      timeout: 420_000,
      env,
      cwd,
    });
    invocations.push({
      command,
      args,
      code: r.status,
      stdout: r.stdout,
      stderr: r.stderr,
    });
    if (r.error || r.status !== 0)
      throw new Error(`${path.basename(command)} failed: ${r.stderr?.slice(-1500)}`);
    return r.stdout.trim();
  }
  const dockerHost = call('docker', [
    'context',
    'inspect',
    '--format',
    '{{.Endpoints.docker.Host}}',
  ]);
  const env = Object.fromEntries(
    ['PATH', 'TMPDIR', 'LANG', 'LC_ALL']
      .filter((k) => process.env[k] !== undefined)
      .map((k) => [k, process.env[k]]),
  );
  Object.assign(env, {
    HOME: path.join(root, 'home'),
    DOCKER_CONFIG: path.join(root, 'docker'),
    DOCKER_HOST: dockerHost,
    PRODUCT_TELEMETRY_ENABLED: '0',
    ROBOTA_TELEMETRY_ENABLED: '0',
  });
  await mkdir(env.HOME);
  await mkdir(env.DOCKER_CONFIG);
  let result;
  try {
    call('docker', ['network', 'create', '--internal', name], env);
    call(
      'docker',
      [
        'run',
        '-d',
        '--name',
        name + '-provider',
        '--network',
        name,
        '--network-alias',
        'provider',
        '-e',
        'FIXTURE_TEXT=ANONYMOUS_FEATURE_COMPLETED',
        '--mount',
        `type=bind,source=${path.join(checkout, 'docker/robota/smoke/provider-fixture.mjs')},target=/provider.mjs,readonly`,
        'node:22-bookworm-slim',
        'node',
        '/provider.mjs',
      ],
      env,
    );
    resources.push(name + '-provider');
    const project = path.join(root, 'project');
    await mkdir(path.join(project, '.devcontainer'), { recursive: true });
    await writeFile(
      path.join(project, '.devcontainer', 'Dockerfile'),
      'FROM debian:bookworm-slim\nRUN groupadd -g 1000 editor && useradd -m -d /srv/editor -u 1000 -g 1000 editor && mkdir /srv/editor/work && chown 1000:1000 /srv/editor/work\n',
    );
    const workVolume = name + '-workspace';
    volumes.push(workVolume);
    const exact = reference.replace(/:[^/:]+$/, '') + '@' + digest;
    await writeFile(
      path.join(project, '.devcontainer', 'devcontainer.json'),
      JSON.stringify({
        build: { dockerfile: 'Dockerfile' },
        remoteUser: 'editor',
        containerUser: 'editor',
        userEnvProbe: 'none',
        features: { [exact]: {} },
        mounts: [{ type: 'volume', source: workVolume, target: '/srv/editor/work' }],
        runArgs: ['--network', name],
      }),
    );
    let cid;
    function exec(args) {
      return call(
        'docker',
        [
          'exec',
          '--user',
          'editor',
          '-e',
          'OPENAI_API_KEY=synthetic-feature-provider-key',
          '-e',
          'PRODUCT_TELEMETRY_ENABLED=0',
          '-e',
          'ROBOTA_TELEMETRY_ENABLED=0',
          '-w',
          '/srv/editor/work',
          cid,
          ...args,
        ],
        env,
      );
    }
    for (let iteration = 0; iteration < 2; iteration++) {
      const up = JSON.parse(
        call(
          cli,
          [
            'up',
            '--workspace-folder',
            project,
            ...(iteration ? ['--remove-existing-container'] : []),
            '--no-lockfile',
            '--log-format',
            'json',
          ],
          env,
        ),
      );
      cid = up.containerId;
      resources.push(cid);
      const mounts = JSON.parse(
        call('docker', ['inspect', '--format', '{{json .Mounts}}', cid], env),
      );
      for (const m of mounts) if (m.Destination === '/var/lib/robota/state') volumes.push(m.Name);
      if (iteration === 0) {
        exec(['git', 'init', '--quiet']);
        const skill =
          '---\nname: local-proof\ndescription: Verify the anonymously installed Feature with the synthetic provider.\n---\nReturn the requested completion text.\n';
        exec([
          'sh',
          '-c',
          'mkdir -p "$PRODUCT_USER_STATE_DIR/skills/local-proof"; printf "%s" "$1" > "$PRODUCT_USER_STATE_DIR/skills/local-proof/SKILL.md"',
          'feature',
          skill,
        ]);
        exec([
          'robota',
          '--configure-provider',
          'fixture',
          '--type',
          'openai',
          '--model',
          'fixture-model',
          '--base-url',
          'http://provider:8080/v1',
          '--api-key-env',
          'OPENAI_API_KEY',
          '--set-current',
        ]);
        exec(['robota', 'trust', '--yes']);
      }
      for (const prompt of ['Complete this installed session.', '/local-proof']) {
        const response = JSON.parse(exec(['robota', '-p', prompt, '--output-format', 'json']));
        assert.equal(response.subtype, 'success');
        assert.equal(response.result, 'ANONYMOUS_FEATURE_COMPLETED');
        assert(response.session_id.startsWith('session_'));
      }
    }
    const requests = call('docker', ['logs', name + '-provider'], env)
      .split('\n')
      .filter((x) => x.startsWith('request ')).length;
    assert.equal(requests, 4);
    result = {
      reference,
      exactDigestReference: exact,
      authenticatedEnvironment: false,
      normalAndCustomSlashBeforeAndAfterRebuild: true,
      providerRequests: requests,
      providerMode: 'internal disposable synthetic OpenAI protocol fixture',
      invocations,
    };
    if (receiptFile) await writeFile(receiptFile, JSON.stringify(result, null, 2));
    return result;
  } finally {
    for (const container of new Set(resources))
      spawnSync('docker', ['rm', '-f', container], { env });
    for (const volume of new Set(volumes)) spawnSync('docker', ['volume', 'rm', volume], { env });
    spawnSync('docker', ['network', 'rm', name], { env });
    await rm(root, { recursive: true, force: true });
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const input = JSON.parse(await readFile(process.argv[2], 'utf8'));
  console.log(JSON.stringify(await verifyPublished(input)));
}
