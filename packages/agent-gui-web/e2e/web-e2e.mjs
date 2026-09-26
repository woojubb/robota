/**
 * The GUI's user scenarios in a plain browser (Playwright Chromium) — no Electron, no display server.
 *
 * Serves the built app (`vite preview`), starts the deterministic scripted sidecar on a free loopback
 * port, and opens the page with the sidecar address in `?ws=`, as `dev:web` does. The desktop app's
 * own concerns (sidecar spawn, launch nonce, fatal state) stay in apps/agent-app's smoke test.
 *
 * Run: `pnpm --filter @robota-sdk/agent-gui-web build && pnpm --filter @robota-sdk/agent-gui-web test:e2e`
 * (`pnpm exec playwright install chromium` once, or `PLAYWRIGHT_CHANNEL=chrome` for an installed Chrome).
 */

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import { preview } from 'vite';


/** One line of output (scripts write to the streams directly). */
const line = (text) => `${text}\n`;

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

let failures = 0;
async function scenario(label, run) {
  try {
    await run();
    process.stdout.write(line(`✓ ${label}`));
  } catch (error) {
    failures += 1;
    process.stdout.write(line(`✗ ${label}\n    ${error?.message ?? error}`));
  }
}

const port = await freePort();
const token = randomBytes(32).toString('hex');
const sidecar = spawn(process.execPath, [join(packageRoot, 'e2e', 'scripted-sidecar.mjs')], {
  env: { ...process.env, ROBOTA_WS_TOKEN: token, ROBOTA_WS_PORT: String(port) },
  stdio: ['ignore', 'ignore', 'pipe'],
});
await new Promise((resolve) => sidecar.stderr.once('data', resolve));

const server = await preview({ root: packageRoot, preview: { port: 0, host: '127.0.0.1' } });
const pageUrl = new URL(server.resolvedUrls.local[0]);
pageUrl.searchParams.set('ws', `ws://127.0.0.1:${port}?token=${token}`);

// PLAYWRIGHT_CHANNEL=chrome drives an installed Chrome instead of Playwright's own Chromium build.
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {},
);
const page = await browser.newPage({ viewport: { width: 1100, height: 780 } });
const send = async (text) => {
  await page.getByLabel('message').fill(text);
  await page.getByLabel('message').press('Enter');
};

try {
  await page.goto(pageUrl.href);

  await scenario('connects to the token-gated sidecar and streams a reply', async () => {
    await page.locator('.agent-gui-status[data-status="connected"]').waitFor({ timeout: 20_000 });
    await send('hi there');
    await page.getByText('Hello from the scripted agent.').waitFor({ timeout: 10_000 });
  });

  await scenario('/ opens the command menu with skills; Enter completes, Enter runs', async () => {
    await page.getByLabel('message').fill('/');
    const menu = page.getByRole('listbox', { name: 'commands' });
    await menu.getByText('/parity-demo').waitFor();
    await page.getByLabel('message').fill('/mo');
    await page.getByLabel('message').press('Enter');
    if ((await page.getByLabel('message').inputValue()) !== '/mode ') {
      throw new Error('Enter did not complete the highlighted command');
    }
    await page.getByLabel('message').press('Enter');
    await page.getByText('Permission mode: acceptEdits').waitFor();
  });

  await scenario('the status row shows the session status and follows a change', async () => {
    await page.getByRole('button', { name: 'model: scripted-model' }).waitFor();
    await page.getByRole('button', { name: 'mode: acceptEdits' }).waitFor();
    await page.getByLabel('context 12% used').waitFor();
  });

  await scenario('a long command result is a folded card and the composer stays usable', async () => {
    await send('/help');
    const card = page.getByTestId('command-output').last();
    await card.getByText('Command 1 (/c1)').waitFor();
    await card.getByRole('button', { name: /Show all \d+ lines/ }).waitFor();
    await page.getByLabel('message').fill('still typing');
    await page.getByLabel('message').fill('');
  });

  await scenario('a screen the GUI lacks answers its command once, as an info card', async () => {
    await send('/settings');
    const card = page.locator('[data-testid="command-output"][data-tone="info"]').last();
    await card.getByText(/settings screen is not available/).waitFor();
    if ((await page.getByText('Opening settings...').count()) !== 0) {
      throw new Error('the command reply showed beside the unavailable line');
    }
  });

  await scenario('a finished turn keeps its tool calls as one line that opens', async () => {
    await send('read the file');
    await page.getByText('Read the file.').waitFor();
    await page.getByRole('button', { name: /1 tool call/ }).click();
    await page.getByText('src/a.ts').waitFor();
  });

  await scenario('a permission prompt docks above the composer; 1 allows it', async () => {
    await send('please ask permission');
    await page.getByRole('dialog', { name: 'pending question' }).waitFor();
    await page.keyboard.press('1');
    await page.getByText('Wrote the file.').waitFor();
  });

  await scenario('a provider failure keeps the partial reply and raises a toast', async () => {
    await send('please fail');
    await page.getByRole('alert').getByText('Scripted provider failure').waitFor();
    await page.getByText('Partial reply before failure.').waitFor();
    await page.getByRole('button', { name: 'Dismiss notice' }).click();
  });

  await scenario('the usage dashboard renders the sidecar report without raw content', async () => {
    await page.getByRole('button', { name: 'Usage' }).click();
    await page.getByRole('heading', { name: 'Personal usage' }).waitFor();
    await page.getByText('scripted-model').waitFor();
    await page.getByRole('button', { name: 'Open session usage-e2e-session' }).click();
    await page.getByRole('region', { name: 'Session usage detail' }).getByText('42').waitFor();
    if ((await page.getByText('PROMPT_CONTENT_MUST_NOT_APPEAR').count()) !== 0) {
      throw new Error('dashboard rendered raw persisted content');
    }
  });
} finally {
  if (process.env.CAPTURE_OUT) await page.screenshot({ path: join(process.env.CAPTURE_OUT, 'web-e2e.png') });
  await browser.close();
  await server.close();
  sidecar.kill('SIGTERM');
}

process.stdout.write(line(failures === 0 ? '\nWEB E2E PASSED' : `\nWEB E2E FAILED (${failures})`));
process.exit(failures === 0 ? 0 : 1);
