import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import electronPath from 'electron';
import { _electron as electron } from 'playwright';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'robota-desktop-owner-'));
const home = join(root, 'home');
const env = Object.fromEntries(
  ['PATH', 'DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'SystemRoot', 'APPDATA', 'TMPDIR', 'TEMP', 'LANG']
    .filter((key) => typeof process.env[key] === 'string').map((key) => [key, process.env[key]]),
);
async function within(promise, label, timeoutMs = 10_000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}
let application;
let closeError;
try {
  mkdirSync(home);
  await build({ entryPoints: [join(here, 'fixtures/session-channel-client.ts')], outfile: join(root, 'client.js'),
    bundle: true, platform: 'browser', format: 'iife', logLevel: 'silent' });
  writeFileSync(join(root, 'fixture.html'), `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; connect-src 'none'"></head><body><script src="client.js"></script></body></html>`);
  application = await electron.launch({
    executablePath: electronPath,
    args: [...(process.platform === 'linux' ? ['--no-sandbox'] : []), join(here, 'fixtures/desktop-owner-session-main.mjs')],
    env: { ...env, HOME: home, USERPROFILE: home, PRODUCT_USER_STATE_DIR: join(root, 'state'), FIXTURE_HTML: join(root, 'fixture.html') },
    timeout: 30_000,
  });
  const parent = await within(application.firstWindow(), 'Main window');
  await within(parent.evaluate(() => window.fixtureStart()), 'Session client setup');
  const idleWindow = application.waitForEvent('window', { timeout: 10_000 });
  await within(application.evaluate(() => globalThis.desktopOwnerFixture.start()), 'Start idle prompt');
  const idlePrompt = await idleWindow;
  await assert.rejects(within(application.evaluate(() => globalThis.desktopOwnerFixture.result()), 'Idle prompt', 250), /Idle prompt timed out/);
  await idlePrompt.locator('#cancel').click({ timeout: 10_000 });
  assert.equal(await within(application.evaluate(() => globalThis.desktopOwnerFixture.result()), 'Cancelled prompt'), 'cancelled');
  const wrongWindow = application.waitForEvent('window', { timeout: 10_000 });
  await within(application.evaluate(() => globalThis.desktopOwnerFixture.start()), 'Start prompt');
  const wrongPrompt = await wrongWindow;
  await wrongPrompt.locator('#secret-value').fill('synthetic-wrong-value', { timeout: 10_000 });
  await wrongPrompt.locator('button[type="submit"]').click({ timeout: 10_000 });
  assert.equal(await within(application.evaluate(() => globalThis.desktopOwnerFixture.result()), 'Owner result'), 'refused');
  await assert.rejects(
    within(application.evaluate(() => globalThis.desktopOwnerFixture.subscribed()), 'Failed subscription', 6_000),
    /Session subscription failed: result:refused/,
  );
  const nextWindow = application.waitForEvent('window', { timeout: 10_000 });
  await within(application.evaluate(() => globalThis.desktopOwnerFixture.start()), 'Start prompt');
  const prompt = await nextWindow;
  await prompt.locator('#secret-value').fill('synthetic-test-value', { timeout: 10_000 });
  await prompt.locator('button[type="submit"]').click({ timeout: 10_000 });
  await within(application.evaluate(() => globalThis.desktopOwnerFixture.subscribed()), 'Session subscription');
  await within(application.evaluate(() => { globalThis.desktopOwnerFixture.sendEarly(); globalThis.desktopOwnerFixture.releaseStatus(); }), 'Fixture status');
  assert.equal(await within(application.evaluate(() => globalThis.desktopOwnerFixture.result()), 'Owner result'), 'open');
  await within(parent.waitForFunction(() => window.fixtureStatus === 'connected' && window.fixtureMessages.length === 1), 'Session connection');
  assert.deepEqual(await within(parent.evaluate(() => window.fixtureMessages), 'Session messages'), [{ type: 'error', message: 'fixture-early-message' }]);
  assert.deepEqual(await within(parent.evaluate(() => Object.keys(window.desktopSession).sort()), 'Session facade'), ['close', 'send', 'subscribe']);
  assert.equal(await within(parent.evaluate(() => typeof window.desktopSession.unlock), 'Owner visibility'), 'undefined');
  assert.equal(await within(parent.evaluate(async () => {
    try { await fetch('http://127.0.0.1:9/fixture'); return true; }
    catch { return false; }
  }), 'HTTP isolation'), false);
  assert.equal(await within(parent.evaluate(() => new Promise((resolve) => {
    const socket = new WebSocket('ws://127.0.0.1:9/fixture');
    const timer = setTimeout(() => { socket.close(); resolve(false); }, 1_000);
    socket.onopen = () => { clearTimeout(timer); socket.close(); resolve(true); };
    socket.onerror = () => { clearTimeout(timer); resolve(false); };
  })), 'WebSocket isolation'), false);
  await within(application.evaluate(() => globalThis.desktopOwnerFixture.close()), 'Session close');
  await within(parent.waitForFunction(() => window.fixtureStatus === 'disconnected'), 'Session disconnection');
  const result = await within(application.evaluate(() => globalThis.desktopOwnerFixture.state()), 'Fixture state');
  assert.deepEqual(result.sent, [{ type: 'get-messages' }]);
  assert.equal(result.networkRequests, 0);
  assert.deepEqual({ disposed: result.disposed, locked: result.locked, closed: result.closed }, { disposed: 1, locked: 1, closed: 1 });
  console.log('Sandboxed desktop fixture: explicit prompt, session-only relay, early frame and revocation passed.');
} finally {
  if (application) {
    const child = application.process();
    try { await within(application.close(), 'Electron shutdown', 5_000); }
    catch (error) {
      closeError = error;
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        child.kill('SIGKILL');
        try { await within(exited, 'Electron forced shutdown', 5_000); } catch { /* Report the original shutdown failure. */ }
      }
    }
  }
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}
if (closeError) throw closeError;
