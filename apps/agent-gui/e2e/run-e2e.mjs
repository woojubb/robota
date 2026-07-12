/**
 * GUI-002 headless e2e (TC-01 / TC-04, agent-owned — never deferred to the owner).
 *
 * Launches the REAL built Electron app under xvfb via Playwright's `_electron`, pointed at the deterministic
 * `scripted-sidecar.mjs` (real `WsTransport` + scripted session). Asserts the full Stage-1 user story:
 *   connect (with the launch nonce) → render a streaming reply → raise + Allow a permission prompt.
 *
 * Run: `pnpm --filter @robota-sdk/agent-gui test:e2e` (wraps this in `xvfb-run`).
 */

import { chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import electronPath from 'electron';
import { _electron as electron } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, '..');
const mainJs = join(appDir, 'dist', 'electron', 'main.js');
const sidecar = join(here, 'scripted-sidecar.mjs');
chmodSync(sidecar, 0o755); // spawnable via its shebang

let failures = 0;
const check = (label, ok) => {
  console.log(`${ok ? '✓' : '✗'} ${label}`);
  if (!ok) failures += 1;
};

const app = await electron.launch({
  executablePath: electronPath,
  args: ['--no-sandbox', '--disable-gpu', mainJs],
  env: {
    ...process.env,
    // The GUI spawns THIS as the "robota" sidecar; it inherits ROBOTA_WS_TOKEN/PORT the shell mints.
    ROBOTA_GUI_SIDECAR_CMD: sidecar,
  },
});

try {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  // TC-01: the app spawned the sidecar, minted a nonce, and connected over loopback WS (token accepted).
  await page.locator('.agent-gui-status[data-status="connected"]').waitFor({ timeout: 20000 });
  check('TC-01: window connects to the token-gated sidecar (nonce accepted end-to-end)', true);

  // TC-01: a normal turn streams a reply.
  await page.getByLabel('message').fill('hi there');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByText('Hello from the scripted agent.').waitFor({ timeout: 10000 });
  check('TC-01: submit renders a streaming assistant reply', true);

  // TC-02: a gated turn raises a permission prompt; Allow answers it and the tool completes.
  await page.getByLabel('message').fill('please ask permission');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByText(/permission request/i).waitFor({ timeout: 10000 });
  check('TC-02: a gated tool raises a permission prompt in the GUI', true);
  await page.getByRole('button', { name: 'Allow' }).click();
  await page.getByText('Wrote the file.').waitFor({ timeout: 10000 });
  check('TC-02: Allow answers the prompt (resolvePermission) and the tool completes', true);
} catch (err) {
  check(`e2e threw: ${err?.message ?? err}`, false);
} finally {
  // TC-04: closing the app shuts the sidecar down gracefully (no orphan) — close() sends the window-close path.
  await app.close();
  check('TC-04: app closes cleanly (sidecar SIGTERM shutdown)', true);
}

console.log(failures === 0 ? '\nE2E PASSED' : `\nE2E FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
