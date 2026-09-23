/** SCREEN-2577 direct Electron scenario: admitted sidecar → aggregate dashboard → stored/current trace. */
import { chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import electronPath from 'electron';
import { _electron as electron } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, '..');
const sidecar = join(here, 'scripted-sidecar.mjs');
chmodSync(sidecar, 0o755);

const launch = (extraEnv = {}) =>
  electron.launch({
    executablePath: electronPath,
    args: ['--no-sandbox', '--disable-gpu', join(appDir, 'dist', 'electron', 'main.js')],
    env: { ...process.env, ROBOTA_GUI_SIDECAR_CMD: sidecar, ...extraEnv },
  });

const app = await launch();
try {
  const page = await app.firstWindow();
  await page.locator('.agent-gui-status[data-status="connected"]').waitFor({ timeout: 20_000 });
  await page.getByLabel('message').fill('/help');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByText('/help: ok').waitFor();
  await page.getByLabel('message').fill('please fail');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByText('Scripted provider failure').waitFor();
  await page.getByText('Partial reply before failure.').waitFor();
  await page.getByLabel('message').fill('recover');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByText('Hello from the scripted agent.').waitFor();
  await page.getByRole('button', { name: 'Usage' }).click();
  await page.getByRole('heading', { name: 'Personal usage' }).waitFor();
  await page.getByText('scripted-model').waitFor();
  await page.getByText('Partial day').waitFor();
  await page.getByText('$0.00 estimated').waitFor();
  await page.getByRole('button', { name: '30 days' }).click();
  await page.getByRole('button', { name: 'By provider' }).click();
  await page.getByText('unknown').waitFor();
  await page.getByRole('button', { name: 'By surface' }).click();
  await page.getByText('desktop-app').waitFor();
  await page.getByRole('button', { name: 'Open session usage-e2e-session' }).click();
  await page.getByRole('region', { name: 'Session usage detail' }).getByText('42').waitFor();
  await page.getByRole('button', { name: 'Current session trace' }).click();
  await page
    .getByRole('region', { name: 'Current session usage' })
    .getByText(/42 tokens/)
    .waitFor();
  if ((await page.getByText('PROMPT_CONTENT_MUST_NOT_APPEAR').count()) !== 0) {
    throw new Error('dashboard rendered raw persisted content');
  }
  process.stdout.write('SCREEN-2577 usage dashboard scenario passed\n');
} finally {
  await app.close();
}

const rejectedApp = await launch({ ROBOTA_E2E_REJECT_ADMISSION: '1' });
try {
  const page = await rejectedApp.firstWindow();
  await page
    .getByRole('alert')
    .getByText(/Personal Usage is unavailable/)
    .waitFor({
      timeout: 20_000,
    });
  if ((await page.getByText('scripted-model').count()) !== 0) {
    throw new Error('unadmitted renderer received usage data');
  }
  process.stdout.write('ARCH-2164 rejected-admission scenario passed\n');
} finally {
  await rejectedApp.close();
}
