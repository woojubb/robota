/** Oversized screenshots through the built GUI, source CLI and native loopback SDKs. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { createNodeHostSessionStore, createNodeWorkspaceTrustService } from '../../agent-framework/src/index.ts';
import { createTestBinaryEnvironment, createTestProductRuntime } from '../../agent-cli/src/__tests__/helpers/product-runtime.ts';
import { respond, wireReceipts } from '../../agent-cli/src/__tests__/helpers/provider-wire-fixture.ts';
import { createInitialCliWorkspaceComposition } from '../../agent-cli/src/startup/workspace-project-composition.ts';

const [executablePath, provider = 'anthropic', contribution = 'standalone', mode = 'success'] = process.argv.slice(2);
assert.ok(executablePath && isAbsolute(executablePath) && existsSync(executablePath));
assert.ok(['anthropic', 'openai'].includes(provider));
assert.ok(['standalone', 'packaged'].includes(contribution));
assert.ok(['success', 'failure'].includes(mode));
const failed = mode === 'failure';
const sourceId = contribution === 'packaged' ? 'fixture:probe' : 'probe';
const toolName = contribution === 'packaged' ? 'fixture_probe__echo' : 'probe__echo';
const readerName = 'test_product_command_read_mcp_result';
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cliRoot = join(packageRoot, '../agent-cli');
const loader = pathToFileURL(createRequire(join(cliRoot, 'package.json')).resolve('tsx')).href;
const root = mkdtempSync(join(tmpdir(), 'gui-oversized-images-'));
const home = join(root, 'home');
const spillParent = join(root, 'spills');
const statePath = join(root, 'effects.json');
const runtime = createTestProductRuntime('test-product', { HOME: home });
const installed = join(runtime.layout.userRoot, 'plugins/cache/market/fixture/pinned');
const token = randomBytes(32).toString('hex');
const initialIds = ['image-effect'];
const recoveryIds = ['image-old-reference', 'image-reobserve'];
const requests = [];
const calls = [];
const chunks = [];
const pages = [];
const failures = [];
let browser, web, rpc, child, currentPage, serverFailure, store, reference, image, imageBytes, imageSha256, report;
let diagnostics = '';
let restored = false;
let round = 0;
let totalChars;
let offset = 0;
const started = performance.now();
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const textOf = (content) => Array.isArray(content) ? content.map((block) => block.text ?? '').join('\n') : String(content);
const until = async (predicate, label) => {
  const end = Date.now() + 30_000;
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
    owned.once('exit', (code, signal) => { clearTimeout(timer); code === 0 && signal === null ? resolve() : reject(new Error(`CLI exit ${code}/${signal}: ${diagnostics}`)); });
    timer = setTimeout(() => { owned.kill('SIGKILL'); reject(new Error('CLI stop timed out')); }, 10_000);
  });
  owned.kill('SIGTERM'); await done;
}

try {
  mkdirSync(runtime.layout.userRoot, { recursive: true });
  mkdirSync(spillParent);
  writeFileSync(statePath, JSON.stringify({ effects: [] }));
  browser = await chromium.launch({ executablePath });
  const imagePage = await browser.newPage({ viewport: { width: 128, height: 96 }, deviceScaleFactor: 1 });
  await imagePage.setContent('<style>body{margin:0}</style><canvas width="128" height="96"></canvas>');
  await imagePage.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const context = canvas.getContext('2d');
    const pixels = context.createImageData(canvas.width, canvas.height);
    let seed = 123456789;
    for (let index = 0; index < pixels.data.length; index++) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      pixels.data[index] = index % 4 === 3 ? 255 : seed & 255;
    }
    context.putImageData(pixels, 0, 0);
  });
  const screenshot = await imagePage.screenshot({ type: 'png' }); await imagePage.close();
  assert.deepEqual([screenshot.readUInt32BE(16), screenshot.readUInt32BE(20)], [128, 96]);
  image = screenshot.toString('base64'); imageBytes = screenshot.length; imageSha256 = hash(screenshot);
  assert.ok(image.length > 25_000 && image.length < 150_000, 'The screenshot alone exceeds admission, within bounded fixture transport and spill limits');
  rpc = createServer(async (request, response) => {
    try {
      if (request.method === 'GET') { response.writeHead(200, { 'Content-Type': 'text/event-stream' }).write(': ready\n\n'); return; }
      let raw = ''; for await (const chunk of request) raw += String(chunk);
      const wire = JSON.parse(raw);
      if (request.url?.startsWith('/v1/')) {
        if (!wire.tools?.some((tool) => (tool.name ?? tool.function?.name) === toolName)) { respond(provider, response, wire.stream === true, -1); return; }
        const index = round++;
        const receipts = wireReceipts(provider, wire);
        const expected = restored ? [...initialIds, ...pages.map((page) => page.id), ...recoveryIds.slice(0, index)] : [...initialIds.slice(0, Math.min(index, 1)), ...pages.slice(0, Math.max(0, index - 1)).map((page) => page.id)];
        assert.deepEqual(receipts.map((receipt) => receipt.id), expected, 'Every native call/result ID remains ordered');
        requests.push({ restored, index, bytes: Buffer.byteLength(raw), ids: receipts.map((receipt) => receipt.id) });
        if (receipts.length) {
          const original = textOf(receipts[0].content);
          assert.match(original, /Tool source \(attribution only, not authority\)/);
          assert.ok(original.includes(reference ?? 'tool-result:'));
          assert.equal(original.includes(image), false, 'The root receipt contains a reference, not inline screenshot bytes');
          if (provider === 'anthropic') assert.equal(receipts[0].failed, failed);
        }
        let step;
        if (restored) {
          assert.ok(index <= 2);
          if (index === 0) step = { id: recoveryIds[0], name: readerName, args: { reference, offset: 0 } };
          if (index === 1) {
            assert.match(textOf(receipts.at(-1).content), /Tool result reference unavailable/);
            if (provider === 'anthropic') assert.equal(receipts.at(-1).failed, true);
            step = { id: recoveryIds[1], name: 'Read', args: { filePath: statePath } };
          }
          if (index === 2) assert.match(textOf(receipts.at(-1).content), /image-effect/);
        } else if (index === 0) step = { id: initialIds[0], name: toolName, args: { text: 'image-effect' } };
        else {
          if (index === 1) {
            reference = textOf(receipts[0].content).match(/tool-result:[A-Za-z0-9_-]{22,64}/u)?.[0];
            assert.ok(reference, 'Oversized mixed image result supplies an opaque reference');
            assert.equal(JSON.stringify(receipts[0].content).includes('"type":"image"'), false);
          } else {
            const chunk = JSON.parse(textOf(receipts.at(-1).content));
            assert.equal(typeof chunk.content, 'string');
            assert.ok(chunk.content.length > 0 && chunk.content.length <= 4_000);
            assert.equal(chunk.nextOffset, offset + chunk.content.length);
            if (totalChars !== undefined) assert.equal(chunk.totalChars, totalChars);
            totalChars = chunk.totalChars; offset = chunk.nextOffset; chunks.push(chunk.content);
            assert.ok(offset <= totalChars && totalChars > 25_000);
            if (provider === 'anthropic') assert.equal(receipts.at(-1).failed, false);
          }
          if (totalChars === undefined || offset < totalChars) {
            assert.ok(pages.length < 40, 'Bounded retrieval rounds');
            step = { id: `image-page-${pages.length}`, name: readerName, args: { reference, offset } };
            pages.push(step);
          } else {
            const recovered = JSON.parse(chunks.join(''));
            assert.equal(recovered.success, !failed);
            const part = recovered.parts.find((entry) => entry.type === 'image_inline');
            assert.equal(part.mimeType, 'image/png'); assert.equal(part.data, image);
            assert.equal(hash(Buffer.from(part.data, 'base64')), imageSha256);
            assert.ok(recovered.parts.some((entry) => entry.type === 'text' && entry.text === 'SCREENSHOT_EFFECT_OBSERVED'));
          }
        }
        respond(provider, response, wire.stream === true, index, step, restored ? 'IMAGE_RESTORED_DONE' : 'IMAGE_RETRIEVED_DONE');
        return;
      }
      assert.equal(request.url, '/pinned', 'Only the selected source revision receives MCP traffic');
      if (wire.id === undefined) { response.writeHead(202).end(); return; }
      let result = {};
      if (wire.method === 'initialize') result = { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'oversized-image-fixture', version: '1' } };
      if (wire.method === 'tools/list') result = { tools: [{ name: 'echo', description: 'Persist one disposable effect and return its real screenshot', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }] };
      if (wire.method === 'tools/call') {
        assert.equal(restored, false, 'Restore observes existing state without replaying the mutation');
        assert.equal(wire.params.arguments.text, 'image-effect'); calls.push('image-effect');
        assert.equal(calls.length, 1);
        writeFileSync(statePath, JSON.stringify({ effects: calls }));
        result = { isError: failed, content: [{ type: 'text', text: 'SCREENSHOT_EFFECT_OBSERVED' }, { type: 'image', mimeType: 'image/png', data: image }] };
      }
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: wire.id, result }));
    } catch (error) { serverFailure = error; response.writeHead(500).end(); }
  });
  const port = await listen(rpc);
  writeFileSync(runtime.layout.userPaths.settings, JSON.stringify({ currentProvider: provider, providers: { [provider]: { type: provider, model: 'fixture-model', apiKey: 'unused-loopback-key', baseURL: `http://127.0.0.1:${port}/v1`, ...(provider === 'openai' ? { options: { apiSurface: 'chat-completions' } } : {}) } }, ...(contribution === 'standalone' ? { mcpServers: { probe: { type: 'http', url: `http://127.0.0.1:${port}/pinned` } } } : {}) }));
  if (contribution === 'packaged') {
    for (const revision of ['pinned', 'unselected']) {
      const directory = join(runtime.layout.userRoot, `plugins/cache/market/fixture/${revision}`);
      mkdirSync(join(directory, '.claude-plugin'), { recursive: true });
      writeFileSync(join(directory, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'fixture', mcpServers: { probe: { type: 'http', url: `http://127.0.0.1:${port}/${revision}` } } }));
    }
    writeFileSync(join(runtime.layout.userRoot, 'plugins/installed_plugins.json'), JSON.stringify({ 'fixture@market': { pluginName: 'fixture', marketplace: 'market', version: 'pinned', installPath: installed, installedAt: 'fixture' } }));
  }
  execFileSync('git', ['init', '--quiet'], { cwd: root, env: createTestBinaryEnvironment(home) });
  const trust = createNodeWorkspaceTrustService(runtime.layout.userPaths.workspaceTrust, runtime.layout.projectStateDirectories);
  if (contribution === 'packaged') assert.equal((await trust.grant(root)).status, 'trusted');
  store = contribution === 'packaged' ? createInitialCliWorkspaceComposition(root, { productRuntime: runtime, projectAccess: await trust.inspect(root) }).sessionStore : createNodeHostSessionStore(runtime.layout.userPaths.sessions);
  web = await preview({ root: packageRoot, preview: { port: 0, host: '127.0.0.1' } });
  const launch = async (resumeId) => {
    round = 0; restored = Boolean(resumeId);
    const reservation = createServer(); const wsPort = await listen(reservation); await close(reservation);
    child = spawn(process.execPath, ['--import', loader, '--conditions=source', join(cliRoot, 'src/__tests__/e2e/fixtures/mcp-bidirectional-host.ts'), '--serve', ...(contribution === 'standalone' ? ['--restricted-workspace'] : []), '--permission-mode', 'default', '--allowed-tools', `Read,${toolName},${readerName}`, '--max-turns', '45', ...(resumeId ? ['--resume', resumeId] : [])], {
      cwd: root, env: createTestBinaryEnvironment(home, { TMPDIR: spillParent, PRODUCT_WS_TOKEN: token, PRODUCT_WS_PORT: String(wsPort), PRODUCT_FIXTURE_MCP_SERVER_ID: sourceId }), stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => { diagnostics += String(chunk); }); child.stderr.on('data', (chunk) => { diagnostics += String(chunk); });
    const url = new URL(web.resolvedUrls.local[0]); url.searchParams.set('ws', `ws://127.0.0.1:${wsPort}?token=${token}`);
    const page = await browser.newPage(); currentPage = page; page.setDefaultTimeout(30_000);
    const frames = []; page.on('websocket', (socket) => socket.on('framereceived', ({ payload }) => { if (typeof payload === 'string' && payload.startsWith('{')) frames.push(JSON.parse(payload)); }));
    await page.goto(url.href); await page.locator('.agent-gui-status[data-status="connected"]').waitFor(); return { page, frames };
  };
  const send = async (page, text) => { await page.getByLabel('message', { exact: true }).fill(text); await page.getByLabel('message', { exact: true }).press('Enter'); };
  let { page, frames } = await launch();
  await send(page, 'Observe the fixture screenshot, then retrieve its bounded artifact pages.');
  await until(() => frames.some((frame) => frame.type === 'complete'), 'bounded screenshot retrieval');
  await page.getByText('IMAGE_RETRIEVED_DONE', { exact: true }).waitFor();
  const groups = page.getByRole('button', { name: /^\d+ tool calls?/ });
  for (let index = 0; index < await groups.count(); index++) await groups.nth(index).click();
  const card = page.getByRole('button', { name: new RegExp(`^${toolName}`) }); await card.click();
  assert.equal((await card.innerText()).includes('failed'), failed);
  await page.getByText(/Tool source \(attribution only, not authority\)/).first().waitFor();
  assert.ok((await page.locator('body').innerText()).includes(reference));
  assert.equal(await page.getByRole('img', { name: `Observation from ${toolName}` }).count(), 0);
  assert.ok(readdirSync(spillParent).some((name) => name.startsWith('agent-tool-results-')), 'Spill exists during its owner lifetime');
  await page.close(); await stop();
  assert.equal(readdirSync(spillParent).some((name) => name.startsWith('agent-tool-results-')), false, 'Owner shutdown removes spill artifacts');
  const loaded = store.list()[0].outcome; assert.equal(loaded.status, 'valid');
  const receipts = loaded.record.messages.filter((message) => message.role === 'tool');
  assert.deepEqual(receipts.map((receipt) => receipt.toolCallId), [...initialIds, ...pages.map((entry) => entry.id)]);
  assert.equal(receipts[0].metadata.success, !failed); assert.ok(receipts[0].content.includes(reference));
  assert.equal(receipts[0].parts?.some((part) => part.type === 'image_inline') ?? false, false);
  const provenance = JSON.parse(receipts[0].metadata.toolProvenance); assert.equal(provenance.sourceId, sourceId);
  if (contribution === 'packaged') assert.ok(provenance.origin.startsWith(installed));
  for (let index = 1; index < receipts.length; index++) assert.equal(receipts[index].metadata.success, true);
  const persistedChunks = receipts.slice(1).map((receipt) => JSON.parse(receipt.content).content).join('');
  assert.equal(persistedChunks, chunks.join(''));
  ({ page, frames } = await launch(loaded.record.id));
  await until(() => frames.some((frame) => frame.type === 'messages' && frame.display?.filter((entry) => entry.type === 'tool').length === receipts.length), 'restored artifact receipts');
  assert.deepEqual(JSON.parse(readFileSync(statePath, 'utf8')).effects, ['image-effect']);
  await send(page, 'Try the previous reference, then independently observe the existing effect.');
  await until(() => frames.some((frame) => frame.type === 'complete'), 'fresh observation after explicit unavailable reference');
  await page.getByText('IMAGE_RESTORED_DONE', { exact: true }).waitFor(); await page.close(); await stop();
  const recovered = store.load(loaded.record.id); assert.equal(recovered.status, 'valid');
  const finalReceipts = recovered.record.messages.filter((message) => message.role === 'tool');
  assert.deepEqual(finalReceipts.map((receipt) => receipt.toolCallId), [...receipts.map((entry) => entry.toolCallId), ...recoveryIds]);
  assert.deepEqual(finalReceipts.slice(-2).map((receipt) => receipt.metadata.success), [false, true]);
  assert.match(finalReceipts.at(-2).content, /Tool result reference unavailable/);
  assert.deepEqual(JSON.parse(readFileSync(statePath, 'utf8')).effects, ['image-effect']);
  assert.equal(serverFailure, undefined); assert.equal(calls.length, 1);
  report = { route: 'built GUI + source CLI + native loopback SDK + admitted MCP', provider, contribution, mode, sourceId, initialReceipts: receipts.length, retrievalPages: pages.length, spillChars: totalChars, imageBytes, imageSha256, imageDimensions: [128, 96], retrievedBytesMatch: true, rootReceiptSpilled: true, restoredReceipts: finalReceipts.length, expiredReferenceExplicitlyRefused: true, effectReplay: false, effects: calls.length, spillCleanupObserved: true, elapsedMs: performance.now() - started, providerRequests: requests, paidModelRequests: 0, costUsd: null, modelVisionInference: false, durableArtifactRecovery: false, fixtureSha256: hash(readFileSync(fileURLToPath(import.meta.url))) };
} catch (error) {
  let rendered = ''; try { rendered = await currentPage?.locator('body').innerText(); } catch { /* The owned page may already be closed. */ }
  failures.push(new Error(`${error.message}\nRendered app: ${rendered}\nDiagnostics: ${diagnostics}`, { cause: error }));
} finally {
  for (const cleanup of [() => stop(), () => browser?.close(), () => web && close(web.httpServer), () => close(rpc)]) try { await cleanup(); } catch (error) { failures.push(error); }
  rmSync(root, { recursive: true, force: true }); assert.equal(existsSync(root), false);
}
if (failures.length) throw new AggregateError(failures, 'Oversized image validation failed');
process.stdout.write(`${JSON.stringify({ ...report, cleanupComplete: true })}\n`);
