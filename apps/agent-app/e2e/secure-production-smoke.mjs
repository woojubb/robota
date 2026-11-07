import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import electronPath from 'electron';
import { _electron as electron } from 'playwright';

import { resolveProductConfig } from '../../../packages/product-config/dist/index.js';
import { createCliRuntimeContext } from '../../../packages/agent-cli/src/product/runtime-context.ts';
import { openDesktopSecureOwner } from '../../../packages/agent-cli/src/desktop-secure-host.ts';
import { writeProductConversationMode } from '../../../packages/agent-cli/src/secure/conversation-mode-state.ts';
import { FIXTURE_PASSPHRASE, fixtureKeyring } from '../../../packages/agent-cli/src/secure/__tests__/helpers.ts';
import { workspaceRootBrokerEndpoint } from '../../../packages/agent-cli/src/startup/workspace-root-broker-process.ts';
import { requestWorkspaceRootBroker } from '../../../packages/agent-cli/src/startup/workspace-root-broker.ts';
import { startTestBroker } from '../../../packages/agent-cli/src/__tests__/helpers/test-workspace-root-broker.ts';
import { listSupervisedSessions, resolveSupervisedDirectory, stopSupervisedSession } from '../../../packages/agent-cli/src/session-inventory/supervised-session-control.ts';
import { serializeKeyring } from '@robota-sdk/agent-keyring';
import { NodeSessionStore } from '../../../packages/agent-session/src/node.ts';
import { KeyHolder } from '../../../packages/agent-cli/src/secure/key-holder.ts';
import { KeyHolderArtifactSealer, WriteOnlyArtifactSealer } from '../../../packages/agent-cli/src/secure/artifact-sealer.ts';
import { createMemoryKeyringStore } from '../../../packages/agent-cli/src/secure/__tests__/helpers.ts';
import { buildProductTestEnvironment, readDesktopTestIdentity } from './product-fixture.mjs';
import { desktopDaemonEnvironment, desktopHostEnvironment } from '../electron/product-config.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repository = join(here, '../../..');
const main = join(here, '../dist/electron/main.js');
const root = mkdtempSync(join(process.platform === 'win32' ? tmpdir() : realpathSync('/tmp'), 'rsd-'));
const home = join(root, 'home');
const workspace = realpathSync(mkdtempSync(join(root, 'workspace-')));
const fixture = buildProductTestEnvironment(join(root, 'product'), readDesktopTestIdentity(dirname(main)));
const config = resolveProductConfig({ environment: fixture.environment });
const runtime = createCliRuntimeContext(config, fixture.environment);
const secureRuntime = createCliRuntimeContext(config, fixture.environment, undefined, 'secure');
const brokerEndpoint = workspaceRootBrokerEndpoint(runtime);
const brokerDirectory = process.platform === 'win32' ? join(runtime.layout.userRoot, 'root-broker') : dirname(brokerEndpoint);
const inherited = Object.fromEntries(['PATH', 'DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'SystemRoot', 'APPDATA', 'TMPDIR', 'TEMP', 'LANG']
  .filter((name) => typeof process.env[name] === 'string').map((name) => [name, process.env[name]]));
let app;
let broker;
try {
  mkdirSync(home, { recursive: true });
  execFileSync('git', ['init', '--quiet', workspace]);
  mkdirSync(dirname(runtime.layout.userPaths.keyring), { recursive: true, mode: 0o700 });
  const { keyring } = await fixtureKeyring();
  writeFileSync(runtime.layout.userPaths.keyring, serializeKeyring(keyring), { mode: 0o600 });
  writeProductConversationMode(runtime.layout.userRoot, 'plain', 'secure');
  const sealer = new KeyHolderArtifactSealer(new KeyHolder({ store: createMemoryKeyringStore(keyring), policy: { idleMs: 0 } }));
  const sessions = new NodeSessionStore(secureRuntime.layout.userPaths.sessions, {
    sealing: { sealer: new WriteOnlyArtifactSealer(sealer.writeGrant()) },
  });
  sessions.save({
    id: 'imported_e2e', cwd: workspace,
    createdAt: '2026-11-07T00:00:00.000Z', updatedAt: '2026-11-07T00:00:01.000Z',
    messages: [{ id: 'm1', role: 'user', content: 'Synthetic imported conversation',
      timestamp: new Date('2026-11-07T00:00:01.000Z'), state: 'complete' }],
  }, { provenance: 'owner' });
  sealer.dispose();
  mkdirSync(brokerDirectory, { recursive: true, mode: 0o700 });
  broker = await startTestBroker(brokerEndpoint, brokerDirectory, runtime.layout.userPaths.workspaceTrust);
  const prepared = await requestWorkspaceRootBroker(brokerEndpoint, { op: 'prepare', root: workspace });
  if (prepared.status !== 'prepared') throw new Error('The test folder could not be prepared.');
  const approved = await requestWorkspaceRootBroker(brokerEndpoint, { op: 'approve', root: workspace, candidate: prepared.candidate });
  if (approved.status !== 'trusted') throw new Error(`The test folder could not be approved: ${approved.status}, ${'reason' in approved ? approved.reason : 'no reason'}.`);

  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  const entry = join(repository, 'packages/agent-cli/src/testing/secure-runtime-entry.ts');
  const normalEntry = join(repository, 'packages/agent-cli/src/bin.ts');
  const tsx = createRequire(import.meta.url).resolve('tsx');
  const sidecar = join(root, 'source-sidecar');
  writeFileSync(sidecar, `#!/bin/sh\ncase "$1" in\n  trust) exec ${quote(process.execPath)} --disable-sigusr1 --import ${quote(pathToFileURL(tsx).href)} --conditions=source ${quote(normalEntry)} "$@" ;;\nesac\nexec ${quote(process.execPath)} --disable-sigusr1 --import ${quote(pathToFileURL(tsx).href)} --conditions=source ${quote(entry)} "$@"\n`, { mode: 0o700 });
  chmodSync(sidecar, 0o700);
  const trustStatus = JSON.parse(execFileSync(sidecar, ['trust', 'status', '--json'], {
    cwd: workspace,
    env: { ...inherited, HOME: home, USERPROFILE: home, ...fixture.environment },
    encoding: 'utf8',
  }));
  if (trustStatus.state !== 'trusted') throw new Error(`Fixture workspace trust is ${trustStatus.state}.`);

  let page;
  const launchApp = async () => {
    app = await electron.launch({
      executablePath: electronPath,
      args: ['--no-sandbox', '--disable-gpu', main], cwd: workspace,
      env: { ...inherited, HOME: home, USERPROFILE: home, ...fixture.environment, PRODUCT_GUI_SIDECAR_CMD: sidecar },
    });
    page = await app.firstWindow();
    try {
      await page.getByText('Secure conversation is locked.', { exact: false }).waitFor({ timeout: 15_000 });
    } catch (error) {
      console.error('Secure desktop first window:', await page.locator('body').innerText().catch(() => '(no body)'));
      throw error;
    }
  };
  const assertLocked = async () => {
    const hostEnvironment = desktopHostEnvironment(config, fixture.environment);
    const owner = await openDesktopSecureOwner({
      config, environment: hostEnvironment, workspace, restricted: false,
      secret: { type: 'passphrase', value: FIXTURE_PASSPHRASE },
      signal: new AbortController().signal,
      childEnvironment: desktopDaemonEnvironment(config, hostEnvironment, {
        restricted: false, providerEnvironmentReferences: [], allowScriptedE2eVariables: false,
      }),
      launchCommand: { executable: sidecar, args: [] },
    });
    try {
      if (owner.link.custody.unlocked) throw new Error('The secure runtime remained unlocked after the desktop closed.');
    } finally {
      owner.link.close();
      owner.release();
    }
  };
  await launchApp();
  const unlock = async () => {
    const opened = app.waitForEvent('window');
    const clicked = await app.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById('unlock-secure-conversation');
      item?.click();
      return Boolean(item?.enabled);
    });
    if (!clicked) throw new Error('The native unlock action was unavailable.');
    const secret = await opened;
    await secret.getByLabel('Passphrase or recovery key').fill(FIXTURE_PASSPHRASE);
    await secret.getByRole('button', { name: 'Unlock' }).click();
    await page.locator('.agent-gui-status[data-status="connected"]').waitFor({ timeout: 25_000 });
  };
  if (await page.evaluate(() => window.agentGui?.getEndpoint()) !== null) {
    throw new Error('The secure page exposed a daemon endpoint.');
  }
  await unlock();
  await app.evaluate(({ Menu, dialog }) => {
    globalThis.__secureReviewDialogs = [];
    const original = dialog.showMessageBox;
    dialog.showMessageBox = async (_window, options) => {
      const choice = options ?? _window;
      globalThis.__secureReviewDialogs.push(choice.message);
      return { response: 0, checkboxChecked: false };
    };
    globalThis.__restoreSecureReviewDialog = () => { dialog.showMessageBox = original; };
    Menu.getApplicationMenu()?.getMenuItemById('review-secure-stored-session')?.click();
  });
  let reviewDialogs = [];
  for (let attempt = 0; attempt < 100; attempt += 1) {
    reviewDialogs = await app.evaluate(() => globalThis.__secureReviewDialogs);
    if (reviewDialogs.some((message) => message.includes('The imported conversation was accepted.'))) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!reviewDialogs.some((message) => message.includes('Choose an imported conversation')) ||
      !reviewDialogs.some((message) => message.includes('The imported conversation was accepted.'))) {
    throw new Error(`The native imported-session review did not complete: ${reviewDialogs.join(' | ')}`);
  }
  await app.evaluate(() => globalThis.__restoreSecureReviewDialog());
  const powerClosed = page.waitForEvent('close', { timeout: 15_000 });
  const restoredWindow = app.waitForEvent('window', { timeout: 15_000 });
  await app.evaluate(({ powerMonitor }) => { powerMonitor.emit('lock-screen'); });
  await powerClosed;
  page = await restoredWindow;
  await page.getByText('Secure conversation is locked.', { exact: false }).waitFor({ timeout: 15_000 });
  await page.reload();
  await page.getByText('Secure conversation is locked.', { exact: false }).waitFor({ timeout: 15_000 });
  await unlock();
  const windowClosed = page.waitForEvent('close', { timeout: 15_000 });
  await app.evaluate(({ BrowserWindow }) => { setImmediate(() => BrowserWindow.getAllWindows()[0]?.close()); });
  await windowClosed;
  await assertLocked();
  await app.close().catch(() => {});
  app = undefined;

  await launchApp();
  await unlock();
  const closed = app.waitForEvent('close', { timeout: 15_000 });
  await app.evaluate(({ app }) => { setImmediate(() => app.quit()); });
  await closed;
  app = undefined;
  await assertLocked();
  console.log('Secure desktop native unlock, relock on reload, confirmed lock on window close and app exit passed.');
} finally {
  if (app) {
    const closed = app.waitForEvent('close', { timeout: 10_000 });
    await app.evaluate(({ app }) => { setImmediate(() => app.quit()); }).catch(() => {});
    await closed.catch(() => {});
  }
  if (broker) await broker.close();
  const directory = resolveSupervisedDirectory(runtime);
  for (const session of await listSupervisedSessions(directory, undefined, { includeGeneration: true })) {
    await stopSupervisedSession(session.id, directory, session.generation);
  }
  rmSync(root, { recursive: true, force: true, maxRetries: 10 });
}
