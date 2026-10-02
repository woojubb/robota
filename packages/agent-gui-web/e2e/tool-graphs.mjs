/** Native SDK call graphs through the built GUI and the real CLI/MCP execution path. */
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

const [executablePath, provider = 'anthropic', mode = 'success', sources = 'single'] = process.argv.slice(2);
assert.ok(executablePath && isAbsolute(executablePath) && existsSync(executablePath));
assert.ok(['anthropic', 'openai'].includes(provider));
assert.ok(['success', 'failure', 'allow', 'deny', 'cancel', 'cancel-permission'].includes(mode));
assert.ok(['single', 'mixed'].includes(sources));
const mixed = sources === 'mixed';
const permissionCase = ['allow', 'deny', 'cancel-permission'].includes(mode);
const cancelled = ['cancel', 'cancel-permission'].includes(mode);
const failedRoot = ['failure', 'deny'].includes(mode);
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cliRoot = join(packageRoot, '../agent-cli');
const loader = pathToFileURL(createRequire(join(cliRoot, 'package.json')).resolve('tsx')).href;
const root = mkdtempSync(join(tmpdir(), 'gui-tool-graphs-'));
const home = join(root, 'home');
const statePath = join(root, 'effects.json');
const runtime = createTestProductRuntime('test-product', { HOME: home });
const installed = join(runtime.layout.userRoot, 'plugins/cache/market/fixture/pinned');
const secondInstalled = join(runtime.layout.userRoot, 'plugins/cache/market/fixture-two/pinned');
const contributions = [{ name: 'fixture', sourceId: 'fixture:probe', installed, endpoint: '/pinned' },
  ...(mixed ? [{ name: 'fixture-two', sourceId: 'fixture-two:probe', installed: secondInstalled, endpoint: '/second-pinned' }] : [])];
const toolName = 'fixture_probe__echo';
const gateName = 'fixture_probe__gate';
const token = randomBytes(32).toString('hex');
const steps = ['A', 'B', 'C', 'D', 'E'].map((text) => ({
  id: `graph-${text}`, name: text === 'A' && permissionCase ? gateName : mixed && ['B', 'C', 'E'].includes(text) ? 'fixture-two_probe__echo' : toolName, args: { text },
}));
steps.push({ id: 'graph-read', name: 'Read', args: { filePath: join(root, 'observation.txt') } });
const policy = {
  maxConcurrency: 2,
  scheduling: Object.fromEntries(steps.map((step) => [step.id, {
    resources: ['graph-D', 'graph-E'].includes(step.id) ? [{ key: statePath, access: 'write' }] : [],
    dependsOn: step.id === 'graph-C' ? ['graph-A', 'graph-B'] : [],
  }])),
};
const calls = [];
const effects = [];
const held = new Map();
const acknowledged = [];
const closed = [];
const modelRequests = [];
const timings = [];
let active = 0;
let maxActive = 0;
let browser, web, rpc, child, currentPage, serverFailure;
let diagnostics = '';
let restored = false;
let round = 0;
let report;
const failures = [];
const until = async (predicate, label) => {
  const end = Date.now() + 20_000;
  while (!predicate()) {
    if (serverFailure) throw serverFailure;
    if (Date.now() > end) throw new Error(`Timed out awaiting ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};
async function listen(server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return server.address().port;
}
async function close(server) {
  if (!server) return;
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
async function stop() {
  if (!child) return;
  const owned = child; child = undefined;
  if (owned.exitCode !== null || owned.signalCode !== null) {
    assert.equal(owned.exitCode, 0, diagnostics); assert.equal(owned.signalCode, null); return;
  }
  let timer;
  const done = new Promise((resolve, reject) => {
    owned.once('exit', (code, signal) => { clearTimeout(timer); code === 0 && signal === null ? resolve() : reject(new Error(`CLI exit ${code}/${signal}`)); });
    timer = setTimeout(() => { owned.kill('SIGKILL'); reject(new Error('CLI stop timed out')); }, 10_000);
  });
  owned.kill('SIGTERM'); await done;
}
const release = (text) => { const reply = held.get(text); assert.ok(reply, `Held ${text}`); held.delete(text); reply(); };

try {
  mkdirSync(runtime.layout.userRoot, { recursive: true });
  writeFileSync(statePath, JSON.stringify({ effects }));
  writeFileSync(join(root, 'observation.txt'), 'INDEPENDENT_BUILTIN_OBSERVATION');
  rpc = createServer(async (request, response) => {
    try {
      if (request.method === 'GET') { response.writeHead(200, { 'Content-Type': 'text/event-stream' }).write(': ready\n\n'); return; }
      let raw = ''; for await (const chunk of request) raw += String(chunk);
      const wire = JSON.parse(raw);
      if (request.url?.startsWith('/v1/')) {
        if (!wire.tools?.some((tool) => (tool.name ?? tool.function?.name) === toolName)) { respond(provider, response, wire.stream === true, -1); return; }
        if (mixed) assert.ok(wire.tools.some((tool) => (tool.name ?? tool.function?.name) === 'fixture-two_probe__echo'), `Both distinct installed sources are offered to the native SDK: ${JSON.stringify(wire.tools.map((tool) => tool.name ?? tool.function?.name))}`);
        const receipts = wireReceipts(provider, wire);
        const index = round++;
        modelRequests.push({ restored, index, ids: receipts.map((receipt) => receipt.id) });
        if (restored) {
          assert.deepEqual(receipts.slice(0, 6).map((receipt) => receipt.id), steps.map((step) => step.id));
          if (index === 1) assert.match(JSON.stringify(receipts.at(-1).content), /effects/);
          respond(provider, response, wire.stream === true, index, index === 0 ? { id: 'graph-reobserve', name: 'Read', args: { filePath: statePath } } : undefined, 'GRAPH_RESTORED_DONE');
        } else {
          assert.ok(index <= 2);
          if (index === 0) respond(provider, response, wire.stream === true, index, steps);
          else {
            assert.deepEqual(receipts.slice(0, 6).map((receipt) => receipt.id), steps.map((step) => step.id));
            const observed = JSON.stringify(receipts[1].content).match(/OBS_B/)?.[0];
            assert.equal(observed, 'OBS_B', 'Later arguments derive from a real predecessor observation');
            if (provider === 'anthropic') assert.deepEqual(receipts.slice(0, 6).map((receipt) => receipt.failed), [failedRoot, false, failedRoot, false, false, false]);
            respond(provider, response, wire.stream === true, index, index === 1 ? { id: 'graph-F', name: toolName, args: { text: 'F', observed } } : undefined, 'GRAPH_DONE');
          }
        }
        return;
      }
      const contribution = contributions.find((entry) => entry.endpoint === request.url);
      assert.ok(contribution, 'Only selected installed sources receive calls');
      if (wire.id === undefined) { response.writeHead(202).end(); return; }
      let result = {};
      if (wire.method === 'initialize') result = { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: contribution.name, version: '1' } };
      if (wire.method === 'tools/list') result = { tools: ['echo', 'gate'].map((name) => ({ name, description: 'Persist one disposable graph effect and return its observation', inputSchema: { type: 'object', properties: { text: { type: 'string' }, observed: { type: 'string' } }, required: ['text'] } })) };
      const started = performance.now();
      let text;
      if (wire.method === 'tools/call') {
        text = wire.params.arguments.text;
        const step = steps.find((entry) => entry.args.text === text);
        const expectedSource = mixed && ['B', 'C', 'E'].includes(text) ? 'fixture-two:probe' : 'fixture:probe';
        assert.equal(contribution.sourceId, expectedSource, 'Every effect reaches its declared installed source');
        assert.ok(step || text === 'F');
        calls.push({ text, sourceId: contribution.sourceId, observed: wire.params.arguments.observed });
        active++; maxActive = Math.max(maxActive, active);
        assert.ok(active <= 2, 'MCP effects obey host concurrency bound');
        if (text === 'C') assert.ok(acknowledged.includes('A') && acknowledged.includes('B'), 'Fan-in waits for both predecessors');
        if (text === 'E') assert.ok(acknowledged.includes('D'), 'Shared writes cannot overlap');
        if (text === 'F') assert.equal(wire.params.arguments.observed, 'OBS_B');
        if (!(text === 'A' && mode === 'failure')) effects.push(text);
        writeFileSync(statePath, JSON.stringify({ effects }));
        result = { content: [{ type: 'text', text: `OBS_${text}` }], isError: text === 'A' && mode === 'failure' };
        let settled = false;
        response.on('close', () => { if (!settled) { settled = true; active--; closed.push(text); } });
        const reply = () => {
          if (settled) return;
          settled = true; active--; acknowledged.push(text);
          timings.push({ text, serverCallUntilAcknowledgementMs: performance.now() - started });
          response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: wire.id, result }));
        };
        if (['A', 'B', 'D'].includes(text)) { held.set(text, reply); return; }
        reply(); return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: wire.id, result }));
    } catch (error) { serverFailure = error; response.writeHead(500).end(); }
  });
  const port = await listen(rpc);
  writeFileSync(runtime.layout.userPaths.settings, JSON.stringify({ currentProvider: provider, providers: { [provider]: { type: provider, model: 'fixture-model', apiKey: 'unused-loopback-key', baseURL: `http://127.0.0.1:${port}/v1`, ...(provider === 'openai' ? { options: { apiSurface: 'chat-completions' } } : {}) } } }));
  const installedRecords = {};
  for (const contribution of contributions) {
    mkdirSync(join(contribution.installed, '.claude-plugin'), { recursive: true });
    writeFileSync(join(contribution.installed, '.claude-plugin/plugin.json'), JSON.stringify({ name: contribution.name, mcpServers: { probe: { type: 'http', url: `http://127.0.0.1:${port}${contribution.endpoint}` } } }));
    installedRecords[`${contribution.name}@market`] = { pluginName: contribution.name, marketplace: 'market', version: 'pinned', installPath: contribution.installed, installedAt: 'fixture' };
  }
  writeFileSync(join(runtime.layout.userRoot, 'plugins/installed_plugins.json'), JSON.stringify(installedRecords));
  execFileSync('git', ['init', '--quiet'], { cwd: root, env: createTestBinaryEnvironment(home) });
  const trust = createNodeWorkspaceTrustService(runtime.layout.userPaths.workspaceTrust, runtime.layout.projectStateDirectories);
  assert.equal((await trust.grant(root)).status, 'trusted');
  const store = createInitialCliWorkspaceComposition(root, { productRuntime: runtime, projectAccess: await trust.inspect(root) }).sessionStore;
  browser = await chromium.launch({ executablePath });
  web = await preview({ root: packageRoot, preview: { port: 0, host: '127.0.0.1' } });
  const launch = async (resumeId) => {
    round = 0; restored = Boolean(resumeId);
    const reservation = createServer(); const wsPort = await listen(reservation); await close(reservation);
    child = spawn(process.execPath, ['--import', loader, '--conditions=source', join(cliRoot, 'src/__tests__/e2e/fixtures/mcp-bidirectional-host.ts'), '--serve', '--permission-mode', 'default', '--allowed-tools', `Read,${toolName}${mixed ? ',fixture-two_probe__echo' : ''}`, '--max-turns', '5', ...(resumeId ? ['--resume', resumeId] : [])], {
      cwd: root, env: createTestBinaryEnvironment(home, { PRODUCT_WS_TOKEN: token, PRODUCT_WS_PORT: String(wsPort), PRODUCT_FIXTURE_MCP_SERVER_ID: 'fixture:probe', ...(mixed ? { PRODUCT_FIXTURE_MCP_SECOND_SOURCE: '1' } : {}), PRODUCT_FIXTURE_TOOL_POLICY: JSON.stringify(policy), PRODUCT_FIXTURE_MEASURE_TIMING: '1' }), stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => { diagnostics += String(chunk); }); child.stderr.on('data', (chunk) => { diagnostics += String(chunk); });
    const url = new URL(web.resolvedUrls.local[0]); url.searchParams.set('ws', `ws://127.0.0.1:${wsPort}?token=${token}`);
    const page = await browser.newPage(); currentPage = page; page.setDefaultTimeout(20_000);
    const frames = []; page.on('websocket', (socket) => socket.on('framereceived', ({ payload }) => { if (typeof payload === 'string' && payload.startsWith('{')) frames.push(JSON.parse(payload)); }));
    await page.goto(url.href); await page.locator('.agent-gui-status[data-status="connected"]').waitFor(); return { page, frames };
  };
  const send = async (page, text) => { await page.getByLabel('message', { exact: true }).fill(text); await page.getByLabel('message', { exact: true }).press('Enter'); };
  let { page, frames } = await launch();
  const started = performance.now(); await send(page, 'Execute the supplied fixture graph.');
  let permissionMs = 0;
  if (permissionCase) {
    const dialog = page.getByRole('dialog', { name: 'pending question' }); await dialog.waitFor();
    const permissionStarted = performance.now(); await until(() => held.has('B'), 'independent root while another root awaits approval');
    assert.equal(calls.some((call) => call.text === 'A'), false);
    if (!cancelled) await dialog.getByRole('button', { name: mode === 'allow' ? 'Allow' : 'Deny', exact: true }).click();
    permissionMs = performance.now() - permissionStarted;
  }
  if (cancelled) {
    await until(() => held.has('B') && (mode === 'cancel-permission' || held.has('A')), 'held root calls');
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await until(() => frames.some((frame) => frame.type === 'interrupted'), 'graph interruption');
    await until(() => active === 0, 'cancelled HTTP calls closed');
    assert.equal(frames.some((frame) => frame.type === 'complete'), false);
    assert.deepEqual(new Set(calls.map((call) => call.text)), new Set(mode === 'cancel' ? ['A', 'B'] : ['B']));
    assert.equal(await page.getByRole('dialog', { name: 'pending question' }).count(), 0);
  } else {
    await until(() => held.has('B') && (mode === 'deny' || held.has('A')), 'parallel roots');
    release('B');
    await until(() => held.has('D'), 'independent shared writer');
    assert.equal(calls.some((call) => call.text === 'E'), false);
    if (mode !== 'deny') release('A');
    if (!failedRoot) await until(() => acknowledged.includes('C'), 'dependent fan-in');
    release('D');
    await page.getByText('GRAPH_DONE', { exact: true }).waitFor(); await until(() => frames.some((frame) => frame.type === 'complete'), 'graph completion');
    assert.ok(acknowledged.indexOf('B') < acknowledged.indexOf('A') || mode === 'deny');
    assert.equal(calls.some((call) => call.text === 'C'), !failedRoot);
    assert.ok(calls.some((call) => call.text === 'F'));
    if (!failedRoot) assert.equal(maxActive, 2);
  }
  const elapsedMs = performance.now() - started;
  assert.equal(serverFailure, undefined); await page.close(); await stop();
  const loaded = store.list()[0].outcome; assert.equal(loaded.status, 'valid');
  const receipts = loaded.record.messages.filter((message) => message.role === 'tool');
  const traces = diagnostics.split('\n').filter((line) => line.startsWith('{')).map((line) => {
    try { return JSON.parse(line); } catch { return undefined; }
  }).filter((record) => record?.signal === 'traces');
  assert.equal(traces.length, 1);
  const queue = traces[0].spans.find((span) => span.name === 'agent.prompt_execution').timingTotals.queue;
  assert.equal(queue.samples, receipts.length);
  assert.equal(queue.invalid, 0);
  assert.equal(queue.admissionStarted, cancelled ? 2 : failedRoot ? 6 : 7);
  assert.equal(queue.notDispatched, cancelled ? 4 : failedRoot ? 1 : 0);
  assert.ok(queue.durationMs > 0, 'Held predecessors or shared writers produce measured queue wait');
  assert.deepEqual(receipts.map((receipt) => receipt.toolCallId), [...steps.map((step) => step.id), ...(cancelled ? [] : ['graph-F'])]);
  assert.deepEqual(receipts.map((receipt) => receipt.metadata.success), cancelled ? Array(6).fill(false) : [!failedRoot, true, !failedRoot, true, true, true, true]);
  for (const [index, receipt] of receipts.entries()) if (steps[index]?.name !== 'Read') {
    assert.equal(typeof receipt.metadata.toolProvenance, 'string');
    const expected = mixed && ['graph-B', 'graph-C', 'graph-E'].includes(receipt.toolCallId) ? contributions[1] : contributions[0];
    const provenance = JSON.parse(receipt.metadata.toolProvenance);
    assert.equal(provenance.sourceId, expected.sourceId);
    assert.ok(provenance.origin.startsWith(expected.installed));
  }
  const before = JSON.parse(readFileSync(statePath, 'utf8')).effects;
  assert.deepEqual(before, effects);
  ({ page, frames } = await launch(loaded.record.id));
  await until(() => frames.some((frame) => frame.type === 'messages' && frame.display?.filter((entry) => entry.type === 'tool').length === receipts.length), 'restored graph receipts');
  assert.deepEqual(JSON.parse(readFileSync(statePath, 'utf8')).effects, before, 'Restore must not replay effects');
  await send(page, 'Re-observe the fixture state under current authority.'); await page.getByText('GRAPH_RESTORED_DONE', { exact: true }).waitFor();
  await until(() => frames.some((frame) => frame.type === 'complete'), 'fresh observation completion');
  assert.deepEqual(JSON.parse(readFileSync(statePath, 'utf8')).effects, before);
  assert.equal(serverFailure, undefined); await page.close(); await stop();
  const recovered = store.load(loaded.record.id); assert.equal(recovered.status, 'valid');
  assert.equal(recovered.record.messages.filter((message) => message.role === 'tool').at(-1).toolCallId, 'graph-reobserve');
  report = { route: 'built GUI + source CLI + pinned MCP source + native loopback SDK', provider, mode, sources, installedSources: contributions.map((entry) => entry.sourceId), maxConcurrency: 2, maxActiveMcpCalls: maxActive, initialReceipts: receipts.length, initialTerminal: cancelled ? 'interrupted' : 'completed', dependentDispatch: calls.some((call) => call.text === 'C'), receiptOrderPreserved: true, effectReplay: false, effects: before, calls, closed, modelRequests, elapsedMs, timings: { permissionWaitObservedMs: permissionMs, mcpServerCallUntilAcknowledgement: timings, model: null, queue: null, transport: null }, paidModelRequests: 0, fixtureSha256: createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex') };
  report.timings.queue = { ...queue, scope: 'Batch submission to pre-dispatch admission or refusal; sums may overlap and do not attest effects.' };
} catch (error) {
  let rendered = ''; try { rendered = await currentPage?.locator('body').innerText(); } catch { /* The owned page may already be closed. */ }
  failures.push(new Error(`${error.message}\nRendered app: ${rendered}\nDiagnostics: ${diagnostics}`, { cause: error }));
} finally {
  for (const reply of held.values()) reply(); held.clear();
  for (const cleanup of [() => stop(), () => browser?.close(), () => web && close(web.httpServer), () => close(rpc)]) try { await cleanup(); } catch (error) { failures.push(error); }
  rmSync(root, { recursive: true, force: true }); assert.equal(existsSync(root), false);
}
if (failures.length) throw new AggregateError(failures, 'Product tool graph validation failed');
process.stdout.write(`${JSON.stringify({ ...report, cleanupComplete: true })}\n`);
