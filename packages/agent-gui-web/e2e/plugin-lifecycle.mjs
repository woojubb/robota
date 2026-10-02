/** Actual GUI withdrawal, current installed revision, and fresh-runtime MCP revalidation. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { createNodeWorkspaceTrustService } from '../../agent-framework/src/index.ts';
import { createTestBinaryEnvironment, createTestProductRuntime } from '../../agent-cli/src/__tests__/helpers/product-runtime.ts';
import { respond, wireReceipts } from '../../agent-cli/src/__tests__/helpers/provider-wire-fixture.ts';
import { createInitialCliWorkspaceComposition } from '../../agent-cli/src/startup/workspace-project-composition.ts';

const executablePath = process.argv[2];
const provider = process.argv[3] ?? 'anthropic';
const change = process.argv[4] ?? 'disable';
assert.ok(executablePath && isAbsolute(executablePath) && existsSync(executablePath));
assert.ok(['anthropic', 'openai'].includes(provider));
assert.ok(['disable', 'uninstall', 'update'].includes(change));
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cliRoot = join(packageRoot, '../agent-cli');
const loader = pathToFileURL(createRequire(join(cliRoot, 'package.json')).resolve('tsx')).href;
const root = mkdtempSync(join(tmpdir(), 'gui-plugin-lifecycle-'));
const home = join(root, 'home');
const statePath = join(root, 'effects.json');
const runtime = createTestProductRuntime('test-product', { HOME: home });
const pluginsDir = join(runtime.layout.userRoot, 'plugins');
const recordPath = join(pluginsDir, 'installed_plugins.json');
const source = (revision) => join(pluginsDir, 'cache', 'market', 'fixture', revision);
const toolName = 'fixture_probe__echo';
const token = randomBytes(32).toString('hex');
const calls = [];
const modelRequests = [];
const initial = [
  { id: 'life-0', name: toolName, args: { text: 'old-effect' } },
  { id: 'life-1', name: toolName, args: { text: 'forbidden-chain-effect' } },
  { id: 'life-2', name: 'Read', args: { filePath: statePath } },
];
const fresh = { id: 'life-fresh', name: toolName, args: { text: 'fresh-effect' } };
let browser;
let web;
let rpc;
let child;
let phase = 'initial';
let round = 0;
let releaseResponse;
let serverFailure;
let diagnostics = '';
let currentPage;
let report;
const failures = [];
const until = async (predicate, label) => {
  const deadline = Date.now() + 20_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out awaiting ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};
async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}
async function close(server) {
  if (!server) return;
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
async function stop() {
  if (!child) return;
  const owned = child;
  child = undefined;
  if (owned.exitCode !== null || owned.signalCode !== null) {
    assert.equal(owned.exitCode, 0, diagnostics);
    assert.equal(owned.signalCode, null);
    return;
  }
  let timer;
  const exited = new Promise((resolve, reject) => {
    owned.once('exit', (code, signal) => {
      clearTimeout(timer);
      code === 0 && signal === null ? resolve() : reject(new Error(`CLI exit ${code}/${signal}`));
    });
    timer = setTimeout(() => { owned.kill('SIGKILL'); reject(new Error('CLI stop timed out')); }, 10_000);
  });
  owned.kill('SIGTERM');
  await exited;
}
function select(revision) {
  writeFileSync(recordPath, JSON.stringify({ 'fixture@market': {
    pluginName: 'fixture', marketplace: 'market', version: revision,
    installPath: source(revision), installedAt: 'fixture',
  } }));
}

try {
  mkdirSync(runtime.layout.userRoot, { recursive: true });
  writeFileSync(statePath, JSON.stringify({ effects: [] }));
  rpc = createServer(async (request, response) => {
    try {
      if (request.method === 'GET') {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' }).write(': ready\n\n');
        return;
      }
      let raw = '';
      for await (const chunk of request) raw += String(chunk);
      const wire = JSON.parse(raw);
      if (request.url?.startsWith('/v1/')) {
        if (!wire.tools?.some((tool) => (tool.name ?? tool.function?.name) === 'Read')) {
          respond(provider, response, wire.stream === true, -1);
          return;
        }
        const index = round++;
        const steps = phase === 'initial' ? initial : [fresh];
        const history = phase === 'initial' ? [] : initial.map((step) => step.id);
        const receipts = wireReceipts(provider, wire);
        assert.deepEqual(receipts.map((receipt) => receipt.id), [...history, ...steps.slice(0, index).map((step) => step.id)]);
        if (provider === 'anthropic') for (const receipt of receipts) {
          assert.equal(receipt.failed, receipt.id === 'life-1' || (receipt.id === fresh.id && change !== 'update'));
        }
        if (index > 0 || phase === 'restored') assert.match(JSON.stringify(receipts[0].content), /OBSERVED_old-effect/);
        assert.ok(index <= steps.length);
        modelRequests.push({ phase, index });
        respond(provider, response, wire.stream === true, index, steps[index], phase === 'initial' ? 'PLUGIN_CHAIN_DONE' : 'PLUGIN_RECOVERY_DONE');
        return;
      }
      assert.ok(['/pinned', '/updated'].includes(request.url), 'No unselected source receives traffic');
      if (wire.id === undefined) { response.writeHead(202).end(); return; }
      let result = {};
      if (wire.method === 'initialize') result = {
        protocolVersion: '2025-11-25', capabilities: { tools: {} },
        serverInfo: { name: 'plugin-lifecycle-fixture', version: '1' },
      };
      if (wire.method === 'tools/list') result = { tools: [{
        name: 'echo', description: 'Persist the supplied fixture effect and return its observation',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      }] };
      if (wire.method === 'tools/call') {
        const text = wire.params.arguments.text;
        calls.push({ endpoint: request.url, text });
        const state = JSON.parse(readFileSync(statePath, 'utf8'));
        state.effects.push(text);
        writeFileSync(statePath, JSON.stringify(state));
        result = { content: [{ type: 'text', text: `OBSERVED_${text}` }], isError: false };
      }
      const reply = () => response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: wire.id, result }));
      if (wire.method === 'tools/call' && phase === 'initial') {
        assert.equal(calls.length, 1, 'No later old call may reach a withdrawn source');
        releaseResponse = reply;
        return;
      }
      reply();
    } catch (error) { serverFailure = error; response.writeHead(500).end(); }
  });
  const port = await listen(rpc);
  writeFileSync(runtime.layout.userPaths.settings, JSON.stringify({
    currentProvider: provider, enabledPlugins: { 'fixture@market': true },
    providers: { [provider]: {
      type: provider, model: 'fixture-model', apiKey: 'unused-loopback-key', baseURL: `http://127.0.0.1:${port}/v1`,
      ...(provider === 'openai' ? { options: { apiSurface: 'chat-completions' } } : {}),
    } },
  }));
  for (const revision of ['pinned', 'unselected', 'updated']) {
    mkdirSync(join(source(revision), '.claude-plugin'), { recursive: true });
    writeFileSync(join(source(revision), '.claude-plugin/plugin.json'), JSON.stringify({
      name: 'fixture', mcpServers: { probe: { type: 'http', url: `http://127.0.0.1:${port}/${revision}` } },
    }));
  }
  select('pinned');
  execFileSync('git', ['init', '--quiet'], { cwd: root, env: createTestBinaryEnvironment(home) });
  const trust = createNodeWorkspaceTrustService(runtime.layout.userPaths.workspaceTrust, runtime.layout.projectStateDirectories);
  assert.equal((await trust.grant(root)).status, 'trusted');
  const store = createInitialCliWorkspaceComposition(root, { productRuntime: runtime, projectAccess: await trust.inspect(root) }).sessionStore;
  browser = await chromium.launch({ executablePath });
  web = await preview({ root: packageRoot, preview: { port: 0, host: '127.0.0.1' } });
  const launch = async (resumeId) => {
    round = 0;
    phase = resumeId ? 'restored' : 'initial';
    const reservation = createServer();
    const wsPort = await listen(reservation);
    await close(reservation);
    child = spawn(process.execPath, ['--import', loader, '--conditions=source', join(cliRoot, 'src/__tests__/e2e/fixtures/mcp-bidirectional-host.ts'), '--serve', '--permission-mode', 'default', '--allowed-tools', `Read,${toolName}`, '--max-turns', '5', ...(resumeId ? ['--resume', resumeId] : [])], {
      cwd: root, env: createTestBinaryEnvironment(home, {
        PRODUCT_WS_TOKEN: token, PRODUCT_WS_PORT: String(wsPort), PRODUCT_FIXTURE_MCP_SERVER_ID: 'fixture:probe',
        ...(resumeId && change !== 'update' ? { PRODUCT_FIXTURE_MCP_ALLOW_ABSENT: '1' } : {}),
      }), stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => { diagnostics += String(chunk); });
    child.stderr.on('data', (chunk) => { diagnostics += String(chunk); });
    const url = new URL(web.resolvedUrls.local[0]);
    url.searchParams.set('ws', `ws://127.0.0.1:${wsPort}?token=${token}`);
    const page = await browser.newPage();
    currentPage = page;
    page.setDefaultTimeout(20_000);
    const frames = [];
    page.on('websocket', (socket) => socket.on('framereceived', ({ payload }) => {
      if (typeof payload === 'string' && payload.startsWith('{')) frames.push(JSON.parse(payload));
    }));
    await page.goto(url.href);
    await page.locator('.agent-gui-status[data-status="connected"]').waitFor();
    return { page, frames };
  };
  const send = async (page, text) => {
    await page.getByLabel('message', { exact: true }).fill(text);
    await page.getByLabel('message', { exact: true }).press('Enter');
  };
  let { page, frames } = await launch();
  await send(page, 'Execute the supplied fixture chain.');
  await until(() => releaseResponse !== undefined, 'active call whose effect preceded its acknowledgement');
  assert.deepEqual(JSON.parse(readFileSync(statePath, 'utf8')).effects, ['old-effect']);
  if (change === 'update') select('updated');
  else {
    await send(page, `/plugin ${change} fixture@market`);
    await until(() => frames.some((frame) => frame.type === 'command_result' && frame.name === 'plugin'), 'owner withdrawal result');
    const result = frames.find((frame) => frame.type === 'command_result' && frame.name === 'plugin');
    assert.equal(result.success, true, JSON.stringify(result));
    if (change === 'disable') assert.equal(JSON.parse(readFileSync(runtime.layout.userPaths.settings, 'utf8')).enabledPlugins['fixture@market'], false);
    else assert.equal(existsSync(source('pinned')), false);
  }
  assert.equal(frames.filter((frame) => frame.type === 'tool_end').length, 0, 'Withdrawal does not invent the active call outcome');
  const acknowledge = releaseResponse;
  releaseResponse = undefined;
  acknowledge();
  await page.getByText('PLUGIN_CHAIN_DONE', { exact: true }).waitFor();
  await until(() => frames.some((frame) => frame.type === 'complete'), 'chain completion');
  assert.equal(frames.filter((frame) => frame.type === 'tool_end').length, 3);
  const groups = page.getByRole('button', { name: /^\d+ tool calls?/ });
  assert.equal(await groups.count(), 3);
  for (let index = 0; index < 3; index += 1) await groups.nth(index).click();
  const cards = page.getByRole('button', { name: new RegExp(`^${toolName}`) });
  assert.equal(await cards.count(), 2);
  assert.match(await cards.nth(1).innerText(), /failed/);
  await cards.first().click();
  await page.getByText('OBSERVED_old-effect', { exact: true }).first().waitFor();
  await page.getByText(/Tool source \(attribution only, not authority\)/).first().waitFor();
  assert.equal(serverFailure, undefined);
  assert.deepEqual(calls, [{ endpoint: '/pinned', text: 'old-effect' }]);
  await page.close();
  await stop();
  const loaded = store.list()[0].outcome;
  assert.equal(loaded.status, 'valid');
  const receipts = loaded.record.messages.filter((message) => message.role === 'tool');
  assert.deepEqual(receipts.map((receipt) => receipt.toolCallId), initial.map((step) => step.id));
  assert.deepEqual(receipts.map((receipt) => receipt.metadata.success), [true, false, true]);
  for (const receipt of receipts.slice(0, 2)) assert.ok(JSON.parse(receipt.metadata.toolProvenance).origin.startsWith(source('pinned')));
  ({ page, frames } = await launch(loaded.record.id));
  await until(() => frames.some((frame) => frame.type === 'messages' && frame.display?.filter((entry) => entry.type === 'tool').length === 3), 'restored call receipts');
  assert.deepEqual(calls, [{ endpoint: '/pinned', text: 'old-effect' }], 'Restoration never replays old effects');
  await send(page, 'Attempt a fresh call under the currently installed and enabled source.');
  await page.getByText('PLUGIN_RECOVERY_DONE', { exact: true }).waitFor();
  await until(() => frames.some((frame) => frame.type === 'complete'), 'fresh continuation');
  await page.close();
  await stop();
  const recovered = store.load(loaded.record.id);
  assert.equal(recovered.status, 'valid');
  const recoveredTools = recovered.record.messages.filter((message) => message.role === 'tool');
  assert.deepEqual(recoveredTools.map((receipt) => receipt.toolCallId), [...initial.map((step) => step.id), fresh.id]);
  assert.deepEqual(recoveredTools.map((receipt) => receipt.metadata.success), [true, false, true, change === 'update']);
  const expected = [{ endpoint: '/pinned', text: 'old-effect' }, ...(change === 'update' ? [{ endpoint: '/updated', text: 'fresh-effect' }] : [])];
  assert.deepEqual(calls, expected);
  assert.deepEqual(JSON.parse(readFileSync(statePath, 'utf8')).effects, expected.map((entry) => entry.text));
  if (change === 'update') assert.ok(JSON.parse(recoveredTools.at(-1).metadata.toolProvenance).origin.startsWith(source('updated')));
  assert.equal(serverFailure, undefined);
  assert.equal(modelRequests.filter((request) => request.phase === 'initial').length, 4);
  assert.equal(modelRequests.filter((request) => request.phase === 'restored').length, 2);
  report = {
    route: 'built shared GUI + source CLI + selected installed MCP source + native loopback SDK', provider, change,
    updateMechanism: change === 'update' ? 'fixture-owner replacement of installed revision record' : null,
    activeCallDisposition: 'kept real acknowledged outcome', initialReceipts: 3, freshReceipts: 1,
    pinnedChainPreserved: true, currentEnablementRechecked: true, effectReplay: false,
    newRevisionApprovedInFreshHost: change === 'update', effects: expected.length, paidModelRequests: 0,
    fixtureSha256: createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex'),
  };
} catch (error) {
  const body = await currentPage?.locator('body').innerText().catch(() => 'Page unavailable');
  failures.push(new Error(`${error.message}\nRendered app: ${body}\nCLI diagnostics: ${diagnostics}`, { cause: error }));
} finally {
  releaseResponse?.();
  const cleanup = await Promise.allSettled([stop(), browser?.close(), web?.httpServer ? close(web.httpServer) : undefined, close(rpc)]);
  for (const result of cleanup) if (result.status === 'rejected') failures.push(result.reason);
  rmSync(root, { recursive: true, force: true });
  if (report) process.stdout.write(`${JSON.stringify({ ...report, cleanupComplete: failures.length === 0 })}\n`);
}
if (failures.length) throw new AggregateError(failures, 'App plugin lifecycle validation failed');
