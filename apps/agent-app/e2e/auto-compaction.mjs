/** Actual desktop shell and source CLI compaction against a native loopback OpenAI adapter. */
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import electronPath from 'electron';
import { _electron as electron } from 'playwright';
import { resolveProductConfig } from '../../../packages/product-config/src/index.ts';
import { createNodeWorkspaceTrustService } from '../../../packages/agent-framework/src/index.ts';
import { createCliRuntimeContext } from '../../../packages/agent-cli/src/product/runtime-context.ts';
import { respond } from '../../../packages/agent-cli/src/__tests__/helpers/provider-wire-fixture.ts';
import { buildProductTestEnvironment, readDesktopTestIdentity } from './product-fixture.mjs';

const runFile = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../..');
const fixtureSha256 = createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex');
const mainJs = resolve(here, '../dist/electron/main.js');
const cli = join(repository, 'packages/agent-cli/src/bin.ts');
const loader = pathToFileURL(createRequire(join(repository, 'packages/agent-cli/package.json')).resolve('tsx')).href;
const output = process.argv[2] ? resolve(process.argv[2]) : undefined;
if (output) mkdirSync(output, { recursive: true });
assert.ok(existsSync(mainJs), 'Build the GUI and Electron shell before running this fixture');
const root = realpathSync(mkdtempSync(join(process.platform === 'darwin' ? '/tmp' : tmpdir(), 'rc-')));
const home = join(root, 'home');
const workspace = join(root, 'workspace');
const sidecar = join(root, 'source-cli');
const fixture = buildProductTestEnvironment(join(root, 'product'), readDesktopTestIdentity(dirname(mainJs)));
const environment = {
  ...Object.fromEntries(['PATH', 'DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'SystemRoot', 'APPDATA', 'TMPDIR', 'TEMP', 'LANG']
    .filter((key) => typeof process.env[key] === 'string').map((key) => [key, process.env[key]])),
  ...fixture.environment, HOME: home, USERPROFILE: home,
  PRODUCT_USER_STATE_DIR: join(home, '.robota'), ROBOTA_USER_STATE_DIR: join(home, '.robota'),
};
const runtime = createCliRuntimeContext(resolveProductConfig({ environment }), environment);
const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const oldMarker = 'OLD_TRANSCRIPT_PAYLOAD_7F1C';
const retained = 'RETAINED_DECISION_6B93';
const firstPrompt = `Remember ${retained}. ${oldMarker} ${'A verbose intermediate measurement can be summarized. '.repeat(2400)}`;
const followPrompt = 'CONTINUE_AFTER_COMPACTION_194A';
const requests = [];
const wireEvents = [];
const checks = [];
const failures = [];
const diagnostics = [];
let application;
let page;
let rpc;
let summaryMode = 'valid';
let pendingSummary;
let pendingMain;
let holdFollowup = true;
let report;

const check = (label, value) => {
  assert.ok(value, label);
  checks.push(label);
  process.stdout.write(`PASS ${label}\n`);
};
const mainRequests = () => requests.filter((request) => request.kind === 'main');
const summaryRequests = () => requests.filter((request) => request.kind === 'summary');
const waitUntil = async (predicate, label, timeout = 20_000) => {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, `Timed out: ${label}`);
    await new Promise((done) => setTimeout(done, 40));
  }
};
async function runCli(args) {
  const result = await runFile(process.execPath, ['--import', loader, '--conditions=source', cli, ...args], {
    cwd: workspace, env: environment, timeout: 45_000, maxBuffer: 4 * 1024 * 1024,
  });
  const diagnosticOutput = args[0] === 'daemon' && args[1] === 'status'
    ? JSON.stringify({ ...JSON.parse(result.stdout), url: '[REDACTED_LOOPBACK_URL]' }) : result.stdout;
  diagnostics.push({ args, stdout: diagnosticOutput, stderr: result.stderr });
  return result.stdout;
}
async function launch() {
  application = await electron.launch({ executablePath: electronPath, cwd: workspace, timeout: 45_000,
    args: ['--no-sandbox', '--disable-gpu', mainJs], env: { ...environment, PRODUCT_GUI_SIDECAR_CMD: sidecar },
  });
  const shell = application.process();
  shell.once('exit', () => { for (const stream of shell.stdio) stream?.destroy(); });
  page = await application.firstWindow({ timeout: 45_000 });
  page.on('websocket', (socket) => socket.on('framereceived', ({ payload }) => {
    try {
      const event = JSON.parse(String(payload));
      if (['interrupted', 'error', 'history_changed', 'context'].includes(event.type)) wireEvents.push(event);
    } catch { /* Other frames are outside this acceptance observation. */ }
  }));
  page.setDefaultTimeout(25_000);
  await page.locator('.agent-gui-status[data-status="connected"]').waitFor({ timeout: 45_000 });
  await page.getByLabel('message', { exact: true }).waitFor();
}
async function closeApplication() {
  if (!application) return;
  const owned = application;
  application = undefined;
  const closed = owned.waitForEvent('close', { timeout: 10_000 });
  await owned.evaluate(({ app }) => { setImmediate(() => app.quit()); });
  await closed;
}
async function send(text) {
  await page.getByLabel('message', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}
async function idle() {
  await page.getByRole('button', { name: 'Send', exact: true }).waitFor();
}
async function contextPercentage() {
  const label = await page.locator('[title="Context used"]').getAttribute('aria-label');
  return Number(/^context (\d+)% used$/.exec(label)?.[1]);
}
async function listen(server) {
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  return server.address().port;
}

try {
  for (const directory of [home, workspace, runtime.layout.userRoot]) mkdirSync(directory, { recursive: true });
  execFileSync('git', ['init', '--quiet'], { cwd: workspace, env: environment });
  const commandsRoot = runtime.layout.skillRoots.find((entry) => entry.kind === 'commands');
  assert.ok(commandsRoot, 'The actual CLI product exposes its command root');
  const commands = join(workspace, commandsRoot.root);
  mkdirSync(commands, { recursive: true });
  writeFileSync(join(commands, 'compact-proof.md'), '---\ndescription: Complete the deterministic local compaction acceptance prompt.\n---\nCLI_SLASH_COMPACT_ACCEPTANCE\n');
  const trust = createNodeWorkspaceTrustService(runtime.layout.userPaths.workspaceTrust, runtime.layout.projectStateDirectories);
  assert.equal((await trust.grant(workspace)).status, 'trusted');
  writeFileSync(sidecar, `#!/bin/sh\nexec ${shellQuote(process.execPath)} --import ${shellQuote(loader)} --conditions=source ${shellQuote(cli)} "$@"\n`);
  chmodSync(sidecar, 0o755);
  rpc = createServer(async (request, response) => {
    try {
      let raw = '';
      for await (const chunk of request) raw += String(chunk);
      const wire = JSON.parse(raw);
      const text = JSON.stringify(wire.messages);
      const kind = wire.messages.length === 1 && wire.messages[0].role === 'user' && wire.messages[0].content.startsWith('Summarize the following conversation')
        ? 'summary' : Array.isArray(wire.tools) && wire.tools.length > 0 ? 'main' : 'auxiliary';
      const captured = { kind, wire, at: new Date().toISOString() };
      requests.push(captured);
      if (kind === 'summary') {
        if (summaryMode === 'cancel') {
          pendingSummary = { response, captured, closed: false };
          const held = pendingSummary;
          response.once('close', () => { held.closed = true; });
          return;
        }
        respond('openai', response, wire.stream === true, requests.length, undefined,
          summaryMode === 'invalid' ? '   ' : `Preserve ${retained}. The earlier measurements were reviewed; continue the task.`);
        return;
      }
      if (kind === 'main' && text.includes(followPrompt) && holdFollowup) {
        pendingMain = { response, captured };
        return;
      }
      respond('openai', response, wire.stream === true, requests.length, undefined,
        kind === 'main' ? `PRODUCT_REPLY_${mainRequests().length}` : 'Fixture conversation');
    } catch (error) {
      failures.push(error);
      response.writeHead(500).end();
    }
  });
  const port = await listen(rpc);
  writeFileSync(runtime.layout.userPaths.settings, JSON.stringify({
    autoCompactThreshold: 0.08, currentProvider: 'openai',
    providers: { openai: { type: 'openai', model: 'fixture-model', apiKey: 'unused-loopback-key',
      baseURL: `http://127.0.0.1:${port}/v1`, options: { apiSurface: 'chat-completions' } } },
  }));
  await launch();
  const daemonBefore = JSON.parse(await runCli(['daemon', 'status', '--json']));
  check('Electron connects to the actual source CLI daemon', daemonBefore.running === true && typeof daemonBefore.id === 'string' && /^[0-9a-f-]{36}$/i.test(daemonBefore.id));
  await send(firstPrompt);
  await page.getByText('PRODUCT_REPLY_1', { exact: true }).waitFor();
  await idle();
  const before = await contextPercentage();
  check('Ordinary conversation completes and exceeds the configured auto threshold', before >= 8);

  summaryMode = 'invalid';
  await send('FAIL_SUMMARY_WITHOUT_LOSING_HISTORY');
  await waitUntil(() => summaryRequests().length >= 1, 'invalid summary request');
  await idle();
  await page.getByText(/empty|invalid|whitespace/i).first().waitFor();
  check('Invalid automatic summary stops the turn before a normal model request', mainRequests().length === 1);
  check('Failed summary leaves the live context unchanged', await contextPercentage() === before);
  check('Failed compaction is not presented as successful', await page.getByRole('status').filter({ hasText: /^Auto compacted context:/ }).count() === 0);

  summaryMode = 'cancel';
  const alertsBeforeCancellation = await page.getByRole('alert').allTextContents();
  const wireBeforeCancellation = wireEvents.length;
  await send('CANCEL_SUMMARY_WITHOUT_LOSING_HISTORY');
  await waitUntil(() => pendingSummary !== undefined, 'held cancellation summary');
  check('After failed compaction the next summary still receives the original transcript', JSON.stringify(pendingSummary.captured.wire.messages).includes(oldMarker));
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await idle();
  await waitUntil(() => pendingSummary.closed, 'cancelled native provider connection');
  check('Cancellation preserves history and avoids a normal model request', mainRequests().length === 1 && await contextPercentage() === before);
  assert.deepEqual(await page.getByRole('alert').allTextContents(), alertsBeforeCancellation, 'User cancellation adds no failure alert');
  check('Cancellation reaches the app as an interrupted event', wireEvents.slice(wireBeforeCancellation).some((event) => event.type === 'interrupted'));
  check('User cancellation returns to idle without a new failure notice', true);
  check('Cancelled compaction is not presented as successful', await page.getByRole('status').filter({ hasText: /^Auto compacted context:/ }).count() === 0);

  summaryMode = 'valid';
  await send(followPrompt);
  await waitUntil(() => pendingMain !== undefined, 'held post-compaction model request');
  const compactedWire = JSON.stringify(pendingMain.captured.wire.messages);
  check('Successful retry preserves the decision and new prompt while removing old payload', compactedWire.includes(retained) && compactedWire.includes(followPrompt) && !compactedWire.includes(oldMarker));
  check('The internal summary is not streamed as the conversation reply', await page.getByText(`Preserve ${retained}. The earlier measurements were reviewed; continue the task.`, { exact: true }).count() === 0);
  const notice = page.getByRole('status').filter({ hasText: /^Auto compacted context:/ });
  await notice.waitFor();
  const after = await contextPercentage();
  check('Visible automatic compaction and reduced context arrive before the follow-up completes', after < before && await page.getByRole('button', { name: 'Stop', exact: true }).isVisible());
  if (output) await page.screenshot({ path: join(output, 'compacted-while-running.png'), fullPage: true });
  holdFollowup = false;
  respond('openai', pendingMain.response, pendingMain.captured.wire.stream === true, requests.length, undefined, 'PRODUCT_REPLY_2');
  pendingMain = undefined;
  await page.getByText('PRODUCT_REPLY_2', { exact: true }).waitFor();
  await idle();
  await send('/context');
  await page.getByText(/Auto-compact|Auto compact/).filter({ hasText: /8%/ }).first().waitFor();
  check('The real context slash command reports the configured automatic policy', true);
  if (output) await page.screenshot({ path: join(output, 'context-command.png'), fullPage: true });
  await closeApplication();
  await launch();
  const daemonAfter = JSON.parse(await runCli(['daemon', 'status', '--json']));
  check('Reopening the desktop reattaches to the same live daemon', daemonAfter.running === true && daemonBefore.id === daemonAfter.id);
  await page.getByText('PRODUCT_REPLY_2', { exact: true }).waitFor();
  await send('VERIFY_REOPENED_CONTEXT');
  await page.getByText('PRODUCT_REPLY_3', { exact: true }).waitFor();
  check('Reopened conversation uses the summary and excludes removed history', JSON.stringify(mainRequests().at(-1).wire.messages).includes(retained) && !JSON.stringify(mainRequests().at(-1).wire.messages).includes(oldMarker));
  await closeApplication();
  await runCli(['daemon', 'stop']);
  const saved = readdirSync(runtime.layout.userPaths.sessions).filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(runtime.layout.userPaths.sessions, name), 'utf8')))
    .map((envelope) => envelope.record)
    .filter((record) => record.cwd === workspace && JSON.stringify(record.messages).includes('PRODUCT_REPLY_3'));
  assert.equal(saved.length, 1, 'Exactly one saved desktop conversation contains the completed final turn');
  assert.equal(typeof saved[0].id, 'string');
  const restoreCount = mainRequests().length;
  const restored = await runCli(['-p', 'VERIFY_DISK_RESTORED_CONTEXT', '--resume', saved[0].id, '--output-format', 'json']);
  const restoreResult = JSON.parse(restored.trim());
  check('A fresh source CLI process resumes the saved desktop conversation', restoreResult.subtype === 'success' && restoreResult.result === `PRODUCT_REPLY_${restoreCount + 1}`);
  const restoredWire = JSON.stringify(mainRequests().at(-1).wire.messages);
  check('Disk-restored context retains the summary and new prompt without removed payload', restoredWire.includes(retained) && restoredWire.includes('VERIFY_DISK_RESTORED_CONTEXT') && !restoredWire.includes(oldMarker));

  for (const prompt of ['CLI_NORMAL_COMPACT_ACCEPTANCE', '/compact-proof']) {
    const count = mainRequests().length;
    const stdout = await runCli(['-p', prompt, '--output-format', 'stream-json']);
    const events = stdout.split('\n').flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
    const result = events.find((event) => event.type === 'result');
    assert.ok(result && typeof result.session_id === 'string');
    const initialized = JSON.parse(readFileSync(join(runtime.layout.userPaths.sessions, `${result.session_id}.json`), 'utf8')).record;
    check(`Source CLI initializes and completes ${prompt.startsWith('/') ? 'the custom slash command' : 'a normal prompt'}`,
      initialized.id === result.session_id && initialized.cwd === workspace && initialized.messages.some((message) => message.role === 'user') &&
      result.subtype === 'success' && result.result === `PRODUCT_REPLY_${count + 1}`);
  }
  check('The slash command expansion reaches the actual native provider request', JSON.stringify(mainRequests().at(-1).wire.messages).includes('CLI_SLASH_COMPACT_ACCEPTANCE'));
  report = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
    fixtureSha256,
    route: 'built Electron shell + real source CLI daemon + native OpenAI loopback adapter',
    host: process.platform, beforePercentage: before, afterPercentage: after, checks,
    mainRequests: mainRequests().length, summaryRequests: summaryRequests().length, paidModelRequests: 0,
    cancellationProviderConnectionClosed: pendingSummary.closed,
  };
} catch (error) {
  failures.push(error);
  if (output && page && !page.isClosed()) {
    writeFileSync(join(output, 'failure-page.txt'), await page.locator('body').innerText().catch(() => 'Unavailable'));
    await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {});
  }
} finally {
  pendingMain?.response.destroy();
  pendingSummary?.response.destroy();
  const shellCleanup = await Promise.allSettled([closeApplication()]);
  for (const result of shellCleanup) if (result.status === 'rejected') failures.push(result.reason);
  try {
    await runCli(['daemon', 'stop']);
    check('Only the disposable workspace daemon is stopped', JSON.parse(await runCli(['daemon', 'status', '--json'])).running === false);
  } catch (error) { failures.push(error); }
  if (rpc) {
    rpc.closeAllConnections();
    await new Promise((done) => rpc.close(done));
  }
  if (output) {
    writeFileSync(join(output, 'provider-requests.json'), JSON.stringify(requests, null, 2));
    writeFileSync(join(output, 'wire-events.json'), JSON.stringify(wireEvents, null, 2));
    writeFileSync(join(output, 'cli-diagnostics.json'), JSON.stringify(diagnostics, null, 2));
    writeFileSync(join(output, 'result.json'), JSON.stringify({ ...report, checks, success: failures.length === 0, failures: failures.map((error) => error.stack ?? String(error)), cleanupComplete: failures.length === 0 }, null, 2));
  }
  rmSync(root, { recursive: true, force: true });
}
if (failures.length) throw new AggregateError(failures, 'Actual desktop auto-compaction acceptance failed');
process.stdout.write(`${JSON.stringify(report)}\n`);
