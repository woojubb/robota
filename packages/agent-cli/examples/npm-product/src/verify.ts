import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDesktopCliController } from '@robota-sdk/agent-cli/desktop-host';
import { createProductCliHost } from '@robota-sdk/agent-cli/host';

import { createFixtureCommandModule } from './shared/command.js';
import { localProviderDefinitions } from './shared/provider.js';
import { productArtifact } from './shared/product.js';

const home = mkdtempSync(join(tmpdir(), 'npm-product-fixture-'));
try {
  const cedar = createProductCliHost(productArtifact('cedar', 'node'));
  const amber = createProductCliHost(productArtifact('amber', 'node'));
  const first = cedar.resolveRuntime({ environment: { HOME: home } });
  const second = amber.resolveRuntime({ environment: { HOME: home } });
  assert.equal(first.config.identity.id, 'cedar');
  assert.equal(second.config.identity.id, 'amber');
  assert.notEqual(first.layout.userRoot, second.layout.userRoot);
  assert.notEqual(first.config.credentials.serviceNamespace, second.config.credentials.serviceNamespace);
  assert.notEqual(first.config.identity.daemonNamespace, second.config.identity.daemonNamespace);
  assert.notEqual(first.config.crypto.namespace, second.config.crypto.namespace);
  assert.equal(first.artifact?.version, '1.0.0-pre.1');
  assert.equal(cedar.resolveRuntime({ environment: { HOME: home, PRODUCT_ID: 'amber' } }).config.identity.id, 'cedar');
  assert.equal(createProductCliHost(productArtifact('cedar', 'node')).resolveRuntime({ environment: { HOME: home } }).config.identity.id, 'cedar');

  for (const product of ['cedar', 'amber'] as const) {
    const entry = fileURLToPath(new URL(`./node/${product}.js`, import.meta.url));
    const processRun = spawnSync(process.execPath, [entry, '--version'], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: home, TMPDIR: process.env.TMPDIR },
      timeout: 20_000,
    });
    assert.equal(processRun.status, 0, `${product} entry re-execution: ${processRun.stderr}`);
    assert.match(processRun.stdout, /1\.0\.0-pre\.1/u);

    const renderer = new URL(`../renderer/${product}/index.html`, import.meta.url);
    const html = readFileSync(renderer, 'utf8');
    const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/gu)]
      .filter(([, path]) => path?.includes('assets/'));
    assert.ok(assets.length >= 2, `${product} renderer should include script and stylesheet assets`);
    for (const [, asset] of assets) {
      assert.ok(existsSync(fileURLToPath(new URL(asset!, renderer))),
        `${product} renderer asset ${asset} must resolve from its file URL`);
    }
  }

  const command = createFixtureCommandModule('cedar').systemCommands?.[0];
  assert.ok(command);
  assert.equal(command.modelInvocable, true);
  assert.equal(command.safety, 'read-only');
  assert.equal(command.modelRequiresPermission, false);
  assert.match(command.modelDescription ?? '', /Use it when checking/u);
  assert.deepEqual(await command.execute({} as never, ''), {
    success: true, message: 'CEDAR fixture review is ready.',
  });

  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? '');
    request.resume();
    response.setHeader('content-type', 'application/json');
    if (request.url === '/v1/models') {
      response.end(JSON.stringify({ data: [{ id: 'fixture-model' }] }));
    } else if (request.url === '/v1/chat/completions') {
      response.end(JSON.stringify({
        id: 'fixture', object: 'chat.completion', created: 1, model: 'fixture-model',
        choices: [{ index: 0, message: { role: 'assistant', content: 'CEDAR fixture response.' }, finish_reason: 'stop' }],
      }));
    } else response.writeHead(404).end('{}');
  });
  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', done);
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const baseURL = `http://127.0.0.1:${address.port}/v1`;
    const definition = localProviderDefinitions('cedar')[0]!;
    assert.equal((await definition.probeProfile?.({ type: 'gemma', model: 'fixture-model', baseURL }))?.ok, true);
    const provider = definition.createProvider({ name: 'gemma', model: 'fixture-model', baseURL });
    const reply = await provider.chat([
      { id: 'one', role: 'user', content: 'ping', state: 'complete', timestamp: new Date() },
    ], { model: 'fixture-model' });
    assert.equal(reply.content, 'CEDAR fixture response.');
    assert.deepEqual(requests, ['/v1/models', '/v1/chat/completions']);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done, fail) => server.close((error) => error ? fail(error) : done()));
  }

  const calls: { args: readonly string[]; environment: Readonly<Record<string, string>> }[] = [];
  let port = 44001;
  const desktop = createDesktopCliController({
    artifact: productArtifact('cedar', 'native'),
    environment: { HOME: home, PATH: process.env.PATH, UNLISTED_SECRET: 'must-not-forward' },
    chooseTrust: async () => 'restricted',
    execute: async (args, environment) => {
      calls.push({ args, environment });
      if (args[0] === 'trust') return { exitCode: 0, stdout: '{"askable":true,"workspace":"/fixture","loads":["settings"]}', stderr: '' };
      return { exitCode: 0, stdout: JSON.stringify({ id: 'fixture-daemon', url: `ws://127.0.0.1:${port++}/?token=fixture` }), stderr: '' };
    },
  });
  assert.equal((await desktop.start()).ok, true);
  assert.deepEqual(calls.map((call) => call.args[0]), ['trust', 'daemon']);
  assert.ok(calls[1]?.args.includes('--restricted-workspace'));
  assert.equal(calls[1]?.environment.UNLISTED_SECRET, undefined);
  assert.equal(desktop.port(), 44001);
  assert.match(desktop.csp(), /ws:\/\/127\.0\.0\.1:44001/u);
  assert.equal((await desktop.reconnect()).ok, true);
  assert.equal(desktop.port(), 44002);
  assert.deepEqual(calls.map((call) => call.args[0]), ['trust', 'daemon', 'daemon']);

  process.stdout.write('Cedar/Amber identity, re-entry, local provider, command and desktop attachment checks passed.\n');
} finally {
  rmSync(home, { recursive: true, force: true });
}
