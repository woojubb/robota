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
  writeFileSync(join(root, 'child.html'), '<!doctype html><title>Child fixture</title>');
  writeFileSync(join(root, 'child-parent.html'), '<!doctype html><iframe src="child.html"></iframe>');
  application = await electron.launch({
    executablePath: electronPath,
    args: [...(process.platform === 'linux' ? ['--no-sandbox'] : []), join(here, 'fixtures/desktop-session-admission-main.mjs')],
    env: { ...env, HOME: home, USERPROFILE: home, PRODUCT_USER_STATE_DIR: join(root, 'state'), FIXTURE_HTML: join(root, 'fixture.html'), FIXTURE_CHILD_HTML: join(root, 'child-parent.html') },
    timeout: 30_000,
  });
  const parent = await within(application.firstWindow(), 'Main window');
  await within(parent.evaluate(() => window.fixtureStart()), 'Session client setup');
  await within(application.evaluate(() => globalThis.desktopAdmissionFixture.requested()), 'Actual renderer request');
  assert.deepEqual(await within(application.evaluate(() => globalThis.desktopAdmissionFixture.foreignRequest()), 'Foreign renderer request'), { child: 'not-ready', foreign: 'not-ready' });
  assert.equal((await application.evaluate(() => globalThis.desktopAdmissionFixture.state())).prompts, 0);
  const promptWindow = application.waitForEvent('window', { timeout: 10_000, predicate: async (page) => {
    try { await page.locator('#secret-value').waitFor({ timeout: 2_000 }); return true; }
    catch { return false; }
  } });
  await within(application.evaluate(() => globalThis.desktopAdmissionFixture.invokeNativeAction()), 'Native menu action');
  const prompt = await promptWindow;
  await prompt.locator('#secret-value').fill('synthetic-test-value', { timeout: 10_000 });
  await prompt.locator('button[type="submit"]').click({ timeout: 10_000 });
  assert.equal(await within(application.evaluate(() => globalThis.desktopAdmissionFixture.result()), 'Owner result'), 'open');
  await within(parent.waitForFunction(() => window.fixtureStatus === 'connected'), 'Session connection');
  assert.deepEqual(await parent.evaluate(() => Object.keys(window.desktopSession).sort()), ['close', 'send', 'subscribe']);
  assert.equal(await parent.evaluate(() => typeof window.desktopSession.unlock), 'undefined');
  await parent.evaluate(() => window.fixtureSend());
  await parent.evaluate(() => window.desktopSession.close());
  await within(application.evaluate(() => globalThis.desktopAdmissionFixture.released()), 'Owner release after renderer close', 2_000);
  await within(application.evaluate(() => globalThis.desktopAdmissionFixture.invokeNativeAction()), 'Native action after closure');
  assert.equal(await application.evaluate(() => globalThis.desktopAdmissionFixture.result()), 'not-ready');
  await within(application.evaluate(() => globalThis.desktopAdmissionFixture.dispose()), 'Session disposal');
  await within(parent.waitForFunction(() => window.fixtureStatus === 'disconnected'), 'Session disconnection');
  const state = await within(application.evaluate(() => globalThis.desktopAdmissionFixture.state()), 'Fixture state');
  assert.deepEqual(state, { sent: [{ type: 'get-messages' }, { type: 'get-messages' }], released: 1, locked: 1, closed: 1,
    prompts: 1, unconfirmed: 0, sourceWasMainFrame: true, requestPorts: { array: false, type: 'undefined', value: undefined } });
  console.log('Sandboxed Electron IPC: actual main-frame request, foreign window and child frame, and synthetic native action passed.');
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
