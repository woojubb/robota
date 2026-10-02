/** Real app commands and stock CLI memory recall through native loopback SDK adapters. */
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
import { respond } from '../../agent-cli/src/__tests__/helpers/provider-wire-fixture.ts';
import { createInitialCliWorkspaceComposition } from '../../agent-cli/src/startup/workspace-project-composition.ts';

const executablePath = process.argv[2];
const provider = process.argv[3] ?? 'anthropic';
assert.ok(executablePath && isAbsolute(executablePath) && existsSync(executablePath));
assert.ok(['anthropic', 'openai'].includes(provider));
assert.equal(process.platform, 'linux', 'This authority-backed product fixture targets Linux');
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cliRoot = join(packageRoot, '../agent-cli');
const loader = pathToFileURL(createRequire(join(cliRoot, 'package.json')).resolve('tsx')).href;
const root = mkdtempSync(join(tmpdir(), 'gui-memory-lifecycle-'));
const home = join(root, 'home');
const workspaces = [join(root, 'first'), join(root, 'second')];
const runtime = createTestProductRuntime('test-product', { HOME: home });
const trust = createNodeWorkspaceTrustService(runtime.layout.userPaths.workspaceTrust, runtime.layout.projectStateDirectories);
const token = randomBytes(32).toString('hex');
const oldFact = 'BUILD_COMMAND_OBSOLETE_NPM';
const newFact = 'BUILD_COMMAND_CURRENT_PNPM';
let child;
let browser;
let web;
let rpc;
let diagnostics = '';
let requestFailure;
let mainRequests = 0;
const modelSystems = [];
const failures = [];
let report;
let currentPage;

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
      code === 0 && signal === null ? resolve() : reject(new Error(`CLI exit ${code}/${signal}: ${diagnostics}`));
    });
    timer = setTimeout(() => {
      owned.kill('SIGKILL');
      reject(new Error(`CLI stop timed out: ${diagnostics}`));
    }, 10_000);
  });
  owned.kill('SIGTERM');
  await exited;
}
async function memory(cwd) {
  return createInitialCliWorkspaceComposition(cwd, {
    productRuntime: runtime,
    projectAccess: await trust.inspect(cwd),
  }).memoryStore;
}
async function send(page, text) {
  await page.getByLabel('message', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}
async function observeRecall(page, expected, forbidden) {
  const index = mainRequests;
  await send(page, 'What are the build command instructions?');
  await page.getByText(`MEMORY_OBSERVED_${index}`, { exact: true }).waitFor();
  assert.equal(requestFailure, undefined);
  assert.equal(mainRequests, index + 1);
  const system = modelSystems[index];
  assert.ok(typeof system === 'string', 'The native provider request was captured');
  if (expected) assert.ok(system.includes(expected), 'Current memory reaches the model');
  for (const fact of forbidden) assert.equal(system.includes(fact), false, 'Stale or foreign memory is absent from current model context');
}

try {
  mkdirSync(runtime.layout.userRoot, { recursive: true });
  for (const cwd of workspaces) {
    mkdirSync(cwd, { recursive: true });
    execFileSync('git', ['init', '--quiet'], { cwd, env: createTestBinaryEnvironment(home) });
    assert.equal((await trust.grant(cwd)).status, 'trusted');
  }
  rpc = createServer(async (request, response) => {
    try {
      let raw = '';
      for await (const chunk of request) raw += String(chunk);
      const wire = JSON.parse(raw);
      // Title/summary requests have no main tool catalogue and must not consume a recall sample.
      const main = Array.isArray(wire.tools) && wire.tools.length > 0;
      const index = main ? mainRequests++ : -1;
      if (main) modelSystems.push(provider === 'anthropic' ? JSON.stringify(wire.system) : JSON.stringify(wire.messages.filter((message) => message.role === 'system')));
      respond(provider, response, wire.stream === true, index, undefined, `MEMORY_OBSERVED_${index}`);
    } catch (error) {
      requestFailure = error;
      response.writeHead(500).end();
    }
  });
  const port = await listen(rpc);
  writeFileSync(runtime.layout.userPaths.settings, JSON.stringify({
    memory: { enabled: true },
    currentProvider: provider,
    providers: { [provider]: {
      type: provider, model: 'fixture-model', apiKey: 'unused-loopback-key',
      baseURL: `http://127.0.0.1:${port}/v1`,
      ...(provider === 'openai' ? { options: { apiSurface: 'chat-completions' } } : {}),
    } },
  }));
  browser = await chromium.launch({ executablePath });
  web = await preview({ root: packageRoot, preview: { port: 0, host: '127.0.0.1' } });
  const launch = async (cwd) => {
    const reservation = createServer();
    const wsPort = await listen(reservation);
    await close(reservation);
    child = spawn(process.execPath, ['--import', loader, '--conditions=source', join(cliRoot, 'src/bin.ts'), '--serve', '--permission-mode', 'default'], {
      cwd,
      env: createTestBinaryEnvironment(home, { PRODUCT_WS_TOKEN: token, PRODUCT_WS_PORT: String(wsPort) }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => { diagnostics += String(chunk); });
    child.stderr.on('data', (chunk) => { diagnostics += String(chunk); });
    const url = new URL(web.resolvedUrls.local[0]);
    url.searchParams.set('ws', `ws://127.0.0.1:${wsPort}?token=${token}`);
    const page = await browser.newPage({ viewport: { width: 1100, height: 780 } });
    currentPage = page;
    page.setDefaultTimeout(20_000);
    await page.goto(url.href);
    await page.locator('.agent-gui-status[data-status="connected"]').waitFor({ timeout: 20_000 });
    await page.getByLabel('message', { exact: true }).waitFor();
    return page;
  };

  let page = await launch(workspaces[0]);
  await send(page, `/memory add project build ${oldFact}`);
  await page.getByText(/Saved project memory to/).waitFor();
  assert.match(await (await memory(workspaces[0])).readTopic('build'), new RegExp(oldFact));
  await observeRecall(page, oldFact, [newFact]);
  await send(page, `/memory correct project build ${newFact}`);
  await page.getByText(/Replaced all active memory in/).waitFor();
  const corrected = await (await memory(workspaces[0])).readTopic('build');
  assert.match(corrected, new RegExp(newFact));
  assert.equal(corrected.includes(oldFact), false);
  await observeRecall(page, newFact, [oldFact]);
  await page.close();
  await stop();

  page = await launch(workspaces[0]);
  await observeRecall(page, newFact, [oldFact]);
  await send(page, '/memory forget build');
  await page.getByText(/Forgot active memory topic build/).waitFor();
  assert.equal(await (await memory(workspaces[0])).readTopic('build'), '');
  await observeRecall(page, undefined, [oldFact, newFact]);
  await page.close();
  await stop();

  page = await launch(workspaces[0]);
  await observeRecall(page, undefined, [oldFact, newFact]);
  await send(page, `/memory add project build ${oldFact}`);
  await page.getByText(/This topic is controlled by the user/).waitFor();
  assert.equal(await (await memory(workspaces[0])).readTopic('build'), '');
  // Keep a current entry in the first project when testing isolation in the second.
  await send(page, `/memory correct project build ${newFact}`);
  await page.getByText(/Replaced all active memory in/).waitFor();
  await page.close();
  await stop();

  page = await launch(workspaces[1]);
  await observeRecall(page, undefined, [oldFact, newFact]);
  assert.equal(await (await memory(workspaces[1])).readTopic('build'), '');
  assert.match(await (await memory(workspaces[0])).readTopic('build'), new RegExp(newFact));
  await page.close();
  await stop();
  report = {
    route: 'built shared app + stock source CLI binary + real project memory + native loopback SDK',
    provider, mainRequests, freshProcesses: 4,
    correctedSameSession: true, correctedAfterRestart: true,
    forgottenSameSession: true, forgottenAfterRestart: true,
    ordinaryAppendRefused: true, crossProjectIsolated: true,
    paidModelRequests: 0, semanticIndexConfigured: false,
    fixtureSha256: createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex'),
  };
} catch (error) {
  const body = await currentPage?.locator('body').innerText().catch(() => 'Page unavailable');
  failures.push(new Error(`${error.message}\nRendered app: ${body}\nCLI diagnostics: ${diagnostics}`, { cause: error }));
} finally {
  const cleanup = await Promise.allSettled([stop(), browser?.close(), web?.httpServer ? close(web.httpServer) : undefined, close(rpc)]);
  for (const result of cleanup) if (result.status === 'rejected') failures.push(result.reason);
  rmSync(root, { recursive: true, force: true });
  if (report) process.stdout.write(`${JSON.stringify({ ...report, cleanupComplete: failures.length === 0 })}\n`);
}
if (failures.length) throw new AggregateError(failures, 'App memory lifecycle validation failed');
