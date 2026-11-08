/**
 * Electron main process (Node). Thin shell: ask the configured CLI to start this workspace's daemon
 * (or reuse the live one), load the GUI web app (agent-gui-web) in a hardened BrowserWindow, and hand the
 * page the daemon's loopback address in plain mode. Secure mode instead admits the native owner
 * through a session port and confirms runtime lock before the window or app closes.
 */

import { spawn } from 'node:child_process';
import {
  DesktopRemoteRuntime,
  loadDesktopRemoteConfig,
  REMOTE_RUNTIME_FAILURE,
} from './remote-runtime.js';
import { remotePermissionText } from './remote-permission-display.js';
import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  MessageChannelMain,
  Menu,
  powerMonitor,
  session,
  shell,
  type MenuItemConstructorOptions,
  type WebContents,
} from 'electron';
import { registerDesktopSessionAdmission } from './desktop-session-admission.js';
import { selectedFolderWithinTrustRoot } from './desktop-trust-root.js';
import { openSecretWindow } from './secret-window.js';

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
  parseTrustCandidate,
  parseTrustStatusOutput,
  parseTrustWorkspaceRoot,
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
import {
  refusedRemoteDebuggingSwitch,
  REMOTE_DEBUGGING_REFUSED_EXIT_CODE,
} from './launch-guard.js';

// Before any window, runtime or credential exists: Chromium opens a remote debugging endpoint only after this script
// has run, and `app.exit` before the app is ready ends the process on the spot.
const refusedSwitch = refusedRemoteDebuggingSwitch({
  isPackaged: app.isPackaged,
  argv: process.argv,
  hasSwitch: (name) => app.commandLine.hasSwitch(name),
});
if (refusedSwitch !== undefined) {
  console.error(
    `[agent-app] refusing to start: --${refusedSwitch} would let another program drive this app.`,
  );
  app.exit(REMOTE_DEBUGGING_REFUSED_EXIT_CODE);
}

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
let conversationMode: 'plain' | 'preparing' | 'secure' = 'plain';
let desktopAdmission: ReturnType<typeof registerDesktopSessionAdmission> | undefined;
let secureLockUnconfirmed = false;
let secureLockPending = false;
let secureDisposalPromise: Promise<void> | undefined;
let secureDisposalAdmission: ReturnType<typeof registerDesktopSessionAdmission> | undefined;
let secureTrustReady = false;
let securePowerEpoch = 0;
const secureDesktopSupported = process.platform === 'darwin';

async function disposeDesktopAdmission(reason?: 'explicit' | 'screen-lock' | 'suspend'): Promise<void> {
  if (secureDisposalPromise) {
    if (!reason || !secureDisposalAdmission) return secureDisposalPromise;
    return Promise.all([secureDisposalPromise, secureDisposalAdmission.revokeGlobal(reason)]).then(() => undefined);
  }
  const admission = desktopAdmission;
  if (!admission) return;
  desktopAdmission = undefined;
  secureDisposalAdmission = admission;
  secureLockPending = true;
  const pending = reason === undefined ? admission.dispose() : admission.revokeGlobal(reason);
  secureDisposalPromise = pending.finally(() => {
    secureDisposalPromise = undefined;
    secureDisposalAdmission = undefined;
    secureLockPending = false;
    refreshMenu();
  });
  return secureDisposalPromise;
}

async function readConversationMode(): Promise<typeof conversationMode> {
  if (remoteMode) return 'plain';
  const { desktopConversationMode } = await import('@robota-sdk/agent-cli/desktop-host');
  return desktopConversationMode(productConfig);
}
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
 * The folder this window works on. Every CLI run — trust status, the grant, the daemon start —
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

// Packaged → the configured bundled runtime; dev/e2e → explicit fixture override / configured PATH CLI.
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
let restrictedHold: string | undefined;
let restrictedHoldRoot: string | undefined;
let pendingTrustRestrictedOnly = false;

async function releaseRestrictedHold(): Promise<void> {
  const hold = restrictedHold;
  restrictedHold = undefined;
  restrictedHoldRoot = undefined;
  if (!hold) return;
  const { releaseDesktopRestrictedRoot } = await import('@robota-sdk/agent-cli/desktop-host');
  await releaseDesktopRestrictedRoot(productConfig, cliEnv(), hold);
}

/** Run the daemon start command and read its answer. */
async function startDaemon(): Promise<TDaemonStart> {
  if (!remoteMode && (await readConversationMode()) !== 'plain') {
    return {
      ok: false,
      detail: 'Secure conversations use native unlock; no WebSocket daemon endpoint is available.',
    };
  }
  if (remoteMode) {
    try {
      await remoteRuntime?.close();
      const config = loadDesktopRemoteConfig(
        hostEnvironment.PRODUCT_DESKTOP_REMOTE_CONNECTION_CONFIG!,
      );
      remoteRuntime = new DesktopRemoteRuntime(config, async (event) => {
        const printable = remotePermissionText(event);
        if (printable === undefined) return false;
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
  if (conversationMode === 'secure' && restrictedHold) {
    try {
      if (!restrictedHoldRoot || !workspaceFolder ||
          !selectedFolderWithinTrustRoot(workspaceFolder, restrictedHoldRoot)) {
        throw new Error('The selected Restricted folder changed.');
      }
      const { assertDesktopRestrictedRoot } = await import('@robota-sdk/agent-cli/desktop-host');
      await assertDesktopRestrictedRoot(productConfig, cliEnv(), restrictedHoldRoot, restrictedHold);
      restricted = true;
      secureTrustReady = true;
      admittedProviderEnvironmentReferences = [];
      return undefined;
    } catch { await releaseRestrictedHold().catch(() => {}); }
  }
  const run = await runCli(productCli(), ['trust', 'status', '--json'], cliEnv());
  admittedProviderEnvironmentReferences =
    run.spawned && run.exitCode === 0
      ? (parseTrustedProviderEnvironmentReferences(run.stdout) ?? [])
      : [];
  secureTrustReady = run.spawned && run.exitCode === 0 &&
    parseTrustedProviderEnvironmentReferences(run.stdout) !== undefined;
  pendingTrustCandidate =
    run.spawned && run.exitCode === 0 ? parseTrustCandidate(run.stdout) : undefined;
  pendingTrustRestrictedOnly = false;
  const question = run.spawned && run.exitCode === 0 ? parseTrustStatusOutput(run.stdout) : undefined;
  if (question || conversationMode !== 'secure' || secureTrustReady || !run.spawned ||
      run.exitCode !== 0 || !workspaceFolder) return question;
  const restrictedRoot = parseTrustWorkspaceRoot(run.stdout);
  if (!restrictedRoot || !selectedFolderWithinTrustRoot(workspaceFolder, restrictedRoot)) return undefined;
  const { prepareDesktopRestrictedRoot } = await import('@robota-sdk/agent-cli/desktop-host');
  const candidate = await prepareDesktopRestrictedRoot(productConfig, cliEnv(), restrictedRoot);
  if (!candidate) return undefined;
  pendingTrustCandidate = candidate;
  pendingTrustRestrictedOnly = true;
  return { folder: restrictedRoot, loads: [] };
}

/** Asked and not answered yet: no daemon starts until the person answers. */
let pendingTrust: ITrustQuestion | undefined;
let pendingTrustCandidate: string | undefined;

/** Only a native dialog in main may turn a secure folder decision into owner authority. */
async function resolveSecureWorkspaceTrust(win: BrowserWindow): Promise<boolean> {
  const asked = pendingTrust;
  const candidate = pendingTrustCandidate;
  const restrictedOnly = pendingTrustRestrictedOnly;
  const folder = workspaceFolder;
  const powerEpoch = securePowerEpoch;
  if (!asked || !folder || !selectedFolderWithinTrustRoot(folder, asked.folder) || !candidate) return false;
  const decisionCurrent = (): boolean => pendingTrust === asked && workspaceFolder === folder &&
    selectedFolderWithinTrustRoot(folder, asked.folder) && securePowerEpoch === powerEpoch &&
    conversationMode === 'secure' && !win.isDestroyed();
  const answer = await dialog.showMessageBox({
    type: 'question',
    message: 'Open this folder for a secure conversation?',
    detail: `${asked.folder}\n\nProject sources that Trust would load:\n${asked.loads.join('\n') || '(none)'}`,
    buttons: restrictedOnly ? ['Open Restricted', 'Quit'] : ['Trust Folder', 'Open Restricted', 'Quit'],
    defaultId: restrictedOnly ? 1 : 2,
    cancelId: restrictedOnly ? 1 : 2,
    noLink: true,
  });
  if (!decisionCurrent() || pendingTrustCandidate !== candidate ||
      pendingTrustRestrictedOnly !== restrictedOnly) return false;
  if (answer.response === (restrictedOnly ? 1 : 2)) {
    await releasePendingTrustCandidate();
    app.quit();
    return false;
  }
  if (answer.response === (restrictedOnly ? 0 : 1)) {
    const { retainDesktopRestrictedRoot } = await import('@robota-sdk/agent-cli/desktop-host');
    const hold = await retainDesktopRestrictedRoot(productConfig, cliEnv(), asked.folder, candidate);
    if (!hold) { await releasePendingTrustCandidate(); return false; }
    pendingTrustCandidate = undefined;
    if (!decisionCurrent()) {
      const { releaseDesktopRestrictedRoot } = await import('@robota-sdk/agent-cli/desktop-host');
      await releaseDesktopRestrictedRoot(productConfig, cliEnv(), hold);
      return false;
    }
    restrictedHold = hold;
    restrictedHoldRoot = asked.folder;
    restricted = true;
    admittedProviderEnvironmentReferences = [];
    secureTrustReady = true;
  } else if (!restrictedOnly && answer.response === 0) {
    const { approveDesktopTrustCandidate } = await import('@robota-sdk/agent-cli/desktop-host');
    if (!(await approveDesktopTrustCandidate(productConfig, cliEnv(), asked, candidate))) return false;
    pendingTrustCandidate = undefined;
    if (!decisionCurrent()) return false;
    await readTrustQuestion();
    if (!decisionCurrent()) { secureTrustReady = false; return false; }
    if (pendingTrust !== asked && pendingTrust !== undefined) return false;
    if (!secureTrustReady) return false;
  } else return false;
  pendingTrust = undefined;
  pendingTrustRestrictedOnly = false;
  return true;
}

async function releasePendingTrustCandidate(): Promise<void> {
  const candidate = pendingTrustCandidate;
  pendingTrustCandidate = undefined;
  if (candidate !== undefined) {
    await runCli(productCli(), ['trust', 'release', '--candidate', candidate], cliEnv());
  }
}

/**
 * Everything that depends on the open folder — the first start, a folder switch, a reconnect and
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
        'Content-Security-Policy': [
          buildContentSecurityPolicy(conversationMode === 'plain' ? daemon.port() : undefined),
        ],
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
 * "Settings…" — id `open-settings` so `apps/agent-app/e2e/run-e2e.mjs` can click it
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
      ...recent.map((folder) => ({
        label: folder,
        click: () => openFolderFromMenu(async () => folder),
      })),
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

function unlockSecureMenuItem(): MenuItemConstructorOptions {
  return {
    id: 'unlock-secure-conversation',
    label: 'Unlock Secure Conversation…',
    enabled: secureDesktopSupported && secureTrustReady && !secureLockUnconfirmed && !secureLockPending,
    click: () => {
      const admission = desktopAdmission;
      if (!admission) return;
      void admission.openFromNativeAction().then((result) => {
        if (result.kind === 'open' || result.kind === 'cancelled') return;
        const win = liveWindow();
        if (!win) return;
        void dialog.showMessageBox(win, {
          type: 'warning',
          message:
            result.kind === 'lock-unconfirmed'
              ? 'The secure runtime lock could not be confirmed. Restart the app before trying again.'
              : result.kind === 'busy'
                ? 'A secure conversation is already open.'
                : 'The secure conversation could not be unlocked. Check the passphrase and runtime, then try again.',
        });
      });
    },
  };
}

let secureReviewBusy = false;
function reviewSecureMenuItem(): MenuItemConstructorOptions {
  return {
    id: 'review-secure-stored-session',
    label: 'Review Imported Secure Conversation…',
    enabled: secureDesktopSupported && secureTrustReady && !secureLockUnconfirmed && !secureLockPending,
    click: () => {
      const win = liveWindow();
      const admission = desktopAdmission;
      if (!win || !admission || secureReviewBusy) return;
      secureReviewBusy = true;
      const powerEpoch = securePowerEpoch;
      const folder = workspaceFolder;
      const reviewCurrent = (): boolean => !win.isDestroyed() && desktopAdmission === admission &&
        admission.isCurrent() && securePowerEpoch === powerEpoch && workspaceFolder === folder;
      void (async () => {
        const ids = await admission.listUnverifiedFromNativeAction();
        if (!reviewCurrent()) return;
        if (ids.length === 0) {
          await dialog.showMessageBox(win, { type: 'info', message: 'There are no imported conversations awaiting review.' });
          return;
        }
        let page = 0;
        let selected: string | undefined;
        while (selected === undefined) {
          const visible = ids.slice(page * 4, page * 4 + 4);
          const more = (page + 1) * 4 < ids.length;
          const buttons = [
            ...visible.map((id, index) => `Conversation ${page * 4 + index + 1}: ${id.slice(0, 32)}`),
            ...(more ? ['Next'] : []),
            'Cancel',
          ];
          const choice = await dialog.showMessageBox(win, {
            type: 'question',
            message: 'Choose an imported conversation to review',
            detail: 'These records have not yet been accepted as yours. Their content will stay closed until you review one.',
            buttons,
            defaultId: buttons.length - 1,
            cancelId: buttons.length - 1,
            noLink: true,
          });
          if (!reviewCurrent()) return;
          if (choice.response < visible.length) selected = visible[choice.response];
          else if (more && choice.response === visible.length) page += 1;
          else return;
        }
        const question = await admission.questionFromNativeAction(selected);
        if (!reviewCurrent()) return;
        if (question.kind === 'refused') throw new Error(question.message);
        if (question.kind === 'open') {
          await dialog.showMessageBox(win, { type: 'info', message: 'This conversation is already verified.' });
          return;
        }
        const answer = await dialog.showMessageBox(win, {
          type: 'warning',
          message: question.question,
          detail: question.notice,
          buttons: ['Accept This Conversation', 'Cancel'],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        });
        if (!reviewCurrent()) return;
        if (answer.response !== 0) {
          await admission.cancelQuestionFromNativeAction();
          return;
        }
        await admission.acceptFromNativeAction(selected, question.digest, question.questionId);
        if (!reviewCurrent()) return;
        await dialog.showMessageBox(win, { type: 'info', message: 'The imported conversation was accepted.' });
      })().catch((error: unknown) => {
        if (!reviewCurrent()) return;
        void dialog.showMessageBox(win, {
          type: 'error',
          message: 'The imported conversation could not be reviewed.',
          detail: error instanceof Error ? error.message : undefined,
        });
      }).finally(() => { secureReviewBusy = false; });
    },
  };
}

/** The File menu's folder items; a remote task has no local folder to open. */
function folderMenuItems(): MenuItemConstructorOptions[] {
  return remoteMode
    ? []
    : [
        openFolderMenuItem(),
        openRecentMenuItem(),
        ...(conversationMode === 'secure'
          ? [{ type: 'separator' } as const, unlockSecureMenuItem(), reviewSecureMenuItem()]
          : []),
      ];
}

/**
 * A complete standard application menu — setting one at all REPLACES Electron's own default, so this
 * covers every role a person expects (Edit's cut/copy/paste keeps the composer's normal shortcuts
 * working), not only the Settings item.
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
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options);
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
 * Switch to another folder. The first folder's daemon keeps running — daemons are per folder —
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
      const message = {
        type: 'warning' as const,
        message: 'That folder no longer exists.',
        detail: folder,
      };
      const win = liveWindow();
      await (win ? dialog.showMessageBox(win, message) : dialog.showMessageBox(message));
      return false;
    }
    await releasePendingTrustCandidate();
    pendingTrust = undefined;
    secureTrustReady = false;
    restricted = false;
    admittedProviderEnvironmentReferences = [];
    // A start still running belongs to the previous folder; let it settle before asking for this one.
    await daemon.current()?.catch(() => undefined);
    if (conversationMode === 'secure') {
      await disposeDesktopAdmission();
      await releaseRestrictedHold();
    }
    useFolder(folder);
    const win = liveWindow();
    if (!win) return true;
    if (conversationMode === 'secure') {
      win.destroy();
      return true;
    }
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
  conversationMode = await readConversationMode();
  const openingPowerEpoch = securePowerEpoch;

  // In a folder not trusted yet the daemon would be refused; the person in front is asked first.
  const started = inFolderOrder(() =>
    (conversationMode === 'secure' && !secureDesktopSupported
      ? Promise.resolve(undefined)
      : readTrustQuestion()).then((question) => {
      pendingTrust = question;
      return question === undefined && conversationMode !== 'secure' ? daemon.start() : undefined;
    }),
  );

  const win = new BrowserWindow({
    width: 1100,
    height: 780,
    show: false,
    webPreferences: {
      preload: join(__dirname, conversationMode === 'secure' ? 'secure-preload.js' : 'preload.js'),
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
  win.on('close', (event) => {
    if (conversationMode !== 'secure') return;
    if (secureLockUnconfirmed || secureLockPending) {
      event.preventDefault();
      return;
    }
    if (!desktopAdmission) return;
    event.preventDefault();
    void disposeDesktopAdmission().then(
      () => {
        if (!win.isDestroyed()) win.destroy();
      },
      (error: unknown) => {
        secureLockUnconfirmed = true;
        reportFatal(
          win.webContents,
          error instanceof Error
            ? error.message
            : 'The secure runtime lock could not be confirmed.',
        );
      },
    );
  });

  if (conversationMode === 'secure') {
    win.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && !input.isAutoRepeat) desktopAdmission?.recordNativeActivity();
    });
    win.webContents.on('before-mouse-event', (_event, input) => {
      if (input.type === 'mouseDown') desktopAdmission?.recordNativeActivity();
    });
    win.webContents.on('did-finish-load', () => {
      void (async () => {
        await disposeDesktopAdmission();
        if (!secureDesktopSupported) {
          reportFatal(win.webContents, 'Secure desktop conversations require a supported screen-lock and workspace-root adapter. Use the secure CLI on supported systems.');
          return;
        }
        if (!secureTrustReady && pendingTrust === undefined) {
          reportFatal(win.webContents, 'The folder trust state could not be verified for a secure conversation.');
          return;
        }
        if (
          secureLockUnconfirmed ||
          win.isDestroyed() ||
          pendingTrust !== undefined ||
          !secureTrustReady ||
          workspaceFolder === undefined
        )
          return;
        const workspace = workspaceFolder;
        const powerEpoch = securePowerEpoch;
        const admission = registerDesktopSessionAdmission({
          sender: win.webContents,
          ipc: ipcMain,
          expected: { workspace: realpathSync(workspace), restricted },
          requestSecret: (signal) => openSecretWindow(win, signal),
          openOwner: async (secret, signal) => {
            const { openDesktopSecureOwner } = await import('@robota-sdk/agent-cli/desktop-host');
            return openDesktopSecureOwner({
              config: productConfig,
              environment: hostEnvironment,
              workspace,
              restricted,
              ...(restrictedHold ? { restrictedHold } : {}),
              secret,
              signal,
              childEnvironment: desktopDaemonEnvironment(productConfig, hostEnvironment, {
                restricted,
                providerEnvironmentReferences: admittedProviderEnvironmentReferences,
                allowScriptedE2eVariables,
              }),
              launchCommand: { executable: productCli(), args: [] },
            });
          },
          isCurrent: () =>
            !secureLockUnconfirmed &&
            securePowerEpoch === powerEpoch &&
            conversationMode === 'secure' &&
            workspaceFolder === workspace,
          createChannel: () => new MessageChannelMain(),
          onUnconfirmed: () => {
            secureLockUnconfirmed = true;
            refreshMenu();
            reportFatal(
              win.webContents,
              'The secure runtime lock could not be confirmed. Restart the app before reconnecting.',
            );
          },
          onDisposed: () => {
            if (desktopAdmission !== admission || secureLockUnconfirmed || win.isDestroyed())
              return;
            desktopAdmission = undefined;
            if (!win.webContents.isLoadingMainFrame()) win.webContents.reload();
          },
        });
        desktopAdmission = admission;
      })().catch((error: unknown) => {
        reportFatal(
          win.webContents,
          error instanceof Error ? error.message : 'Secure session admission failed.',
        );
      });
    });
  }

  // The CSP is fixed when the page loads, so the page loads once the daemon's port is known. A failed
  // start still loads the page: it shows the fatal screen with the CLI's reason. A pending trust
  // question loads it with no socket reachable; the answer reloads it.
  await started;
  if (conversationMode === 'secure' && pendingTrust !== undefined) {
    const ready = await inFolderOrder(() => resolveSecureWorkspaceTrust(win));
    if (!ready) {
      if (!win.isDestroyed()) win.destroy();
      if (securePowerEpoch === openingPowerEpoch) app.quit();
      return;
    }
  }
  refreshMenu();
  installCsp();
  await win.loadFile(join(__dirname, '../renderer/index.html'));
}

/**
 * The renderer asks (via preload) for its endpoint once, after the DOM is ready and after it has
 * subscribed to state. A failed start answers `null` and reports `fatal` with the reason to that page.
 */
ipcMain.on('agent-gui:runtime-mode', (event) => {
  event.returnValue = remoteMode ? 'remote' : conversationMode === 'secure' ? 'secure' : 'local';
});

ipcMain.handle('agent-gui:endpoint', async (event): Promise<string | null> => {
  if (conversationMode === 'secure' || (await readConversationMode()) !== 'plain') {
    reportFatal(event.sender, 'Secure conversations do not expose a WebSocket endpoint.');
    return null;
  }
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
    if (conversationMode === 'secure') return;
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
ipcMain.handle('agent-gui:trust-question', (): ITrustQuestion | null =>
  conversationMode === 'secure' ? null : pendingTrust ?? null);

/**
 * The composer's attach button: a native multi-file dialog, scoped to this window so it
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
 * The Project panel's Memory "Open in editor": opens a project-relative path — as the
 * local daemon itself reported it — in the OS default app for it. `resolveOpenPathTarget` refuses a
 * path that resolves outside this workspace before anything is opened.
 */
ipcMain.handle(
  'agent-gui:open-path',
  async (_event, path: unknown): Promise<{ error?: string }> => {
    if (remoteMode) return { error: 'Remote task paths cannot open files on this computer.' };
    if (conversationMode === 'secure')
      return { error: 'External editors are unavailable for secure conversations.' };
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
    if (conversationMode === 'secure') return { error: 'Secure folder approval requires a native decision.' };
    // The answer is about the question on screen when it was given; it applies to nothing else.
    const asked = pendingTrust;
    if (asked === undefined || !isTrustChoice(choice)) return {};
    if (choice === 'quit') {
      await releasePendingTrustCandidate();
      app.quit();
      return {};
    }
    return inFolderOrder(async () => {
      // A folder switch, or an earlier answer, since then has replaced that question: this one is stale.
      if (pendingTrust !== asked) return {};
      if (choice === 'trust') {
        const candidate = pendingTrustCandidate;
        if (candidate === undefined || workspaceFolder === undefined) {
          return { error: 'The prepared workspace approval is unavailable.' };
        }
        try {
          const { approveDesktopTrustCandidate } =
            await import('@robota-sdk/agent-cli/desktop-host');
          if (!(await approveDesktopTrustCandidate(productConfig, cliEnv(), asked, candidate))) {
            return { error: 'Workspace trust could not be confirmed.' };
          }
        } catch (error) {
          return {
            error:
              error instanceof Error ? error.message : 'Workspace trust could not be confirmed.',
          };
        }
        pendingTrustCandidate = undefined;
      } else {
        await releasePendingTrustCandidate();
        restricted = true;
        admittedProviderEnvironmentReferences = [];
      }
      pendingTrust = undefined;
      // Trust grant has completed. Re-read the now-admitted settings projection before starting
      // the daemon so only explicitly referenced provider/transport variables cross the boundary.
      if (choice === 'trust') await readTrustQuestion();
      if (conversationMode !== 'secure') await daemon.start();
      if (!event.sender.isDestroyed()) event.sender.reload();
      return {};
    });
  },
);

function reportFatal(sender: WebContents, detail: string | undefined): void {
  if (!sender.isDestroyed()) sender.send('agent-gui:state', 'fatal', detail);
}

// The rejection is ROUTED. `createWindow` starts the daemon and loads the renderer; if that
// fails the app has no window and, before this, no message either — the process just sat there. `.catch`
// after `.then`, not `.then(fn, onRejected)`, because the second argument handles a rejection of
// `whenReady()` alone and would let a `createWindow` failure float on unchanged.
function installSecurePowerEvents(): void {
  const revoke = (reason: 'screen-lock' | 'suspend'): void => {
    securePowerEpoch += 1;
    if (conversationMode !== 'secure') return;
    const win = liveWindow();
    if (win && !win.isDestroyed()) win.hide();
    const pending = disposeDesktopAdmission(reason);
    void pending.then(
      () => {
        if (win && !win.isDestroyed()) win.destroy();
        if (app.isReady() && !liveWindow()) {
          void createWindow().catch((error: unknown) => console.error('[agent-app] secure window recovery failed:', error));
        }
      },
      (error: unknown) => {
        secureLockUnconfirmed = true;
        console.error('[agent-app] secure runtime lock could not be confirmed:', error);
        if (win && !win.isDestroyed()) {
          win.destroy();
          void dialog.showMessageBox({
            type: 'error',
            message: 'The secure runtime lock could not be confirmed.',
            detail: 'Stop the secure runtime before reopening the app.',
          });
        }
        refreshMenu();
      },
    );
  };
  if (secureDesktopSupported) powerMonitor.on('lock-screen', () => revoke('screen-lock'));
  powerMonitor.on('suspend', () => revoke('suspend'));
}

app
  .whenReady()
  .then(() => { installSecurePowerEvents(); return createWindow(); })
  .catch((error) => {
    console.error('[agent-app] failed to create the main window:', error);
    app.quit();
  });

let closingRemote = false;
let closingSecure = false;
let closingRestricted = false;
app.on('before-quit', (event) => {
  if (secureLockUnconfirmed || secureLockPending) {
    event.preventDefault();
    return;
  }
  if (!desktopAdmission && restrictedHold && !closingRestricted) {
    event.preventDefault();
    closingRestricted = true;
    void releaseRestrictedHold().then(() => app.quit(), (error: unknown) => {
      closingRestricted = false;
      console.error('[agent-app] Restricted folder hold could not be released:', error);
      app.quit();
    });
    return;
  }
  if (!desktopAdmission || closingSecure) return;
  event.preventDefault();
  closingSecure = true;
  void disposeDesktopAdmission().then(
    () => app.quit(),
    (error: unknown) => {
      closingSecure = false;
      secureLockUnconfirmed = true;
      console.error('[agent-app] secure runtime lock could not be confirmed:', error);
      void dialog.showMessageBox({
        type: 'error',
        message: 'The secure runtime lock could not be confirmed. The app will stay open.',
        detail: 'Stop the secure runtime before closing the app.',
      });
    },
  );
});
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

// On macOS the app outlives its last window; clicking the Dock icon opens a new one on the same
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
