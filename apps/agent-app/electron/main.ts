/**
 * GUI-002 — Electron main process (Node). Thin shell: ask the configured CLI to start this workspace's daemon
 * (or reuse the live one), load the GUI web app (agent-gui-web) in a hardened BrowserWindow, and hand the
 * page the daemon's loopback address. The daemon belongs to the CLI and outlives the window. NO session/
 * command/permission logic lives here — all of that is in the daemon, reached over the loopback WS.
 */

import { spawn } from 'node:child_process';
import {
  DesktopRemoteRuntime,
  loadDesktopRemoteConfig,
  REMOTE_RUNTIME_FAILURE,
} from './remote-runtime.js';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  session,
  shell,
  type MenuItemConstructorOptions,
  type WebContents,
} from 'electron';

import {
  appendOutputTail,
  buildContentSecurityPolicy,
  buildDaemonStartSpawn,
  buildPickedFiles,
  chooseInitialWorkspace,
  createDaemonAttachment,
  describeDaemonStartFailure,
  isTrustChoice,
  parseDaemonStartOutput,
  parseRecentFolders,
  parseTrustStatusOutput,
  parseTrustedProviderEnvironmentReferences,
  rememberRecentFolder,
  resolveOpenPathTarget,
  resolveSidecarCommand,
  windowTitle,
  type IPickedFile,
  type ITrustQuestion,
  type TDaemonStart,
} from './sidecar.js';
import {
  desktopCliEnvironment,
  desktopHostEnvironment,
  desktopDaemonEnvironment,
  desktopIdentityPath,
  desktopUserDataPath,
  loadDesktopProductConfigSelection,
  resolveDesktopIdentity,
} from './product-config.js';

const productIdentityFile = desktopIdentityPath(__dirname);
const ambientEnvironment = Object.freeze({ ...process.env });
let remoteRuntime: DesktopRemoteRuntime | undefined;
const productSelection = loadDesktopProductConfigSelection({
  environment: ambientEnvironment,
  identityFile: productIdentityFile,
  isPackaged: app.isPackaged,
});
const productConfig = productSelection.config;
const hostEnvironment = desktopHostEnvironment(productConfig, ambientEnvironment);
const remoteMode = hostEnvironment.PRODUCT_DESKTOP_REMOTE_CONNECTION_CONFIG !== undefined;
let admittedProviderEnvironmentReferences: readonly string[] = [];
const allowScriptedE2eVariables =
  !app.isPackaged &&
  hostEnvironment.PRODUCT_GUI_SIDECAR_CMD?.endsWith(join('e2e', 'scripted-sidecar.mjs')) === true;
const trustEnvironment = desktopCliEnvironment(productConfig, hostEnvironment, {
  allowScriptedE2eVariables,
});
const productIdentity = resolveDesktopIdentity(productConfig, productIdentityFile);
app.setName(productConfig.identity.displayName);
const desktopUserData = desktopUserDataPath(productConfig);
mkdirSync(desktopUserData, { recursive: true, mode: 0o700 });
app.setPath('userData', desktopUserData);

/**
 * #3354: the folder this window works on. Every CLI run — trust status, the grant, the daemon start —
 * happens in it, so the daemon serves the folder the person chose, not wherever the app was launched.
 * Unset only until the first window picks one.
 */
let workspaceFolder: string | undefined;
const recentFoldersFile = join(desktopUserData, 'recent-folders.json');

function readRecentFolders(): string[] {
  try {
    return parseRecentFolders(readFileSync(recentFoldersFile, 'utf8'));
  } catch {
    // allow-fallback: no list yet (or an unreadable one) means no recent folders
    return [];
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    // allow-fallback: a recent folder that was removed or unmounted is skipped, not an error
    return false;
  }
}

// GUI-003: packaged → the configured bundled runtime; dev/e2e → explicit fixture override / configured PATH CLI.
const productCli = (): string =>
  resolveSidecarCommand({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    platform: process.platform,
    productIdentity,
    env: hostEnvironment,
  });

type TCliRun =
  | {
      readonly spawned: true;
      readonly exitCode: number | null;
      readonly stdout: string;
      readonly stderr: string;
    }
  | { readonly spawned: false; readonly detail: string };

/** Run the CLI in the open workspace folder with `env`, and read what it said. */
function runCli(
  command: string,
  args: readonly string[],
  env: Readonly<Record<string, string>>,
): Promise<TCliRun> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(command, [...args], {
      env,
      ...(workspaceFolder === undefined ? {} : { cwd: workspaceFolder }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = appendOutputTail(stdout, chunk.toString('utf8'));
    });
    child.stderr.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk);
      stderr = appendOutputTail(stderr, chunk.toString('utf8'));
    });
    child.once('error', (error) => {
      resolve({ spawned: false, detail: `Could not run ${command}: ${error.message}` });
    });
    // `close` (not `exit`) fires after both output streams have drained.
    child.once('close', (exitCode) => resolve({ spawned: true, exitCode, stdout, stderr }));
  });
}

const cliEnv = (): Record<string, string> => buildDaemonStartSpawn('', trustEnvironment).env;

/**
 * A person chose to run this folder Restricted: every daemon start this window asks for says so, the
 * one after Reconnect included.
 */
let restricted = false;

/** Run the daemon start command and read its answer. */
async function startDaemon(): Promise<TDaemonStart> {
  if (remoteMode) {
    try {
      await remoteRuntime?.close();
      const config = loadDesktopRemoteConfig(
        hostEnvironment.PRODUCT_DESKTOP_REMOTE_CONNECTION_CONFIG!,
      );
      remoteRuntime = new DesktopRemoteRuntime(config, async (event) => {
        const printable = JSON.stringify(event)
          .replace(
            // eslint-disable-next-line no-control-regex -- Native approval text must not contain display controls.
            /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/gu,
            ' ',
          )
          .slice(0, 4000);
        const answer = await dialog.showMessageBox({
          type: 'question',
          message: 'Remote task requests permission',
          detail: `Connection: ${config.binding}\n${printable}`,
          buttons: ['Deny', 'Allow once'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        return answer.response === 1;
      });
      return { ok: true, endpoint: await remoteRuntime.start() };
    } catch {
      return { ok: false, detail: REMOTE_RUNTIME_FAILURE };
    }
  }
  const childEnvironment = desktopDaemonEnvironment(productConfig, hostEnvironment, {
    restricted,
    providerEnvironmentReferences: admittedProviderEnvironmentReferences,
    allowScriptedE2eVariables,
  });
  const invocation = buildDaemonStartSpawn(productCli(), childEnvironment, { restricted });
  const run = await runCli(invocation.command, invocation.args, invocation.env);
  if (!run.spawned) return { ok: false, detail: run.detail };
  const endpoint = run.exitCode === 0 ? parseDaemonStartOutput(run.stdout) : undefined;
  return endpoint
    ? { ok: true, endpoint }
    : { ok: false, detail: describeDaemonStartFailure(run, productConfig.identity.cliName) };
}

/**
 * The question to ask before a daemon starts, when the folder is not trusted and a grant could change
 * that. The CLI decides; when it cannot say, nothing is asked and the daemon start gives its reason.
 */
async function readTrustQuestion(): Promise<ITrustQuestion | undefined> {
  if (remoteMode) return undefined;
  const run = await runCli(productCli(), ['trust', 'status', '--json'], cliEnv());
  admittedProviderEnvironmentReferences =
    run.spawned && run.exitCode === 0
      ? (parseTrustedProviderEnvironmentReferences(run.stdout) ?? [])
      : [];
  return run.spawned && run.exitCode === 0 ? parseTrustStatusOutput(run.stdout) : undefined;
}

/** Asked and not answered yet: no daemon starts until the person answers (issue #3268). */
let pendingTrust: ITrustQuestion | undefined;

/**
 * #3354: everything that depends on the open folder — the first start, a folder switch, a reconnect and
 * a trust answer — runs one at a time. Otherwise a grant clicked while a switch is under way would land
 * on a folder whose question nobody saw, or a reconnect's trust read for the previous folder would leave
 * its question or provider references behind on the new one.
 */
let folderWork: Promise<unknown> = Promise.resolve();
function inFolderOrder<T>(work: () => Promise<T>): Promise<T> {
  const next = folderWork.then(work, work);
  folderWork = next.catch(() => undefined);
  return next;
}

/** The app's window, if one is open. On macOS the app and its menu outlive the last window. */
function liveWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows().find((win) => !win.isDestroyed());
}

/** Rebuild the menu (Open Recent changes) for the open window, if any. */
function refreshMenu(): void {
  const win = liveWindow();
  if (win) Menu.setApplicationMenu(buildMenu(win));
}

/**
 * Started once the app is ready, and again when the page asks to reconnect after the daemon stopped. The
 * endpoint IPC awaits the latest start, so the renderer never races it.
 */
const daemon = createDaemonAttachment(startDaemon);

/**
 * Inject a strict CSP pinning the renderer's only reachable socket to the current daemon's loopback port —
 * or to nothing, when there is no daemon and the page only shows why. The port is read per response, so a
 * reload after a restart picks up the new daemon's port.
 */
function installCsp(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [buildContentSecurityPolicy(daemon.port())],
      },
    });
  });
}

/** Deny all navigation + new-window: a redirected renderer must not carry the token/session to another origin. */
function lockNavigation(win: BrowserWindow): void {
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

/**
 * #3282 §4a: "Settings…" — id `open-settings` so `apps/agent-app/e2e/run-e2e.mjs` can click it
 * directly (`Menu.getApplicationMenu()?.getMenuItemById('open-settings')?.click()`), the reliable
 * path in CI/headless Linux where a native accelerator key event may not reach the app the same way.
 */
function openSettingsMenuItem(win: BrowserWindow): MenuItemConstructorOptions {
  return {
    id: 'open-settings',
    label: 'Settings…',
    accelerator: 'CmdOrCtrl+,',
    click: () => {
      if (!win.webContents.isDestroyed()) win.webContents.send('agent-gui:open-settings');
    },
  };
}

/** Run a menu action that opens a folder, reporting a failure rather than leaving it unhandled. */
function openFolderFromMenu(choose: () => Promise<string | undefined>): void {
  void choose()
    .then((folder) => (folder === undefined ? undefined : openFolder(folder)))
    .catch((error) => console.error('[agent-app] could not open the folder:', error));
}

/** File → Open Folder… (id `open-folder` so the e2e can click it through the main process). */
function openFolderMenuItem(): MenuItemConstructorOptions {
  return {
    id: 'open-folder',
    label: 'Open Folder…',
    accelerator: 'CmdOrCtrl+O',
    click: () => openFolderFromMenu(() => pickFolder(liveWindow())),
  };
}

/** File → Open Recent: the folders opened before, most recent first, and a way to forget them. */
function openRecentMenuItem(): MenuItemConstructorOptions {
  const recent = readRecentFolders();
  return {
    id: 'open-recent',
    label: 'Open Recent',
    submenu: [
      ...recent.map((folder) => ({ label: folder, click: () => openFolderFromMenu(async () => folder) })),
      ...(recent.length > 0 ? [{ type: 'separator' } as const] : []),
      {
        label: 'Clear Recently Opened',
        enabled: recent.length > 0,
        click: () => {
          writeRecentFolders([]);
          refreshMenu();
        },
      },
    ],
  };
}

/** The File menu's folder items; a remote task has no local folder to open. */
function folderMenuItems(): MenuItemConstructorOptions[] {
  return remoteMode ? [] : [openFolderMenuItem(), openRecentMenuItem()];
}

/**
 * A complete standard application menu — setting one at all REPLACES Electron's own default, so this
 * covers every role a person expects (Edit's cut/copy/paste keeps the composer's normal shortcuts
 * working), not only the Settings item #3282 §4a adds.
 */
function buildMenu(win: BrowserWindow): Menu {
  const isMac = process.platform === 'darwin';
  const editSubmenu: MenuItemConstructorOptions[] = [
    ...(isMac ? [] : [openSettingsMenuItem(win), { type: 'separator' } as const]),
    { role: 'undo' },
    { role: 'redo' },
    { type: 'separator' },
    { role: 'cut' },
    { role: 'copy' },
    { role: 'paste' },
    { role: 'selectAll' },
  ];
  const viewSubmenu: MenuItemConstructorOptions[] = [
    { role: 'resetZoom' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
    { type: 'separator' },
    { role: 'togglefullscreen' },
    // Dev tools stay out of a packaged build's menu — nothing here toggles a debugging surface a
    // shipped app should not offer.
    ...(app.isPackaged
      ? []
      : [{ type: 'separator' } as const, { role: 'toggleDevTools' } as const]),
  ];
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              openSettingsMenuItem(win),
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          } satisfies MenuItemConstructorOptions,
          ...(remoteMode
            ? []
            : [{ label: 'File', submenu: folderMenuItems() } satisfies MenuItemConstructorOptions]),
        ]
      : [
          {
            label: '&File',
            submenu: [
              ...folderMenuItems(),
              ...(remoteMode ? [] : [{ type: 'separator' } as const]),
              { role: 'quit' },
            ],
          } satisfies MenuItemConstructorOptions,
        ]),
    { label: isMac ? 'Edit' : '&Edit', submenu: editSubmenu },
    { label: isMac ? 'View' : '&View', submenu: viewSubmenu },
    { role: 'windowMenu' },
  ];
  return Menu.buildFromTemplate(template);
}

/** Ask for a folder with the native dialog, modal to `win` when there is one. Cancel answers `undefined`. */
async function pickFolder(win?: BrowserWindow): Promise<string | undefined> {
  const options = {
    title: 'Open Folder',
    buttonLabel: 'Open',
    properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>,
  };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  return result.canceled ? undefined : result.filePaths[0];
}

function writeRecentFolders(folders: readonly string[]): void {
  try {
    writeFileSync(recentFoldersFile, JSON.stringify(folders), { mode: 0o600 });
  } catch (error) {
    // allow-fallback: an unwritable recent list must not stop the folder from opening
    console.error('[agent-app] could not save the recent folders:', error);
  }
}

/** Make `folder` the open one: remembered first in Open Recent, and named in the window title. */
function useFolder(folder: string): void {
  workspaceFolder = folder;
  writeRecentFolders(rememberRecentFolder(readRecentFolders(), folder));
  const win = liveWindow();
  win?.setTitle(windowTitle(app.name, folder));
  refreshMenu();
}

/**
 * Switch to another folder (#3354). The first folder's daemon keeps running — daemons are per folder —
 * and the window attaches to the chosen folder's daemon, starting it when none is live. Every answer
 * about the previous folder (its trust question, a Restricted choice, its admitted provider references)
 * is dropped first, so the new folder is asked about afresh. With no window open (macOS), a new window
 * opens on the chosen folder.
 */
async function openFolder(folder: string): Promise<void> {
  if (remoteMode) return;
  const openWindow = await inFolderOrder(async () => {
    if (folder === workspaceFolder) return false;
    if (!isDirectory(folder)) {
      writeRecentFolders(readRecentFolders().filter((recent) => recent !== folder));
      refreshMenu();
      const message = { type: 'warning' as const, message: 'That folder no longer exists.', detail: folder };
      const win = liveWindow();
      await (win ? dialog.showMessageBox(win, message) : dialog.showMessageBox(message));
      return false;
    }
    pendingTrust = undefined;
    restricted = false;
    admittedProviderEnvironmentReferences = [];
    // A start still running belongs to the previous folder; let it settle before asking for this one.
    await daemon.current()?.catch(() => undefined);
    useFolder(folder);
    const win = liveWindow();
    if (!win) return true;
    pendingTrust = await readTrustQuestion();
    if (pendingTrust === undefined) await daemon.start();
    if (!win.isDestroyed()) win.webContents.reload();
    return false;
  });
  if (openWindow) await createWindow();
}

async function createWindow(): Promise<void> {
  if (!remoteMode && workspaceFolder === undefined) {
    const initial =
      chooseInitialWorkspace({
        isPackaged: app.isPackaged,
        launchCwd: process.cwd(),
        recentFolders: readRecentFolders(),
        isDirectory,
      }) ?? (await pickFolder());
    // Nothing to work on: the person closed the folder dialog, so there is nothing to show either.
    if (initial === undefined) {
      app.quit();
      return;
    }
    useFolder(initial);
  }

  // In a folder not trusted yet the daemon would be refused; the person in front is asked first.
  const started = inFolderOrder(() =>
    readTrustQuestion().then((question) => {
      pendingTrust = question;
      return question === undefined ? daemon.start() : undefined;
    }),
  );

  const win = new BrowserWindow({
    width: 1100,
    height: 780,
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  lockNavigation(win);
  Menu.setApplicationMenu(buildMenu(win));
  // The title names the open folder; the page's own <title> must not replace it.
  win.on('page-title-updated', (event) => event.preventDefault());
  win.setTitle(windowTitle(app.name, remoteMode ? undefined : workspaceFolder));
  win.once('ready-to-show', () => win.show());

  // The CSP is fixed when the page loads, so the page loads once the daemon's port is known. A failed
  // start still loads the page: it shows the fatal screen with the CLI's reason. A pending trust
  // question loads it with no socket reachable; the answer reloads it.
  await started;
  installCsp();
  await win.loadFile(join(__dirname, '../renderer/index.html'));
}

/**
 * The renderer asks (via preload) for its endpoint once, after the DOM is ready and after it has
 * subscribed to state. A failed start answers `null` and reports `fatal` with the reason to that page.
 */
ipcMain.on('agent-gui:runtime-mode', (event) => {
  event.returnValue = remoteMode ? 'remote' : 'local';
});

ipcMain.handle('agent-gui:endpoint', async (event): Promise<string | null> => {
  if (pendingTrust !== undefined) return null;
  const current = daemon.current();
  const started = current ? await current : null;
  if (started?.ok) return started.endpoint.url;
  reportFatal(event.sender, started?.detail);
  return null;
});

/**
 * The page lost its daemon for good (stopped or crashed) and the owner asked to reconnect: ask the CLI
 * again — it starts a daemon or reuses a live one — then reload the page, so the CSP and the endpoint it
 * asks for are the new daemon's. A start that fails reloads too, into the fatal screen with the reason.
 */
ipcMain.handle('agent-gui:restart', (event): Promise<void> =>
  inFolderOrder(async () => {
    // Nothing starts before the trust question is answered.
    if (pendingTrust !== undefined) return;
    if (restricted) {
      admittedProviderEnvironmentReferences = [];
    } else {
      pendingTrust = await readTrustQuestion();
    }
    if (pendingTrust === undefined) await daemon.start();
    if (!event.sender.isDestroyed()) event.sender.reload();
  }),
);

/** The question the page shows before anything starts, or `null` when there is none. */
ipcMain.handle('agent-gui:trust-question', (): ITrustQuestion | null => pendingTrust ?? null);

/**
 * The composer's attach button (#3282 §4d): a native multi-file dialog, scoped to this window so it
 * is modal to it rather than the whole app. Cancelling answers an empty list, same as picking nothing.
 */
ipcMain.handle('agent-gui:pick-files', async (event): Promise<IPickedFile[]> => {
  if (remoteMode) return [];
  const win = BrowserWindow.fromWebContents(event.sender);
  const properties: Array<'openFile' | 'multiSelections'> = ['openFile', 'multiSelections'];
  const result = win
    ? await dialog.showOpenDialog(win, { properties })
    : await dialog.showOpenDialog({ properties });
  if (result.canceled) return [];
  return buildPickedFiles(result.filePaths, (path) => {
    try {
      return statSync(path).size;
    } catch {
      // Removed or unreadable between the dialog closing and this running — drop it, not a crash.
      return undefined;
    }
  });
});

/**
 * The Project panel's Memory "Open in editor" (#3282 §4c): opens a project-relative path — as the
 * local daemon itself reported it — in the OS default app for it. `resolveOpenPathTarget` refuses a
 * path that resolves outside this workspace before anything is opened.
 */
ipcMain.handle(
  'agent-gui:open-path',
  async (_event, path: unknown): Promise<{ error?: string }> => {
    if (remoteMode) return { error: 'Remote task paths cannot open files on this computer.' };
    if (typeof path !== 'string') return { error: 'path must be a string' };
    if (workspaceFolder === undefined) return { error: 'No folder is open.' };
    const target = resolveOpenPathTarget(workspaceFolder, path);
    if (target === undefined) return { error: 'That path is outside the workspace.' };
    const error = await shell.openPath(target);
    return error ? { error } : {};
  },
);

/**
 * The person answered. Trust records the grant (a grant the CLI refuses keeps the question up, with
 * its reason); Restricted starts the daemon without the project's own configuration; quit closes the
 * app. Once a daemon is asked for, the page reloads to attach to it, as after Reconnect.
 */
ipcMain.handle(
  'agent-gui:trust-answer',
  async (event, choice: unknown): Promise<{ error?: string }> => {
    // The answer is about the question on screen when it was given; it applies to nothing else.
    const asked = pendingTrust;
    if (asked === undefined || !isTrustChoice(choice)) return {};
    if (choice === 'quit') {
      app.quit();
      return {};
    }
    return inFolderOrder(async () => {
      // A folder switch, or an earlier answer, since then has replaced that question: this one is stale.
      if (pendingTrust !== asked) return {};
      if (choice === 'trust') {
        const granted = await runCli(productCli(), ['trust', '--yes'], cliEnv());
        if (!granted.spawned) return { error: granted.detail };
        if (granted.exitCode !== 0) {
          return {
            error:
              granted.stderr.trim() ||
              granted.stdout.trim() ||
              `${productConfig.identity.cliName} trust --yes failed (exit ${granted.exitCode ?? 'signal'}).`,
          };
        }
      } else {
        restricted = true;
        admittedProviderEnvironmentReferences = [];
      }
      pendingTrust = undefined;
      // Trust grant has completed. Re-read the now-admitted settings projection before starting
      // the daemon so only explicitly referenced provider/transport variables cross the boundary.
      if (choice === 'trust') await readTrustQuestion();
      await daemon.start();
      if (!event.sender.isDestroyed()) event.sender.reload();
      return {};
    });
  },
);

function reportFatal(sender: WebContents, detail: string | undefined): void {
  if (!sender.isDestroyed()) sender.send('agent-gui:state', 'fatal', detail);
}

// INFRA-040: the rejection is ROUTED. `createWindow` starts the daemon and loads the renderer; if that
// fails the app has no window and, before this, no message either — the process just sat there. `.catch`
// after `.then`, not `.then(fn, onRejected)`, because the second argument handles a rejection of
// `whenReady()` alone and would let a `createWindow` failure float on unchanged.
app
  .whenReady()
  .then(createWindow)
  .catch((error) => {
    console.error('[agent-app] failed to create the main window:', error);
    app.quit();
  });

let closingRemote = false;
app.on('before-quit', (event) => {
  if (!remoteRuntime || closingRemote) return;
  event.preventDefault();
  closingRemote = true;
  void remoteRuntime.close().finally(() => app.quit());
});

// Closing the window leaves the daemon running: it is the workspace's, and the next launch reattaches.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// #3354: on macOS the app outlives its last window; clicking the Dock icon opens a new one on the same
// folder, which reattaches to that folder's live daemon.
app.on('activate', () => {
  if (!app.isReady() || BrowserWindow.getAllWindows().length > 0) return;
  createWindow().catch((error) => {
    console.error('[agent-app] failed to reopen the main window:', error);
  });
});

// Never open external URLs inside the app.
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
});
