import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import electronPath from 'electron';
import { _electron as electron } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'robota-desktop-secret-'));
const home = join(root, 'home');
mkdirSync(home);
const env = Object.fromEntries(
  ['PATH', 'DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'SystemRoot', 'APPDATA', 'TMPDIR', 'TEMP', 'LANG']
    .filter((key) => typeof process.env[key] === 'string')
    .map((key) => [key, process.env[key]]),
);
let application;
try {
  application = await electron.launch({
    executablePath: electronPath,
    args: [...(process.platform === 'linux' ? ['--no-sandbox'] : []), join(here, 'fixtures', 'secret-window-main.mjs')],
    env: { ...env, HOME: home, USERPROFILE: home, PRODUCT_USER_STATE_DIR: join(root, 'state'), ROBOTA_USER_STATE_DIR: join(root, 'state') },
    timeout: 30_000,
  });
  await application.firstWindow();
  const open = async () => {
    const nextWindow = application.waitForEvent('window', { timeout: 10_000 });
    await application.evaluate(() => { globalThis.secretWindowFixture.start(); });
    const page = await nextWindow;
    await page.locator('#secret-value').waitFor();
    return page;
  };
  const page = await open();
  await application.evaluate(() => { globalThis.secretWindowFixture.spoof(); });
  await page.locator('#secret-value').fill('synthetic-local-passphrase');
  const messages = [];
  page.on('console', (message) => messages.push(message.text()));
  const networkAllowed = await page.evaluate(async () => {
    try { await fetch('http://127.0.0.1:9/secret-window-csp-probe'); return true; }
    catch { return false; }
  });
  assert.equal(networkAllowed, false);
  assert.ok(messages.some((message) => /content security policy|connect-src/iu.test(message)), 'network refusal must come from CSP');
  await page.locator('button[type="submit"]').click();
  const submitted = await application.evaluate(async () => await globalThis.secretWindowFixture.result());
  assert.deepEqual(submitted, { type: 'passphrase', value: 'synthetic-local-passphrase' });

  const recoveryPage = await open();
  await recoveryPage.locator('#secret-type').selectOption('recovery');
  await recoveryPage.locator('#secret-value').fill('synthetic-recovery-key');
  await recoveryPage.locator('button[type="submit"]').click();
  assert.deepEqual(await application.evaluate(async () => await globalThis.secretWindowFixture.result()),
    { type: 'recovery', value: 'synthetic-recovery-key' });

  const cancelledPage = await open();
  await cancelledPage.locator('#cancel').click();
  assert.equal(await application.evaluate(async () => (await globalThis.secretWindowFixture.result()) ?? null), null);
  console.log('Desktop secret window: passphrase, recovery, forged sender, cancellation and CSP passed.');
} finally {
  if (application) await application.close();
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}
