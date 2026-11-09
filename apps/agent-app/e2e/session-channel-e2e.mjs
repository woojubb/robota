import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';
import { _electron as electron } from 'playwright';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'robota-session-channel-'));
const home = join(root, 'home');
const env = Object.fromEntries(
  [
    'PATH',
    'DISPLAY',
    'WAYLAND_DISPLAY',
    'XAUTHORITY',
    'XDG_RUNTIME_DIR',
    'DBUS_SESSION_BUS_ADDRESS',
    'SystemRoot',
    'APPDATA',
    'TMPDIR',
    'TEMP',
    'LANG',
  ]
    .filter((key) => typeof process.env[key] === 'string')
    .map((key) => [key, process.env[key]]),
);
let application;
try {
  mkdirSync(home);
  await build({
    entryPoints: [join(here, 'fixtures/session-channel-client.ts')],
    outfile: join(root, 'client.js'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    logLevel: 'silent',
  });
  writeFileSync(
    join(root, 'frame.html'),
    '<!doctype html><html><body>Untrusted child frame</body></html>',
  );
  writeFileSync(
    join(root, 'fixture.html'),
    `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; frame-src 'self'; connect-src 'none'"></head><body>Session channel fixture<iframe sandbox="allow-scripts" src="frame.html"></iframe><script src="client.js"></script></body></html>`,
  );
  application = await electron.launch({
    executablePath: electronPath,
    args: [
      ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
      join(here, 'fixtures/session-channel-main.mjs'),
    ],
    env: {
      ...env,
      HOME: home,
      USERPROFILE: home,
      PRODUCT_USER_STATE_DIR: join(root, 'state'),
      FIXTURE_HTML: join(root, 'fixture.html'),
    },
    timeout: 30000,
  });
  const page = await application.firstWindow();
  await page.locator('iframe').waitFor();
  const child = page.frames().find((frame) => frame !== page.mainFrame());
  assert.ok(child, 'The fixture must have an actual child frame');
  assert.equal(await child.evaluate(() => typeof window.desktopSession), 'undefined');
  assert.equal(await application.evaluate(() => globalThis.sessionFixture.foreignFrame()), true);
  assert.equal(await application.evaluate(() => globalThis.sessionFixture.foreignWindow()), true);
  await page.evaluate(() => window.fixtureStart());
  await application.evaluate(() => globalThis.sessionFixture.open());
  await page.waitForFunction(() => window.fixtureStatus === 'connected');
  const childNavigation = page.waitForEvent('framenavigated', {
    predicate: (frame) => frame !== page.mainFrame(),
  });
  await page.locator('iframe').evaluate((element) => {
    element.src = 'frame.html?reload=1';
  });
  await childNavigation;
  assert.equal(await page.evaluate(() => window.fixtureStatus), 'connected');
  await application.evaluate(() =>
    globalThis.sessionFixture.deliver({ type: 'error', message: 'synthetic' }),
  );
  await page.waitForFunction(() => window.fixtureMessages.length === 1);
  assert.deepEqual(await application.evaluate(() => globalThis.sessionFixture.received()), [
    { type: 'get-messages' },
  ]);
  assert.deepEqual(await page.evaluate(() => window.fixtureMessages), [
    { type: 'error', message: 'synthetic' },
  ]);
  assert.equal(await application.evaluate(() => globalThis.sessionFixture.duplicate()), true);
  assert.equal(
    await page.evaluate(async () => {
      try {
        await fetch('http://127.0.0.1:9/probe');
        return true;
      } catch {
        return false;
      }
    }),
    false,
  );
  assert.equal(await application.evaluate(() => globalThis.sessionFixture.networkRequests()), 0);
  await application.evaluate(() => globalThis.sessionFixture.revoke());
  await page.waitForFunction(() => window.fixtureStatus === 'disconnected');
  await page.evaluate(() => window.fixtureSend());
  assert.deepEqual(await application.evaluate(() => globalThis.sessionFixture.received()), [
    { type: 'get-messages' },
  ]);
  await application.evaluate(() => globalThis.sessionFixture.reset());
  await page.reload();
  await page.evaluate(() => window.fixtureStart());
  await application.evaluate(() => globalThis.sessionFixture.open());
  await page.waitForFunction(() => window.fixtureStatus === 'connected');
  await page.reload();
  assert.equal(await application.evaluate(() => globalThis.sessionFixture.unsubscribed()), 2);
  await application.evaluate(() => globalThis.sessionFixture.reset());
  await page.evaluate(() => window.fixtureStart());
  await application.evaluate(() => globalThis.sessionFixture.open());
  await page.waitForFunction(() => window.fixtureStatus === 'connected');
  assert.equal(await page.evaluate(() => window.desktopSession.send('{"type":"unlock"}')), true);
  await page.waitForFunction(() => window.fixtureStatus === 'disconnected');
  assert.equal(
    await application.evaluate(() =>
      globalThis.sessionFixture.received().some((message) => message.type === 'unlock'),
    ),
    false,
  );
  assert.equal(await application.evaluate(() => globalThis.sessionFixture.unsubscribed()), 3);
  console.log(
    'Electron sandboxed session bridge: top frame, port transfer, round trip, duplicate rejection, no network and revocation passed.',
  );
} finally {
  if (application) await application.close();
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}
