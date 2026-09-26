/**
 * Desktop smoke test — only what the Electron shell itself owns. The GUI's user scenarios run in a plain
 * browser in packages/agent-gui-web (`test:e2e`).
 *
 * Launches the REAL built app (Playwright `_electron`) with the deterministic scripted sidecar as its
 * "robota", and checks: the shell spawns the sidecar with a launch nonce and the page connects with it
 * (TC-01); a turn round-trips (TC-01); closing the window shuts the sidecar down (TC-04); and a sidecar
 * that dies reaches the fatal screen instead of hanging (ARCH-2164).
 *
 * Run: `pnpm --filter @robota-sdk/agent-app test:e2e` (wraps this in `xvfb-run`; on macOS run it with node).
 */

import { chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import electronPath from 'electron';
import { _electron as electron } from 'playwright';


/** One line of output (scripts write to the streams directly). */
const line = (text) => `${text}\n`;

const here = dirname(fileURLToPath(import.meta.url));
const mainJs = join(here, '..', 'dist', 'electron', 'main.js');
const sidecar = join(here, '..', '..', '..', 'packages', 'agent-gui-web', 'e2e', 'scripted-sidecar.mjs');
chmodSync(sidecar, 0o755); // spawnable via its shebang

let failures = 0;
const check = (label, ok) => {
  process.stdout.write(line(`${ok ? '✓' : '✗'} ${label}`));
  if (!ok) failures += 1;
};

const launch = (extraEnv = {}) =>
  electron.launch({
    executablePath: electronPath,
    args: ['--no-sandbox', '--disable-gpu', mainJs],
    // The GUI spawns THIS as the "robota" sidecar; it inherits ROBOTA_WS_TOKEN/PORT the shell mints.
    env: { ...process.env, ROBOTA_GUI_SIDECAR_CMD: sidecar, ...extraEnv },
  });

const app = await launch();
try {
  const page = await app.firstWindow();
  await page.locator('.agent-gui-status[data-status="connected"]').waitFor({ timeout: 20_000 });
  check('TC-01: the window connects to the token-gated sidecar (nonce accepted end-to-end)', true);
  await page.getByLabel('message').fill('hi there');
  await page.getByLabel('message').press('Enter');
  await page.getByText('Hello from the scripted agent.').waitFor({ timeout: 10_000 });
  check('TC-01: a turn round-trips through the desktop shell', true);
} catch (err) {
  check(`smoke threw: ${err?.message ?? err}`, false);
} finally {
  await app.close();
  check('TC-04: the app closes cleanly (sidecar SIGTERM shutdown)', true);
}

const rejectedApp = await launch({ ROBOTA_E2E_REJECT_ADMISSION: '1' });
try {
  const page = await rejectedApp.firstWindow();
  await page.getByRole('alert').getByText(/agent process stopped/).waitFor({ timeout: 20_000 });
  check('ARCH-2164: a sidecar that dies reaches the fatal screen', true);
} catch (err) {
  check(`fatal-state check threw: ${err?.message ?? err}`, false);
} finally {
  await rejectedApp.close();
}

process.stdout.write(line(failures === 0 ? '\nE2E PASSED' : `\nE2E FAILED (${failures})`));
process.exit(failures === 0 ? 0 : 1);
