/**
 * Desktop smoke test — only what the Electron shell itself owns. The GUI's user scenarios run in a plain
 * browser in packages/agent-gui-web (`test:e2e`).
 *
 * Launches the REAL built app (Playwright `_electron`) with the deterministic scripted sidecar as its
 * configured CLI fixture, and checks: the shell starts the workspace daemon and the page connects with its token (TC-01);
 * a turn round-trips (TC-01); closing the window leaves the daemon running, and the next launch reattaches
 * to that same daemon and its conversation (#3189); a daemon that stops while the window is open leaves the
 * window saying so, and Reconnect starts a new daemon and attaches to it (or, when the new start fails,
 * shows the CLI's reason); a daemon that cannot start reaches the fatal screen with the CLI's reason
 * instead of hanging, and its Try again button reuses the same restart flow to connect once the cause is
 * gone (#3282 §3); and in a folder not trusted yet the window asks first, and starts the daemon
 * Restricted or after the grant, as answered (#3268).
 *
 * Run: `pnpm --filter @robota-sdk/agent-app test:e2e` (wraps this in `xvfb-run`; on macOS run it with node).
 */

import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import electronPath from 'electron';
import { _electron as electron } from 'playwright';

import { buildProductTestEnvironment, readDesktopTestIdentity } from './product-fixture.mjs';


/** One line of output (scripts write to the streams directly). */
const line = (text) => `${text}\n`;

const here = dirname(fileURLToPath(import.meta.url));
const mainJs = join(here, '..', 'dist', 'electron', 'main.js');
const sidecar = join(here, '..', '..', '..', 'packages', 'agent-gui-web', 'e2e', 'scripted-sidecar.mjs');
chmodSync(sidecar, 0o755); // spawnable via its shebang

const stateDir = mkdtempSync(join(tmpdir(), 'agent-app-e2e-'));
const statePath = join(stateDir, 'daemon.json');

let failures = 0;
const check = (label, ok) => {
  process.stdout.write(line(`${ok ? '✓' : '✗'} ${label}`));
  if (!ok) failures += 1;
};

const failFile = join(stateDir, 'fail-next-start');
const home = join(stateDir, 'home');
const productFixture = buildProductTestEnvironment(
  join(stateDir, 'product'),
  readDesktopTestIdentity(dirname(mainJs)),
);
const inheritedRuntimeEnvironment = Object.fromEntries(
  ['PATH', 'DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'SystemRoot', 'APPDATA', 'TMPDIR', 'TEMP', 'LANG']
    .filter((key) => typeof process.env[key] === 'string')
    .map((key) => [key, process.env[key]]),
);

/** Stop the attached daemon through its fixture control file, then wait for the window to say so. */
const stopDaemonAndAwaitReconnect = async (page) => {
  const pid = readDaemonPid();
  process.kill(pid, 'SIGTERM');
  // The page retries before it gives up on the daemon, so the stopped screen takes a while.
  const reconnect = page.getByRole('alert').getByRole('button', { name: 'Reconnect' });
  await reconnect.waitFor({ timeout: 60_000 });
  return { pid, reconnect };
};

const readDaemon = () => (existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : undefined);
const readDaemonPid = () => readDaemon()?.pid;
const trustFile = join(stateDir, 'trust');

const isAlive = (pid) => {
  if (!Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const launch = async (extraEnv = {}, { cwd } = {}) => {
  const application = await electron.launch({
    executablePath: electronPath,
    ...(cwd === undefined ? {} : { cwd }),
    args: ['--no-sandbox', '--disable-gpu', mainJs],
    // The shell runs the deterministic CLI fixture; state and trust are isolated to this test.
    env: {
      ...inheritedRuntimeEnvironment,
      HOME: home,
      USERPROFILE: home,
      ...productFixture.environment,
      PRODUCT_GUI_SIDECAR_CMD: sidecar,
      PRODUCT_E2E_DAEMON_STATE: statePath,
      ...extraEnv,
    },
  });
  // A detached daemon can retain Electron's output pipes after the window's process exits.
  // Playwright waits for those pipes to close; only the shell process owns this launch's lifetime.
  const shell = application.process();
  shell.once('exit', () => {
    for (const stream of shell.stdio) stream?.destroy();
  });
  return application;
};

async function closeApplication(application) {
  const closed = application.waitForEvent('close', { timeout: 10_000 });
  // Return the debugger reply before quitting; the detached daemon may retain its socket too.
  await application.evaluate(({ app }) => { setImmediate(() => app.quit()); });
  await closed;
}

const connected = (page) =>
  page.locator('.agent-gui-status[data-status="connected"]').waitFor({ timeout: 20_000 });

let firstPid;
try {
  const app = await launch();
  try {
    const page = await app.firstWindow();
    await connected(page);
    firstPid = readDaemonPid();
    check('TC-01: the window connects to the token-gated daemon it started', isAlive(firstPid));
    await page.getByLabel('message').fill('hi there');
    await page.getByLabel('message').press('Enter');
    await page.getByText('Hello from the scripted agent.').waitFor({ timeout: 10_000 });
    check('TC-01: a turn round-trips through the desktop shell', true);

    // #3282 §4a: the App menu's "Settings…" (id `open-settings`, ⌘,/Ctrl+,) — clicked through the
    // main process rather than a synthetic key event, the reliable path in headless/CI Linux.
    await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()?.getMenuItemById('open-settings')?.click(),
    );
    await page.getByRole('dialog', { name: 'Settings' }).waitFor({ timeout: 10_000 });
    check('#3282 §4a: the Settings… menu item opens the Settings screen', true);
    await page.getByRole('button', { name: 'Close Settings' }).click();
    await page.getByRole('dialog', { name: 'Settings' }).waitFor({ state: 'detached' });

    // Setting an application menu at all replaces Electron's built-in one; confirm Edit's Copy role
    // is still there, so the composer keeps its normal cut/copy/paste shortcuts.
    const hasCopyRole = await app.evaluate(({ Menu }) => {
      const walk = (items) =>
        items.some((item) => item.role === 'copy' || (item.submenu && walk(item.submenu.items)));
      const menu = Menu.getApplicationMenu();
      return menu ? walk(menu.items) : false;
    });
    check('#3282 §4a: the Edit menu still offers Copy (composer shortcuts keep working)', hasCopyRole);
  } catch (err) {
    check(`first launch threw: ${err?.message ?? err}`, false);
  } finally {
    await closeApplication(app);
  }
  check('#3189: closing the window leaves the daemon running', isAlive(firstPid));

  const again = await launch();
  try {
    const page = await again.firstWindow();
    await connected(page);
    check('#3189: the next launch reattaches to the same daemon', readDaemonPid() === firstPid);
    await page.getByText('Hello from the scripted agent.').waitFor({ timeout: 10_000 });
    check('#3189: the conversation from the first launch is still there', true);
  } catch (err) {
    check(`second launch threw: ${err?.message ?? err}`, false);
  } finally {
    await closeApplication(again);
  }

  const stopped = await launch();
  try {
    const page = await stopped.firstWindow();
    await connected(page);
    const { pid: stoppedPid, reconnect } = await stopDaemonAndAwaitReconnect(page);
    check('#3189: a daemon that stops while the window is open leaves the window saying so', !isAlive(stoppedPid));
    await reconnect.click();
    await connected(page);
    const restartedPid = readDaemonPid();
    check(
      '#3189: Reconnect starts a new daemon and the window attaches to it',
      restartedPid !== stoppedPid && isAlive(restartedPid),
    );
  } catch (err) {
    check(`reconnect check threw: ${err?.message ?? err}`, false);
  } finally {
    await closeApplication(stopped);
  }

  const unrestartable = await launch({ PRODUCT_E2E_DAEMON_FAIL_FILE: failFile });
  try {
    const page = await unrestartable.firstWindow();
    await connected(page);
    const { reconnect } = await stopDaemonAndAwaitReconnect(page);
    writeFileSync(failFile, '');
    await reconnect.click();
    await page.getByRole('alert').getByText(new RegExp(`${productFixture.identity.identity.cliName} trust`)).waitFor({ timeout: 20_000 });
    check('#3189: a Reconnect whose start fails shows the CLI reason', true);
  } catch (err) {
    check(`failed-reconnect check threw: ${err?.message ?? err}`, false);
  } finally {
    await closeApplication(unrestartable);
    rmSync(failFile, { force: true });
  }

  // #3268: a folder not trusted yet. Nothing starts until the person answers.
  const stopRecordedDaemon = () => {
    const pid = readDaemonPid();
    if (isAlive(pid)) process.kill(pid, 'SIGTERM');
    rmSync(statePath, { force: true });
  };
  stopRecordedDaemon();
  const askedRestricted = await launch({
    PRODUCT_E2E_TRUST_FILE: trustFile,
    CUSTOM_PROVIDER_KEY: 'must-not-reach-restricted-daemon',
    PROVIDER_DESTINATION_URL: 'https://provider.example.test/api',
    HTTPS_PROXY: 'https://proxy.example.test:8443',
    AMBIENT_PRIVATE_SENTINEL: 'must-not-reach-cli',
  });
  try {
    const page = await askedRestricted.firstWindow();
    const dialog = page.getByRole('dialog', { name: 'Do you trust this folder?' });
    await dialog.waitFor({ timeout: 20_000 });
    check('#3268: an untrusted folder asks first, and nothing has started', readDaemon() === undefined);
    await dialog.getByRole('button', { name: 'Start Restricted' }).click();
    await connected(page);
    check('#3268: Start Restricted starts the daemon Restricted and connects', readDaemon()?.restricted === true);
    check(
      '#3268: Restricted daemon receives no provider or transport environment references',
      JSON.stringify(readDaemon()?.providerEnvironment) === '{}',
    );
    check('#3268: Start Restricted leaves the folder untrusted', !existsSync(trustFile));
    const { reconnect } = await stopDaemonAndAwaitReconnect(page);
    await reconnect.click();
    await connected(page);
    check('#3268: Reconnect after Start Restricted starts the daemon Restricted again', readDaemon()?.restricted === true);
  } catch (err) {
    check(`restricted-answer check threw: ${err?.message ?? err}`, false);
  } finally {
    await closeApplication(askedRestricted);
  }

  stopRecordedDaemon();
  const askedTrust = await launch({
    PRODUCT_E2E_TRUST_FILE: trustFile,
    CUSTOM_PROVIDER_KEY: 'synthetic-provider-reference',
    PROVIDER_DESTINATION_URL: 'https://provider.example.test/api',
    HTTPS_PROXY: 'https://proxy.example.test:8443',
    AMBIENT_PRIVATE_SENTINEL: 'must-not-reach-cli',
  });
  try {
    const page = await askedTrust.firstWindow();
    const dialog = page.getByRole('dialog', { name: 'Do you trust this folder?' });
    await dialog.waitFor({ timeout: 20_000 });
    await dialog.getByRole('button', { name: 'Trust folder' }).click();
    await connected(page);
    check(
      '#3268: Trust folder records the grant, then starts the daemon with the project configuration',
      readFileSync(trustFile, 'utf8') === 'trusted' && readDaemon()?.restricted === false,
    );
    check(
      '#3268: daemon receives trusted named provider/destination/proxy refs and excludes unrelated ambient secrets',
      JSON.stringify(readDaemon()?.providerEnvironment) === JSON.stringify({
        customProviderKey: 'synthetic-provider-reference',
        destination: 'https://provider.example.test/api',
        proxy: 'https://proxy.example.test:8443',
      }),
    );
    const { pid, reconnect } = await stopDaemonAndAwaitReconnect(page);
    rmSync(trustFile, { force: true });
    rmSync(statePath, { force: true });
    await reconnect.click();
    await page.getByRole('dialog', { name: 'Do you trust this folder?' }).waitFor({ timeout: 20_000 });
    check(
      '#3268: reconnect refreshes trust before reusing provider refs and asks again after revocation',
      !isAlive(pid) && !existsSync(statePath),
    );
  } catch (err) {
    check(`trust-answer check threw: ${err?.message ?? err}`, false);
  } finally {
    await closeApplication(askedTrust);
  }

  // #3282 §4d: the composer's attach button through the REAL Electron bridge — preload -> IPC ->
  // `dialog.showOpenDialog` -> `fs.statSync`. Stubs only the dialog (via `evaluate`, in the main
  // process); everything downstream of the picked path is the real preload/main/gui-host/Composer
  // code. A fresh daemon reports a real temp directory as its workspace so the picked file resolves
  // as "inside the workspace" the same way a real project would.
  stopRecordedDaemon();
  const attachDir = mkdtempSync(join(tmpdir(), 'agent-app-e2e-attach-'));
  const attachFilePath = join(attachDir, 'notes.txt');
  writeFileSync(attachFilePath, 'scripted attachment contents');
  const attach = await launch({ PRODUCT_E2E_WORKSPACE_CWD: attachDir });
  try {
    const page = await attach.firstWindow();
    await connected(page);
    await attach.evaluate(({ dialog: electronDialog }, filePath) => {
      electronDialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
    }, attachFilePath);
    await page.getByRole('button', { name: 'Attach files' }).click();
    await page
      .getByRole('list', { name: 'attachments' })
      .getByText('notes.txt')
      .waitFor({ timeout: 10_000 });
    check('#3282 §4d: the attach button opens the native dialog and adds a chip for the picked file', true);
  } catch (err) {
    check(`attach check threw: ${err?.message ?? err}`, false);
  } finally {
    await closeApplication(attach);
    rmSync(attachDir, { recursive: true, force: true });
  }

  // #3354: the app works on the folder the person chose, not the one its process was started in. The
  // shell starts in an unrelated folder; File → Open Folder… (the native dialog stubbed in the main
  // process) switches to the project, whose own daemon the window then attaches to, while the first
  // folder's daemon keeps running.
  stopRecordedDaemon();
  const launchedIn = realpathSync(mkdtempSync(join(tmpdir(), 'agent-app-e2e-launched-')));
  const chosenProject = realpathSync(mkdtempSync(join(tmpdir(), 'agent-app-e2e-project-')));
  const folders = await launch({}, { cwd: launchedIn });
  let launchedPid;
  try {
    const page = await folders.firstWindow();
    await connected(page);
    launchedPid = readDaemonPid();
    check('#3354: a dev launch serves the folder it started in', readDaemon()?.workspace === launchedIn);
    await folders.evaluate(({ dialog: electronDialog }, folder) => {
      electronDialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, chosenProject);
    await folders.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('open-folder')?.click());
    await page.waitForEvent('load', { timeout: 20_000 });
    await connected(page);
    check('#3354: Open Folder… starts the chosen folder\'s daemon and attaches to it', readDaemon()?.workspace === chosenProject);
    check('#3354: the first folder\'s daemon keeps running after the switch', launchedPid !== readDaemonPid() && isAlive(launchedPid));
    const title = await folders.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle());
    check('#3354: the window title names the chosen folder', title?.startsWith(`${basename(chosenProject)} — `) === true);
    const recent = await folders.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()?.getMenuItemById('open-recent')?.submenu?.items.map((item) => item.label),
    );
    check('#3354: Open Recent lists the chosen folder first', recent?.[0] === chosenProject);

    if (process.platform === 'darwin') {
      // The app outlives its last window on macOS; the Dock's `activate` opens a new one on the same folder.
      await folders.evaluate(({ BrowserWindow }) => new Promise((resolve) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (!win) return resolve(undefined);
        win.once('closed', () => resolve(undefined));
        win.close();
      }));
      const windowsLeft = await folders.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
      check('#3354: closing the last window keeps the app running on macOS', windowsLeft === 0);
      const reopened = folders.waitForEvent('window', { timeout: 20_000 });
      await folders.evaluate(({ app }) => app.emit('activate'));
      const second = await reopened;
      await connected(second);
      check('#3354: clicking the Dock icon reopens a window attached to the open folder', readDaemon()?.workspace === chosenProject);
    }
  } catch (err) {
    check(`open-folder check threw: ${err?.message ?? err}`, false);
  } finally {
    await closeApplication(folders);
    if (isAlive(launchedPid)) process.kill(launchedPid, 'SIGTERM');
    rmSync(launchedIn, { recursive: true, force: true });
    rmSync(chosenProject, { recursive: true, force: true });
  }

  // #3354: switching folders drops every answer about the previous folder. Trust lives per folder here,
  // as the real CLI's grants do: A is untrusted (answered Restricted), B was trusted beforehand, and C
  // and D are untrusted. A trust click given while a switch is under way applies to no folder.
  stopRecordedDaemon();
  const trustDir = mkdtempSync(join(tmpdir(), 'agent-app-e2e-trust-'));
  const trustFor = (folder) => join(trustDir, createHash('sha256').update(folder).digest('hex'));
  const [folderA, folderB, folderC, folderD] = ['a', 'b', 'c', 'd'].map((name) =>
    realpathSync(mkdtempSync(join(tmpdir(), `agent-app-e2e-folder-${name}-`))),
  );
  writeFileSync(trustFor(folderB), 'trusted');
  const startedPids = [];
  const switching = await launch(
    {
      PRODUCT_E2E_TRUST_DIR: trustDir,
      CUSTOM_PROVIDER_KEY: 'synthetic-provider-reference',
      PROVIDER_DESTINATION_URL: 'https://provider.example.test/api',
      HTTPS_PROXY: 'https://proxy.example.test:8443',
      // Every trust read takes a moment, so the test can click while a folder switch waits on one.
      PRODUCT_E2E_TRUST_STATUS_DELAY_MS: '1500',
    },
    { cwd: folderA },
  );
  const chooseFolder = async (folder) => {
    await switching.evaluate(({ dialog: electronDialog }, picked) => {
      electronDialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] });
    }, folder);
    await switching.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('open-folder')?.click());
  };
  try {
    const page = await switching.firstWindow();
    const question = page.getByRole('dialog', { name: 'Do you trust this folder?' });
    await question.waitFor({ timeout: 20_000 });
    await question.getByRole('button', { name: 'Start Restricted' }).click();
    await connected(page);
    startedPids.push(readDaemonPid());
    check('#3354: folder A starts Restricted as answered', readDaemon()?.workspace === folderA && readDaemon()?.restricted === true);

    let loaded = page.waitForEvent('load', { timeout: 20_000 });
    await chooseFolder(folderB);
    await loaded;
    await connected(page);
    startedPids.push(readDaemonPid());
    check(
      '#3354: a trusted folder opened after a Restricted one starts unrestricted, with its own provider references',
      readDaemon()?.workspace === folderB &&
        readDaemon()?.restricted === false &&
        readDaemon()?.providerEnvironment?.customProviderKey === 'synthetic-provider-reference',
    );

    loaded = page.waitForEvent('load', { timeout: 20_000 });
    await chooseFolder(folderC);
    await loaded;
    await question.waitFor({ timeout: 20_000 });
    check(
      '#3354: an untrusted folder opened after a trusted one is asked about, by name, before anything starts',
      (await question.textContent())?.includes(folderC) === true && readDaemon()?.workspace === folderB,
    );

    // Switch to D, then click Trust on C's question while the switch waits on D's trust read: the
    // answer was about C, which is being left, so it applies to neither C nor D (whose question was
    // not shown yet).
    loaded = page.waitForEvent('load', { timeout: 20_000 });
    await chooseFolder(folderD);
    await question.getByRole('button', { name: 'Trust folder' }).click();
    await loaded;
    await question.waitFor({ timeout: 20_000 });
    await page.waitForFunction((folder) => document.body.textContent?.includes(folder), folderD, { timeout: 20_000 });
    check(
      '#3354: a trust answer given during a folder switch is not applied to either folder',
      !existsSync(trustFor(folderC)) && !existsSync(trustFor(folderD)) && readDaemon()?.workspace === folderB,
    );
  } catch (err) {
    check(`folder-switch trust check threw: ${err?.message ?? err}`, false);
  } finally {
    await closeApplication(switching);
    for (const pid of startedPids) if (isAlive(pid)) process.kill(pid, 'SIGTERM');
    rmSync(statePath, { force: true });
    for (const folder of [trustDir, folderA, folderB, folderC, folderD]) rmSync(folder, { recursive: true, force: true });
  }

  const refused = await launch({ PRODUCT_E2E_DAEMON_FAIL: '1' });
  try {
    const page = await refused.firstWindow();
    await page.getByRole('alert').getByText(new RegExp(`${productFixture.identity.identity.cliName} trust`)).waitFor({ timeout: 20_000 });
    check('#3189: a daemon that cannot start reaches the fatal screen with the CLI reason', true);
  } catch (err) {
    check(`fatal-state check threw: ${err?.message ?? err}`, false);
  } finally {
    await closeApplication(refused);
  }

  // #3282 §3: the fatal screen's Try again reuses the same restart flow as Reconnect — it must connect
  // once whatever stopped the very first start is gone, not just redraw the same failure.
  stopRecordedDaemon();
  writeFileSync(failFile, '');
  const neverStarted = await launch({ PRODUCT_E2E_DAEMON_FAIL_FILE: failFile });
  try {
    const page = await neverStarted.firstWindow();
    await page.getByRole('alert').getByText(new RegExp(`${productFixture.identity.identity.cliName} trust`)).waitFor({ timeout: 20_000 });
    const tryAgain = page.getByRole('alert').getByRole('button', { name: 'Try again' });
    await tryAgain.waitFor();
    rmSync(failFile, { force: true });
    await tryAgain.click();
    await connected(page);
    check('#3282 §3: Try again on the fatal screen retries and connects once the cause is gone', isAlive(readDaemonPid()));
  } catch (err) {
    check(`fatal try-again check threw: ${err?.message ?? err}`, false);
  } finally {
    await closeApplication(neverStarted);
    rmSync(failFile, { force: true });
  }
} finally {
  const pid = readDaemonPid();
  if (isAlive(pid)) process.kill(pid, 'SIGTERM');
  rmSync(stateDir, { recursive: true, force: true });
}

process.stdout.write(line(failures === 0 ? '\nE2E PASSED' : `\nE2E FAILED (${failures})`));
process.exit(failures === 0 ? 0 : 1);
