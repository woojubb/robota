import { join } from 'node:path';
import { app, BrowserWindow, MessageChannelMain } from 'electron';

import ownerModule from '../../dist/electron/desktop-owner-seam.js';
import relayModule from '../../dist/electron/desktop-session-relay.js';
import secretModule from '../../dist/electron/secret-window.js';

app.setPath('userData', join(process.env.HOME, 'electron-user-data'));
app.whenReady().then(async () => {
  const parent = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: join(import.meta.dirname, '../../dist/electron/session-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  let networkRequests = 0;
  parent.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    const network = /^(?:https?|wss?):/u.test(details.url);
    if (network) networkRequests++;
    callback({ cancel: network });
  });
  let receive;
  let signalSubscribed;
  const subscribed = new Promise((resolve) => { signalSubscribed = resolve; });
  let releaseStatus;
  const status = new Promise((resolve) => { releaseStatus = resolve; });
  let sent = [];
  let disposed = 0;
  let locked = 0;
  let closed = 0;
  const link = {
    standing: 'owner',
    binding: { runtimeId: 'runtime-fixture', generation: 'generation-fixture' },
    custody: { certified: true, unlocked: false },
    closed: new Promise(() => {}),
    onCustody: () => () => {},
    close: () => { closed++; },
    lock: async () => { locked++; },
    unlock: async () => 'verified',
    control: (request) => request.command === 'status'
      ? status : Promise.resolve({ status: 'attached', driverId: 'driver-fixture' }),
    session: {
      send: (message) => { sent.push(message); },
      onMessage: (listener) => { receive = listener; signalSubscribed(); return () => { receive = undefined; }; },
    },
  };
  const controller = new AbortController();
  const coordinator = ownerModule.createDesktopOwnerCoordinator({
    expected: { runtimeId: 'runtime-fixture', generation: 'generation-fixture', workspace: '/synthetic/workspace', restricted: false },
    requestSecret: (signal) => secretModule.openSecretWindow(parent, signal),
    openOwner: async (secret) => {
      if (secret.type !== 'passphrase' || secret.value !== 'synthetic-test-value') throw new Error('Unexpected fixture input.');
      return { link, release: () => { disposed++; } };
    },
    openRelay: (session, signal, isCurrent) => relayModule.openDesktopSessionRelay({
      sender: parent.webContents,
      source: { sender: parent.webContents, senderFrame: parent.webContents.mainFrame },
      session, signal, isCurrent, createChannel: () => new MessageChannelMain(),
    }),
  });
  let opened;
  globalThis.desktopOwnerFixture = {
    start() { opened = coordinator.open({ signal: controller.signal, isCurrent: () => true }); },
    subscribed: async () => {
      let timer;
      try {
        const state = await Promise.race([
          subscribed.then(() => 'subscribed'),
          opened.then((result) => `result:${result.kind}`),
          new Promise((resolve) => { timer = setTimeout(() => resolve('timeout'), 5_000); }),
        ]);
        if (state !== 'subscribed') throw new Error(`Session subscription failed: ${state}`);
      } finally { clearTimeout(timer); }
    },
    sendEarly: () => receive?.({ type: 'error', message: 'fixture-early-message' }),
    releaseStatus: () => releaseStatus({ status: 'running', daemon: true, cwd: '/synthetic/workspace' }),
    result: async () => (await opened).kind,
    close: async () => { const result = await opened; if (result.kind === 'open') await result.close(); },
    state: () => ({ sent, disposed, locked, closed, networkRequests }),
  };
  await parent.loadFile(process.env.FIXTURE_HTML);
});
