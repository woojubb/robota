import { join } from 'node:path';
import { app, BrowserWindow, MessageChannelMain } from 'electron';
import relayModule from '../../dist/electron/desktop-session-relay.js';

app.setPath('userData', join(process.env.HOME, 'electron-user-data'));
let parent;
let relay;
let receive;
const received = [];
let networkRequests = 0;
let current = true;
let admission = new AbortController();
let unsubscribed = 0;
app.whenReady().then(async () => {
  parent = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: join(import.meta.dirname, '../../dist/electron/session-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  parent.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    const network = details.url.startsWith('http:') || details.url.startsWith('https:');
    if (network) networkRequests++;
    callback({ cancel: network });
  });
  const session = {
    send(message) {
      received.push(message);
    },
    onMessage(listener) {
      receive = listener;
      return () => {
        receive = undefined;
        unsubscribed++;
      };
    },
  };
  const options = () => ({
    sender: parent.webContents,
    source: { sender: parent.webContents, senderFrame: parent.webContents.mainFrame },
    session,
    signal: admission.signal,
    isCurrent: () => current,
    createChannel: () => new MessageChannelMain(),
  });
  globalThis.sessionFixture = {
    open() {
      relay = relayModule.openDesktopSessionRelay(options());
    },
    foreignFrame() {
      const child = parent.webContents.mainFrame.frames[0];
      if (!child) throw new Error('Expected a real child frame.');
      try {
        relayModule.openDesktopSessionRelay({
          ...options(),
          source: { sender: parent.webContents, senderFrame: child },
        });
        return false;
      } catch {
        return true;
      }
    },
    foreignWindow() {
      const other = new BrowserWindow({
        show: false,
        webPreferences: { sandbox: true, nodeIntegration: false },
      });
      try {
        relayModule.openDesktopSessionRelay({
          ...options(),
          source: { sender: other.webContents, senderFrame: other.webContents.mainFrame },
        });
        return false;
      } catch {
        return true;
      } finally {
        other.destroy();
      }
    },
    duplicate() {
      try {
        relayModule.openDesktopSessionRelay(options());
        return false;
      } catch {
        return true;
      }
    },
    deliver(message) {
      receive?.(message);
    },
    received() {
      return received;
    },
    networkRequests() {
      return networkRequests;
    },
    unsubscribed() {
      return unsubscribed;
    },
    reset() {
      current = true;
      admission = new AbortController();
    },
    revoke() {
      current = false;
      admission.abort();
    },
  };
  await parent.loadFile(process.env.FIXTURE_HTML);
});
