/** Actual GUI + stock CLI bootstrap/runtime + MCP, using an explicitly supplied browser. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { summarizeRuntimeTiming } from './runtime-timing.mjs';
import { chromium } from 'playwright';
import { preview } from 'vite';
import {
  createNodeHostSessionStore,
  createNodeWorkspaceTrustService,
} from '../../agent-framework/src/index.ts';
import {
  createTestBinaryEnvironment,
  createTestProductRuntime,
} from '../../agent-cli/src/__tests__/helpers/product-runtime.ts';
import {
  respond,
  wireReceipts,
} from '../../agent-cli/src/__tests__/helpers/provider-wire-fixture.ts';
import { createInitialCliWorkspaceComposition } from '../../agent-cli/src/startup/workspace-project-composition.ts';

const executablePath = process.argv[2];
const count = Number(process.argv[3] ?? 20);
const mode = process.argv[4] ?? 'success';
const provider = process.argv[5] ?? 'replay';
const contribution = process.argv[6] ?? 'standalone';
assert.ok(
  ['standalone', 'packaged'].includes(contribution),
  'Contribution must be standalone or packaged',
);
const measureTiming = process.env.PRODUCT_FIXTURE_MEASURE_TIMING === '1';
const sourceId = contribution === 'packaged' ? 'fixture:probe' : 'probe';
const toolName = contribution === 'packaged' ? 'fixture_probe__echo' : 'probe__echo';
assert.ok(
  ['replay', 'anthropic', 'openai'].includes(provider),
  'Provider must be replay, anthropic or openai',
);
assert.ok(
  executablePath && isAbsolute(executablePath) && existsSync(executablePath),
  'Supply an existing absolute Chromium executable path; no browser is downloaded',
);
assert.ok([1, 20, 100].includes(count), 'Call count must be 1, 20 or 100');
assert.ok(
  [
    'success',
    'allow',
    'deny',
    'cancel',
    'cancel-permission',
    'restore-allow',
    'restore-deny',
  ].includes(mode),
  'Mode must be success, allow, deny, cancel, cancel-permission, restore-allow or restore-deny',
);
assert.ok(mode === 'success' || count === 1, 'Permission and cancellation cases use one call');
const cancellationCase = mode === 'cancel' || mode === 'cancel-permission';
const authorityCase = mode === 'restore-allow' || mode === 'restore-deny';
const continuationCase = cancellationCase || authorityCase;
const failed = mode === 'deny' || cancellationCase;
const permissionCase = mode === 'allow' || mode === 'deny' || mode === 'cancel-permission';
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cliRoot = join(packageRoot, '../agent-cli');
const tsxLoader = pathToFileURL(createRequire(join(cliRoot, 'package.json')).resolve('tsx')).href;
const host = join(cliRoot, 'src/__tests__/e2e/fixtures/mcp-bidirectional-host.ts');
const root = mkdtempSync(join(tmpdir(), 'gui-runtime-outcome-'));
const home = join(root, 'home');
const statePath = join(root, 'effects.json');
const tracePath = join(root, 'replay.jsonl');
const recoveryTracePath = join(root, 'recovery.jsonl');
const token = randomBytes(32).toString('hex');
const calls = [];
const providerRequests = [];
const mcpServiceIntervals = [];
let initialTiming;
let permissionVisibleStarted;
let permissionVisibleWaitMs = 0;
let providerRound = 0;
let recoveryPhase = false;
let auxiliaryRequests = 0;
let serverFailure;
let browser;
let web;
let rpc;
let child;
let diagnostics = '';
let report;
let recoveryReceipts = 0;
let restoredPermissionPrompts = 0;
let cancellationLatencyMs = null;
let heldResponseClosed = false;
let memoryBytes = null;
let memorySamples = 0;
const failures = [];
const started = performance.now();
const memoryIntervalMs = 100;
const memorySampler = setInterval(() => {
  if (process.platform !== 'linux' || child?.pid === undefined) return;
  const pending = [child.pid];
  const seen = new Set();
  let total = 0;
  while (pending.length > 0) {
    const pid = pending.pop();
    if (seen.has(pid)) continue;
    seen.add(pid);
    try {
      const status = readFileSync(`/proc/${pid}/status`, 'utf8');
      const rss = status.match(/^VmRSS:\s+(\d+)\s+kB$/m);
      if (rss) total += Number(rss[1]) * 1024;
      const children = readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim();
      if (children) pending.push(...children.split(/\s+/).map(Number));
    } catch {
      // Owned processes may exit between samples; unsupported measurements remain unknown.
    }
  }
  if (total > 0) {
    memoryBytes = Math.max(memoryBytes ?? 0, total);
    memorySamples++;
  }
}, memoryIntervalMs);
const steps = Array.from({ length: count }, (_, index) => ({
  id: `gui-call-${index}`,
  name: index % 5 === 4 ? 'Read' : toolName,
  args: index % 5 === 4 ? { filePath: join(root, 'observation.txt') } : { text: `value-${index}` },
}));
const recoveryId = 'gui-reobserve-0';
const recoveryStep = {
  id: recoveryId,
  name: authorityCase ? toolName : 'Read',
  args: authorityCase ? { text: 'value-restored' } : { filePath: statePath },
};
const imageHash = (data) => createHash('sha256').update(Buffer.from(data, 'base64')).digest('hex');
const until = async (predicate, label, timeoutMs = 20_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out awaiting ${label}: ${diagnostics}`);
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
async function stopChild() {
  if (!child) return;
  const owned = child;
  child = undefined;
  if (owned.exitCode !== null || owned.signalCode !== null) {
    assert.equal(owned.exitCode, 0, diagnostics);
    return;
  }
  let timer;
  const exited = new Promise((resolve, reject) => {
    owned.once('exit', (code, signal) => {
      clearTimeout(timer);
      code === 0 && signal === null
        ? resolve()
        : reject(
            new Error(
              `Runtime exit ${code}/${signal} pid=${owned.pid} recovery=${recoveryPhase}: ${diagnostics}`,
            ),
          );
    });
    timer = setTimeout(() => {
      owned.kill('SIGKILL');
      reject(new Error('Runtime failed graceful shutdown'));
    }, 8_000);
  });
  owned.kill('SIGTERM');
  await exited.finally(() => clearTimeout(timer));
}
async function closeServer(server) {
  if (!server) return;
  server.closeAllConnections();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
async function observePage(page, pageUrl) {
  const frames = [];
  page.on('websocket', (socket) =>
    socket.on('framereceived', ({ payload }) => {
      if (typeof payload === 'string' && payload.startsWith('{')) frames.push(JSON.parse(payload));
    }),
  );
  await page.goto(pageUrl);
  await page
    .locator('.agent-gui-status[data-status="connected"]')
    .waitFor({ timeout: 20_000 })
    .catch(async (error) => {
      throw new Error(
        `${error.message}\nRuntime diagnostics:\n${diagnostics}\nRendered page:\n${await page.locator('body').innerText()}`,
      );
    });
  await page.getByLabel('message', { exact: true }).waitFor();
  return frames;
}
async function inspectRenderedObservation(page, denied, image) {
  const groups = page.getByRole('button', { name: /^\d+ tool calls?/ });
  await groups
    .first()
    .waitFor({ timeout: 10_000 })
    .catch(async (error) => {
      throw new Error(
        `${error.message}\nRendered transcript:\n${await page.locator('body').innerText()}`,
      );
    });
  const groupCount = await groups.count();
  let renderedCount = 0;
  for (let index = 0; index < groupCount; index++) {
    const group = groups.nth(index);
    renderedCount += Number((await group.innerText()).match(/^\d+/)[0]);
    await group.click();
  }
  assert.equal(renderedCount, count);
  const cards = page.getByRole('button', { name: new RegExp(`^${toolName}`) });
  assert.equal(await cards.count(), steps.filter((step) => step.name === toolName).length);
  await cards.first().click();
  await page
    .getByText(/Tool source \(attribution only, not authority\)/)
    .first()
    .waitFor();
  if (denied) {
    assert.match(await cards.first().innerText(), /failed/);
    assert.equal(await page.getByRole('img', { name: `Observation from ${toolName}` }).count(), 0);
  } else {
    await page.getByText('OBSERVED_value-0', { exact: true }).waitFor();
    const rendered = page.getByRole('img', { name: `Observation from ${toolName}` });
    await rendered.waitFor();
    assert.equal(await rendered.getAttribute('src'), `data:image/png;base64,${image}`);
    await rendered.evaluate((element) => element.decode());
    assert.deepEqual(
      await rendered.evaluate((element) => [element.naturalWidth, element.naturalHeight]),
      [32, 16],
    );
  }
}

try {
  mkdirSync(join(home, '.test-product'), { recursive: true });
  writeFileSync(statePath, JSON.stringify({ effects: [] }));
  writeFileSync(join(root, 'observation.txt'), 'BUILTIN_OBSERVATION');
  browser = await chromium.launch({ executablePath });
  const imagePage = await browser.newPage({ viewport: { width: 32, height: 16 } });
  await imagePage.setContent('<body style="margin:0;background:#663399"></body>');
  const image = (await imagePage.screenshot()).toString('base64');
  await imagePage.close();
  rpc = createServer(async (request, response) => {
    try {
      if (request.method === 'GET') {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' }).write(': ready\n\n');
        return;
      }
      let raw = '';
      for await (const chunk of request) raw += String(chunk);
      if (request.url?.startsWith('/v1/')) {
        const wire = JSON.parse(raw);
        if (!wire.tools?.some((tool) => (tool.name ?? tool.function?.name) === toolName)) {
          auxiliaryRequests++;
          respond(provider, response, wire.stream === true, -1);
          return;
        }
        const round = providerRound++;
        const receipts = wireReceipts(provider, wire);
        const activeSteps = recoveryPhase ? [recoveryStep] : steps;
        const historyIds = recoveryPhase ? [steps[0].id] : [];
        assert.deepEqual(
          receipts.map((receipt) => receipt.id),
          [...historyIds, ...activeSteps.slice(0, round).map((step) => step.id)],
        );
        if (provider === 'anthropic')
          for (const receipt of receipts)
            assert.equal(
              receipt.failed,
              (failed && receipt.id === steps[0].id) ||
                (mode === 'restore-deny' && receipt.id === recoveryId),
            );
        if ((recoveryPhase && cancellationCase) || failed) {
          assert.equal(
            JSON.stringify(wire).includes(image),
            false,
            'Failed calls must not invent image observations',
          );
        } else if (round > 0 || (recoveryPhase && authorityCase)) {
          const observed = JSON.stringify(receipts[0].content);
          assert.match(observed, /OBSERVED_value-0/);
          assert.match(observed, /Tool source \(attribution only, not authority\)/);
          assert.ok(
            JSON.stringify(wire).includes(image),
            'The native provider receives the real screenshot bytes',
          );
          assert.ok(
            JSON.stringify(wire).includes(
              provider === 'anthropic' ? '"type":"image"' : '"type":"image_url"',
            ),
          );
        }
        providerRequests.push({ recoveryPhase, round, wire });
        assert.ok(round <= activeSteps.length, 'No unexpected model rounds');
        respond(
          provider,
          response,
          wire.stream === true,
          round,
          activeSteps[round],
          recoveryPhase ? 'GUI_RECOVERY_DONE' : 'GUI_OUTCOME_DONE',
        );
        return;
      }
      assert.equal(
        request.url,
        '/mcp',
        'Only the selected installed source may receive MCP traffic',
      );
      const message = JSON.parse(raw);
      if (message.id === undefined) {
        response.writeHead(202).end();
        return;
      }
      let result = {};
      let serviceStartedAt;
      if (message.method === 'initialize')
        result = {
          protocolVersion: '2025-11-25',
          capabilities: { tools: {} },
          serverInfo: { name: 'gui-outcome-fixture', version: '1' },
        };
      if (message.method === 'tools/list')
        result = {
          tools: [
            {
              name: 'echo',
              description: 'Persist a fixture value and return observations',
              inputSchema: {
                type: 'object',
                properties: { text: { type: 'string' } },
                required: ['text'],
              },
            },
          ],
        };
      if (message.method === 'tools/call') {
        serviceStartedAt = Date.now();
        const text = message.params.arguments.text;
        calls.push(text);
        const state = JSON.parse(readFileSync(statePath, 'utf8'));
        state.effects.push(text);
        writeFileSync(statePath, JSON.stringify(state));
        if (mode === 'cancel') {
          response.once('close', () => {
            heldResponseClosed = true;
          });
          // The effect exists, but its acknowledgement is withheld until the owner stops the turn.
          return;
        }
        result = {
          isError: false,
          structuredContent: { value: text, effects: state.effects.length },
          content: [
            { type: 'text', text: `OBSERVED_${text}` },
            ...(text === 'value-0' ? [{ type: 'image', mimeType: 'image/png', data: image }] : []),
          ],
        };
      }
      if (message.method === 'tools/call')
        mcpServiceIntervals.push({
          id: steps.find((step) => step.args.text === message.params.arguments.text)?.id ?? recoveryId,
          startedAt: serviceStartedAt, endedAt: Date.now(),
        });
      response
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
    } catch (error) {
      serverFailure = error;
      response
        .writeHead(500, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ error: 'Fixture assertion failed' }));
    }
  });
  const rpcPort = await listen(rpc);
  writeFileSync(
    join(home, '.test-product/settings.json'),
    JSON.stringify({
      currentProvider: provider === 'replay' ? 'anthropic' : provider,
      providers: {
        [provider === 'replay' ? 'anthropic' : provider]: {
          type: provider === 'replay' ? 'anthropic' : provider,
          model: 'fixture-model',
          apiKey: 'unused-fixture-key',
          ...(provider === 'replay' ? {} : { baseURL: `http://127.0.0.1:${rpcPort}/v1` }),
          ...(provider === 'openai' ? { options: { apiSurface: 'chat-completions' } } : {}),
        },
      },
      ...(contribution === 'standalone'
        ? { mcpServers: { probe: { type: 'http', url: `http://127.0.0.1:${rpcPort}/mcp` } } }
        : { enabledPlugins: { 'fixture@market': true } }),
    }),
  );
  if (contribution === 'packaged') {
    const runtime = createTestProductRuntime('test-product', { HOME: home });
    const pluginsDir = join(runtime.layout.userRoot, 'plugins');
    const pinned = join(pluginsDir, 'cache', 'market', 'fixture', 'pinned');
    for (const revision of ['pinned', 'unselected']) {
      const directory = join(pluginsDir, 'cache', 'market', 'fixture', revision);
      mkdirSync(join(directory, '.claude-plugin'), { recursive: true });
      writeFileSync(
        join(directory, '.claude-plugin', 'plugin.json'),
        JSON.stringify({
          name: 'fixture',
          mcpServers: {
            probe: {
              type: 'http',
              url: `http://127.0.0.1:${rpcPort}/${revision === 'pinned' ? 'mcp' : 'unselected'}`,
            },
          },
        }),
      );
    }
    writeFileSync(
      join(pluginsDir, 'installed_plugins.json'),
      JSON.stringify({
        'fixture@market': {
          pluginName: 'fixture',
          marketplace: 'market',
          version: 'pinned',
          installPath: pinned,
          installedAt: 'fixture',
        },
      }),
    );
    execFileSync('git', ['init', '--quiet'], { cwd: root, env: createTestBinaryEnvironment(home) });
    const grant = await createNodeWorkspaceTrustService(
      runtime.layout.userPaths.workspaceTrust,
      runtime.layout.projectStateDirectories,
    ).grant(root);
    assert.equal(
      grant.status,
      'trusted',
      'Only the disposable fixture workspace is explicitly trusted',
    );
  }
  const timestamp = '2026-10-01T00:00:00.000Z';
  const trace = [
    ...steps.map((step, round) => ({
      schemaVersion: 1,
      timestamp,
      sessionId: 'fixture',
      executionId: 'fixture',
      round,
      event: 'provider_response_normalized',
      response: {
        role: 'assistant',
        content: '',
        id: `assistant-${round}`,
        timestamp,
        state: 'complete',
        toolCalls: [
          {
            id: step.id,
            type: 'function',
            function: { name: step.name, arguments: JSON.stringify(step.args) },
          },
        ],
      },
    })),
    {
      schemaVersion: 1,
      timestamp,
      sessionId: 'fixture',
      executionId: 'fixture',
      round: count,
      event: 'provider_response_normalized',
      response: {
        role: 'assistant',
        content: 'GUI_OUTCOME_DONE',
        id: 'final',
        timestamp,
        state: 'complete',
      },
    },
  ];
  writeFileSync(tracePath, trace.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
  const recoveryTrace = [
    {
      ...trace[0],
      round: 0,
      response: {
        ...trace[0].response,
        id: 'recovery-call',
        toolCalls: [
          {
            id: recoveryId,
            type: 'function',
            function: { name: recoveryStep.name, arguments: JSON.stringify(recoveryStep.args) },
          },
        ],
      },
    },
    {
      ...trace.at(-1),
      round: 1,
      response: { ...trace.at(-1).response, id: 'recovery-final', content: 'GUI_RECOVERY_DONE' },
    },
  ];
  writeFileSync(
    recoveryTracePath,
    recoveryTrace.map((entry) => JSON.stringify(entry)).join('\n') + '\n',
  );
  const reservation = createServer();
  const wsPort = await listen(reservation);
  await closeServer(reservation);
  web = await preview({ root: packageRoot, preview: { port: 0, host: '127.0.0.1' } });
  const pageUrl = new URL(web.resolvedUrls.local[0]);
  pageUrl.searchParams.set('ws', `ws://127.0.0.1:${wsPort}?token=${token}`);
  const launch = (resumeId) => {
    providerRound = 0;
    recoveryPhase = Boolean(resumeId && continuationCase);
    child = spawn(
      process.execPath,
      [
        '--import',
        tsxLoader,
        '--conditions=source',
        host,
        '--serve',
        '--permission-mode',
        'default',
        '--allowed-tools',
        permissionCase || (resumeId && authorityCase) ? 'Read' : `Read,${toolName}`,
        '--max-turns',
        String(count + 2),
        ...(provider === 'replay'
          ? ['--session-log', recoveryPhase ? recoveryTracePath : tracePath]
          : []),
        ...(resumeId ? ['--resume', resumeId] : []),
      ],
      {
        cwd: root,
        env: createTestBinaryEnvironment(home, {
          PRODUCT_WS_TOKEN: token,
          PRODUCT_WS_PORT: String(wsPort),
          ...(measureTiming ? { PRODUCT_FIXTURE_MEASURE_TIMING: '1' } : {}),
          ...(contribution === 'packaged' ? { PRODUCT_FIXTURE_MCP_SERVER_ID: sourceId } : {}),
        }),
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    child.stderr.on('data', (chunk) => {
      diagnostics += chunk.toString();
    });
    child.stdout.on('data', (chunk) => {
      diagnostics += chunk.toString();
    });
  };
  launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 780 } });
  const frames = await observePage(page, pageUrl.href);
  await page
    .getByLabel('message', { exact: true })
    .fill('Execute the supplied fixture observations.');
  await page.getByLabel('message', { exact: true }).press('Enter');
  let permissionPrompts = 0;
  if (permissionCase) {
    const dialog = page.getByRole('dialog', { name: 'pending question' });
    await dialog.waitFor();
    permissionPrompts++;
    permissionVisibleStarted = performance.now();
    assert.deepEqual(calls, [], 'A suspended permission must not dispatch');
    assert.deepEqual(
      JSON.parse(readFileSync(statePath, 'utf8')).effects,
      [],
      'No effect before approval',
    );
    if (mode !== 'cancel-permission') {
      await dialog
        .getByRole('button', { name: mode === 'allow' ? 'Allow' : 'Deny', exact: true })
        .click();
      permissionVisibleWaitMs += performance.now() - permissionVisibleStarted;
    }
  }
  if (cancellationCase) {
    if (mode === 'cancel') {
      await until(() => calls.length === 1, 'persisted effect before its acknowledgement');
      assert.deepEqual(JSON.parse(readFileSync(statePath, 'utf8')).effects, ['value-0']);
    }
    const cancelStarted = performance.now();
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    if (mode === 'cancel-permission')
      permissionVisibleWaitMs += performance.now() - permissionVisibleStarted;
    await until(() => frames.some((frame) => frame.type === 'interrupted'), 'runtime interruption');
    cancellationLatencyMs = performance.now() - cancelStarted;
    if (mode === 'cancel') await until(() => heldResponseClosed, 'withdrawn HTTP request');
    assert.equal(
      frames.some((frame) => frame.type === 'complete'),
      false,
      'An interrupted turn is not complete',
    );
    assert.equal(await page.getByText('GUI_OUTCOME_DONE', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Send', exact: true }).waitFor();
    assert.equal(await page.getByRole('dialog', { name: 'pending question' }).count(), 0);
  } else {
    await until(() => frames.some((frame) => frame.type === 'complete'), 'runtime completion');
    await page.getByText('GUI_OUTCOME_DONE', { exact: true }).waitFor();
  }
  assert.equal(frames.filter((frame) => frame.type === 'tool_end').length, count);
  assert.equal(serverFailure, undefined);
  if (provider !== 'replay')
    assert.equal(
      providerRequests.filter((entry) => !entry.recoveryPhase).length,
      cancellationCase ? 1 : count + 1,
    );
  await inspectRenderedObservation(page, failed, image);
  await page.close();
  await stopChild();
  if (measureTiming)
    initialTiming = summarizeRuntimeTiming({
      diagnostics, steps, mcpServiceIntervals, permissionVisibleWaitMs, cancellationCase, mode,
    });
  const environment = createTestProductRuntime('test-product', { HOME: home });
  const workspaceComposition =
    contribution === 'packaged'
      ? createInitialCliWorkspaceComposition(root, {
          productRuntime: environment,
          projectAccess: await createNodeWorkspaceTrustService(
            environment.layout.userPaths.workspaceTrust,
            environment.layout.projectStateDirectories,
          ).inspect(root),
        })
      : undefined;
  const store =
    workspaceComposition?.sessionStore ??
    createNodeHostSessionStore(environment.layout.userPaths.sessions);
  const records = store.list();
  assert.equal(records.length, 1);
  const loaded = records[0].outcome;
  assert.equal(loaded.status, 'valid');
  assert.equal(typeof loaded.record.id, 'string');
  const receipts = loaded.record.messages.filter((message) => message.role === 'tool');
  assert.deepEqual(
    receipts.map((message) => message.toolCallId),
    steps.map((step) => step.id),
  );
  for (const [index, receipt] of receipts.entries()) {
    assert.equal(receipt.metadata.success, !failed);
    if (steps[index].name === toolName) {
      const provenance = JSON.parse(receipt.metadata.toolProvenance);
      assert.equal(provenance.sourceId, sourceId);
      if (contribution === 'packaged')
        assert.ok(
          provenance.origin.startsWith(
            join(home, '.test-product', 'plugins', 'cache', 'market', 'fixture', 'pinned'),
          ),
          'Receipt source belongs to the selected installed revision',
        );
    }
  }
  if (!failed)
    assert.equal(
      imageHash(receipts[0].parts.find((part) => part.type === 'image_inline').data),
      imageHash(image),
    );
  let expected =
    mode === 'deny' || mode === 'cancel-permission'
      ? []
      : steps.filter((step) => step.name === toolName).map((step) => step.args.text);
  assert.deepEqual(calls, expected);
  assert.deepEqual(JSON.parse(readFileSync(statePath, 'utf8')).effects, expected);
  launch(loaded.record.id);
  const restoredPage = await browser.newPage({ viewport: { width: 1100, height: 780 } });
  const restoredFrames = await observePage(restoredPage, pageUrl.href);
  const restoredSnapshot = () =>
    restoredFrames.find(
      (frame) =>
        frame.type === 'messages' &&
        frame.display?.filter((segment) => segment.type === 'tool').length === count,
    );
  await until(() => restoredSnapshot() !== undefined, 'initialized fresh-runtime history').catch(
    (error) => {
      throw new Error(
        `${error.message}\nHistory evidence: ${JSON.stringify({ id: loaded.record.id, historyCategories: loaded.record.history.map((entry) => entry.category), snapshots: restoredFrames.filter((frame) => frame.type === 'messages').map((frame) => ({ roles: frame.messages.map((message) => message.role), displayTypes: frame.display?.map((segment) => segment.type) })) })}`,
      );
    },
  );
  assert.deepEqual(
    restoredSnapshot()
      .display.filter((segment) => segment.type === 'tool')
      .map((segment) => segment.tool.executionId),
    steps.map((step) => step.id),
  );
  await inspectRenderedObservation(restoredPage, failed, image);
  assert.deepEqual(calls, expected, 'Restoring history must not replay a mutation');
  assert.deepEqual(JSON.parse(readFileSync(statePath, 'utf8')).effects, expected);
  if (continuationCase) {
    await restoredPage
      .getByLabel('message', { exact: true })
      .fill(
        authorityCase
          ? 'Attempt a fresh operation under current permissions.'
          : 'Re-observe the persisted effects before continuing.',
      );
    await restoredPage.getByLabel('message', { exact: true }).press('Enter');
    if (authorityCase) {
      const dialog = restoredPage.getByRole('dialog', { name: 'pending question' });
      await dialog.waitFor();
      restoredPermissionPrompts++;
      assert.deepEqual(
        calls,
        expected,
        'The previous session allowlist must not authorize new dispatch',
      );
      assert.deepEqual(JSON.parse(readFileSync(statePath, 'utf8')).effects, expected);
      await dialog
        .getByRole('button', { name: mode === 'restore-allow' ? 'Allow' : 'Deny', exact: true })
        .click();
      if (mode === 'restore-allow') expected = [...expected, 'value-restored'];
    }
    await until(
      () => restoredFrames.some((frame) => frame.type === 'complete'),
      'fresh-runtime continuation turn',
    );
    await restoredPage.getByText('GUI_RECOVERY_DONE', { exact: true }).waitFor();
    const recoveryEnds = restoredFrames.filter((frame) => frame.type === 'tool_end');
    assert.equal(recoveryEnds.length, 1);
    assert.equal(recoveryEnds[0].state.executionId, recoveryId);
    if (mode === 'restore-deny') assert.notEqual(recoveryEnds[0].state.result, 'success');
    else assert.equal(recoveryEnds[0].state.result, 'success');
    if (authorityCase) {
      const groups = restoredPage.getByRole('button', { name: /^\d+ tool calls?/ });
      assert.equal(await groups.count(), 2);
      await groups.last().click();
      const cards = restoredPage.getByRole('button', { name: new RegExp(`^${toolName}`) });
      assert.equal(await cards.count(), 2);
      if (mode === 'restore-deny') assert.match(await cards.last().innerText(), /failed/);
      await cards.last().click();
      assert.equal(
        await restoredPage.getByRole('img', { name: `Observation from ${toolName}` }).count(),
        1,
        'Only the original successful call supplied an image',
      );
    }
  }
  await restoredPage.close();
  await stopChild();
  assert.equal(serverFailure, undefined);
  if (provider !== 'replay' && continuationCase)
    assert.equal(providerRequests.filter((entry) => entry.recoveryPhase).length, 2);
  if (continuationCase) {
    const recovered = store.load(loaded.record.id);
    assert.equal(recovered.status, 'valid');
    const recoveredTools = recovered.record.messages.filter((message) => message.role === 'tool');
    assert.deepEqual(
      recoveredTools.map((message) => message.toolCallId),
      [steps[0].id, recoveryId],
    );
    assert.equal(recoveredTools[0].metadata.success, !failed);
    assert.equal(recoveredTools[1].metadata.success, mode !== 'restore-deny');
    if (authorityCase) {
      assert.equal(JSON.parse(recoveredTools[1].metadata.toolProvenance).sourceId, sourceId);
      assert.equal(
        recoveredTools[1].parts?.some((part) => part.type === 'image_inline') ?? false,
        false,
      );
    } else {
      const output = JSON.parse(recoveredTools[1].content).output;
      const observedState = output
        .split('\n')
        .slice(1)
        .map((line) => line.replace(/^\s*\d+\t/, ''))
        .join('\n');
      assert.deepEqual(JSON.parse(observedState).effects, expected);
    }
    assert.deepEqual(
      calls,
      expected,
      'Continuation effects match only dispatch authorized in the current runtime',
    );
    assert.deepEqual(JSON.parse(readFileSync(statePath, 'utf8')).effects, expected);
    recoveryReceipts = 1;
  }
  report = {
    route:
      'built shared app GUI + source CLI bootstrap/WS runtime + admitted ' +
      contribution +
      ' MCP; ' +
      (provider === 'replay'
        ? 'replay provider'
        : 'native provider SDK with loopback wire fixture'),
    provider,
    contribution,
    sourceId,
    sessionStoreScope: workspaceComposition?.sessionStoreScope ?? 'user',
    providerRequestBytes:
      provider === 'replay'
        ? null
        : {
            count: providerRequests.length,
            total: providerRequests.reduce(
              (bytes, entry) => bytes + Buffer.byteLength(JSON.stringify(entry.wire)),
              0,
            ),
            max: Math.max(
              ...providerRequests.map((entry) => Buffer.byteLength(JSON.stringify(entry.wire))),
            ),
          },
    auxiliaryRequests,
    count,
    mode,
    permissionPrompts,
    terminalOutcome: cancellationCase ? 'interrupted' : 'completed',
    cancellationLatencyMs,
    heldResponseClosed,
    recoveryReceipts,
    restoredPermissionPrompts,
    currentAuthorityRechecked: authorityCase ? true : null,
    freshRuntimeContinued: continuationCase ? true : null,
    receipts: receipts.length,
    effects: expected.length,
    freshRuntimeRestored: true,
    imageBytes: Buffer.from(image, 'base64').length,
    imageSha256: imageHash(image),
    browserVersion: browser.version(),
    fixtureSha256: createHash('sha256')
      .update(readFileSync(fileURLToPath(import.meta.url)))
      .digest('hex'),
    elapsedMs: performance.now() - started,
    paidModelRequests: 0,
    costUsd: null,
    stochasticComparison: false,
    ...(measureTiming ? { timingFixtureSha256: createHash('sha256')
      .update(readFileSync(new URL('./runtime-timing.mjs', import.meta.url))).digest('hex') } : {}),
    timingBreakdown: initialTiming ?? { model: null, queue: null, permission: null, transport: null, tool: null },
    memoryBytes,
    memoryMeasurement: {
      scope:
        'sampled maximum summed RSS of the owned CLI process tree; excludes browser and fixture host',
      platform: process.platform,
      intervalMs: memoryIntervalMs,
      samples: memorySamples,
    },
  };
} catch (error) {
  failures.push(error);
} finally {
  clearInterval(memorySampler);
  const cleanup = await Promise.allSettled([
    stopChild(),
    browser?.close(),
    closeServer(web?.httpServer),
    closeServer(rpc),
  ]);
  try {
    rmSync(root, { recursive: true, force: true });
  } catch (error) {
    failures.push(error);
  }
  for (const result of cleanup) if (result.status === 'rejected') failures.push(result.reason);
}
if (failures.length > 0)
  throw new AggregateError(failures, 'GUI runtime outcome or cleanup failed');
assert.equal(existsSync(root), false);
process.stdout.write(
  JSON.stringify({
    ...report,
    cleanup: {
      runtimeExitedCleanly: true,
      browserClosed: true,
      httpServersClosed: true,
      temporaryStateRemoved: true,
    },
  }) + '\n',
);
