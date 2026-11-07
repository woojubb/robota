import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, Menu, MessageChannelMain } from 'electron';
import admissionModule from '../../dist/electron/desktop-session-admission.js';
import secretModule from '../../dist/electron/secret-window.js';

app.setPath('userData', join(process.env.HOME, 'electron-user-data'));
app.whenReady().then(async () => {
  const parent = new BrowserWindow({ show: false, webPreferences: {
    preload: join(import.meta.dirname, '../../dist/electron/session-preload.js'),
    contextIsolation: true, nodeIntegration: false, sandbox: true,
  } });
  await parent.loadFile(process.env.FIXTURE_HTML);
  let sent = [];
  let released = 0;
  let resolveReleased;
  const releaseComplete = new Promise((resolve) => { resolveReleased = resolve; });
  let locked = 0;
  let closed = 0;
  let prompts = 0;
  let unconfirmed = 0;
  let sourceWasMainFrame = false;
  let requestPorts;
  let ready;
  const requested = new Promise((resolve) => { ready = resolve; });
  ipcMain.on('desktop-session:request', (event) => {
    if (event.sender === parent.webContents) {
      sourceWasMainFrame = event.senderFrame === parent.webContents.mainFrame;
      requestPorts = { array: Array.isArray(event.ports), type: typeof event.ports, value: event.ports?.length };
      ready();
    }
  });
  let resolveClosed;
  const link = {
    standing: 'owner', binding: { runtimeId: 'fixture', generation: 'generation' },
    custody: { certified: true, unlocked: false }, closed: new Promise((resolve) => { resolveClosed = resolve; }),
    onCustody: () => () => {}, close: () => { closed++; resolveClosed(); }, revokeToCleanup: () => {},
    lock: async () => { locked++; }, unlock: async () => 'verified',
    control: async (request) => request.command === 'status'
      ? { status: 'running', daemon: true, cwd: '/synthetic/workspace' }
      : { status: 'attached', driverId: 'driver-fixture' },
    session: { send: (message) => sent.push(message), onMessage: () => () => {} },
  };
  const admission = admissionModule.registerDesktopSessionAdmission({
    sender: parent.webContents, ipc: ipcMain, isCurrent: () => true,
    expected: { workspace: '/synthetic/workspace', restricted: false },
    requestSecret: (signal) => { prompts++; return secretModule.openSecretWindow(parent, signal); },
    openOwner: async (secret) => {
      if (secret.type !== 'passphrase' || secret.value !== 'synthetic-test-value') throw new Error('Unexpected fixture input.');
      return { link, selected: { runtimeId: 'fixture', generation: 'generation' }, release: () => { released++; resolveReleased(); } };
    },
    createChannel: () => new MessageChannelMain(), onUnconfirmed: () => { unconfirmed++; },
  });
  let opened;
  const menu = Menu.buildFromTemplate([{ label: 'Fixture', submenu: [{
    id: 'fixture-unlock', label: 'Unlock', click: () => { opened = admission.openFromNativeAction(); },
  }] }]);
  Menu.setApplicationMenu(menu);
  globalThis.desktopAdmissionFixture = {
    requested: () => requested,
    invokeNativeAction: () => menu.getMenuItemById('fixture-unlock').click(),
    result: async () => (await opened).kind,
    dispose: () => admission.dispose(),
    released: () => releaseComplete,
    foreignRequest: async () => {
      const probe = new BrowserWindow({ show: false, webPreferences: {
        preload: join(import.meta.dirname, 'desktop-adversarial-preload.cjs'),
        contextIsolation: true, nodeIntegrationInSubFrames: true, sandbox: true,
      } });
      await probe.loadFile(process.env.FIXTURE_CHILD_HTML);
      const denied = admissionModule.registerDesktopSessionAdmission({
        sender: probe.webContents, ipc: ipcMain, isCurrent: () => true,
        expected: { workspace: '/synthetic/workspace', restricted: false },
        requestSecret: async () => { throw new Error('Foreign window prompted.'); },
        openOwner: async () => { throw new Error('Foreign window opened owner.'); },
        createChannel: () => new MessageChannelMain(), onUnconfirmed: () => { unconfirmed++; },
      });
      const childFrame = probe.webContents.mainFrame.frames[0];
      if (!childFrame) throw new Error('Child fixture is unavailable.');
      const childRequest = new Promise((resolve) => {
        const witness = (event) => {
          if (event.sender === probe.webContents && event.senderFrame === childFrame) {
            ipcMain.removeListener('desktop-session:request', witness); resolve();
          }
        };
        ipcMain.on('desktop-session:request', witness);
      });
      childFrame.send('fixture:child-request');
      await childRequest;
      const child = (await denied.openFromNativeAction()).kind;
      const foreign = new BrowserWindow({ show: false, webPreferences: {
        preload: join(import.meta.dirname, '../../dist/electron/session-preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
      } });
      const received = new Promise((resolve) => {
        const witness = (event) => {
          if (event.sender === foreign.webContents) { ipcMain.removeListener('desktop-session:request', witness); resolve(); }
        };
        ipcMain.on('desktop-session:request', witness);
      });
      await foreign.loadFile(process.env.FIXTURE_HTML);
      await received;
      const result = await denied.openFromNativeAction();
      await denied.dispose();
      foreign.destroy();
      probe.destroy();
      return { child, foreign: result.kind };
    },
    state: () => ({ sent, released, locked, closed, prompts, unconfirmed, sourceWasMainFrame, requestPorts }),
  };
});
