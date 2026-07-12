/**
 * GUI-005 visual capture (agent-owned). Launches the REAL built Electron app under xvfb (via
 * `xvfb-run -a -s '-screen 0 1280x900x24' node e2e/capture.mjs`), drives a streaming turn plus a
 * permission prompt against the scripted sidecar, and writes PNG screenshots of the terminal-noir shell.
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
const outDir = process.env.CAPTURE_OUT ?? join(appDir, 'e2e', 'shots');
chmodSync(sidecar, 0o755);

const app = await electron.launch({
  executablePath: electronPath,
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,900', mainJs],
  env: { ...process.env, ROBOTA_GUI_SIDECAR_CMD: sidecar },
});

const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
await page.setViewportSize({ width: 1280, height: 900 });
await page.locator('.agent-gui-status[data-status="connected"]').waitFor({ timeout: 20000 });

// A streaming reply.
await page.getByLabel('message').fill('Summarize the terminal-noir GUI shell.');
await page.getByRole('button', { name: 'Send' }).click();
await page.getByText('Hello from the scripted agent.').waitFor({ timeout: 10000 });
await page.waitForTimeout(400);
await page.screenshot({ path: join(outDir, 'conversation.png') });

// A permission prompt (modal).
await page.getByLabel('message').fill('please ask permission');
await page.getByRole('button', { name: 'Send' }).click();
await page.getByText(/permission request/i).waitFor({ timeout: 10000 });
await page.waitForTimeout(300);
await page.screenshot({ path: join(outDir, 'permission.png') });

await app.close();
console.log(`shots written to ${outDir}`);
