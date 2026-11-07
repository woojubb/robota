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
import { requestWorkspaceRootBroker, startWorkspaceRootBroker } from '../../../packages/agent-cli/src/startup/workspace-root-broker.ts';
import { listSupervisedSessions, resolveSupervisedDirectory, stopSupervisedSession } from '../../../packages/agent-cli/src/session-inventory/supervised-session-control.ts';
import { serializeKeyring } from '@robota-sdk/agent-keyring';
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
  writeFileSync(runtime.layout.userPaths.keyring, serializeKeyring((await fixtureKeyring()).keyring), { mode: 0o600 });
  writeProductConversationMode(runtime.layout.userRoot, 'plain', 'secure');
  mkdirSync(brokerDirectory, { recursive: true, mode: 0o700 });
  broker = await startWorkspaceRootBroker(brokerEndpoint, brokerDirectory, runtime.layout.userPaths.workspaceTrust);
  const prepared = await requestWorkspaceRootBroker(brokerEndpoint, { op: 'prepare', root: workspace });
  if (prepared.status !== 'prepared') throw new Error('The test folder could not be prepared.');
  const approved = await requestWorkspaceRootBroker(brokerEndpoint, { op: 'approve', root: workspace, candidate: prepared.candidate });
  if (approved.status !== 'trusted') throw new Error(`The test folder could not be approved: ${approved.status}, ${'reason' in approved ? approved.reason : 'no reason'}.`);

  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  const entry = join(repository, 'packages/agent-cli/src/testing/secure-runtime-entry.ts');
  const tsx = createRequire(import.meta.url).resolve('tsx');
  const sidecar = join(root, 'source-sidecar');
  writeFileSync(sidecar, `#!/bin/sh\nexec ${quote(process.execPath)} --disable-sigusr1 --import ${quote(pathToFileURL(tsx).href)} --conditions=source ${quote(entry)} "$@"\n`, { mode: 0o700 });
  chmodSync(sidecar, 0o700);

  let page;
  const launchApp = async () => {
    app = await electron.launch({
      executablePath: electronPath,
      args: ['--no-sandbox', '--disable-gpu', main], cwd: workspace,
      env: { ...inherited, HOME: home, USERPROFILE: home, ...fixture.environment, PRODUCT_GUI_SIDECAR_CMD: sidecar },
    });
    page = await app.firstWindow();
    await page.getByText('Secure conversation is locked.', { exact: false }).waitFor({ timeout: 15_000 });
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
