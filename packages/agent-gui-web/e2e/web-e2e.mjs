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
// The server frames the page receives, by type: a refusal must arrive as its own frame.
const receivedFrameTypes = [];
page.on('websocket', (socket) => {
  socket.on('framereceived', ({ payload }) => {
    const type = /"type":"([a-z_]+)"/.exec(String(payload))?.[1];
    if (type) receivedFrameTypes.push(type);
  });
});
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

  await scenario('/ marks a command the terminal runs with "terminal"', async () => {
    await page.getByLabel('message').fill('/sh');
    const shell = page.getByRole('option', { name: /\/shell/ });
    await shell.getByText('terminal', { exact: true }).waitFor();
    if ((await shell.getAttribute('aria-description')) !== 'Runs in the robota terminal') {
      throw new Error('the terminal-run command does not say where it runs');
    }
    await page.getByLabel('message').fill('');
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
    // Its keys answer only once it is armed, so a key typed for the composer as it appears cannot.
    await page.locator('[role="dialog"][data-armed="true"]').waitFor();
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

  const sidebar = page.getByRole('complementary', { name: 'Sessions' });
  const row = (name) => sidebar.getByRole('button', { name });

  await scenario('the sidebar lists this workspace\'s sessions, the current one marked', async () => {
    await page.getByRole('button', { name: 'Chat' }).click();
    await row(/Scripted e2e session/).waitFor();
    if ((await row(/Scripted e2e session/).getAttribute('aria-current')) !== 'true') {
      throw new Error('the current session is not marked current');
    }
    await row(/What did we decide about the parser\?/).waitFor();
    await row(/Set up the release checklist/).waitFor();
    await sidebar.getByText(/1 session could not be read/).waitFor();
    if ((await sidebar.getByRole('button', { name: /damaged-session/ }).count()) !== 0) {
      throw new Error('an unreadable session is a clickable row');
    }
  });

  await scenario('rows mark live sessions and count the clients other than this one', async () => {
    await row(/Scripted e2e session/).getByTitle('Live in the host').waitFor();
    // This page is the only client on its own session: no "others" there.
    if (/other/.test(await row(/Scripted e2e session/).innerText())) {
      throw new Error('the current row counts this page among the others');
    }
    await row(/Set up the release checklist/).getByText('1 other', { exact: true }).waitFor();
    if ((await row(/What did we decide/).getByTitle('Live in the host').count()) !== 0) {
      throw new Error('a stored-only session is marked live');
    }
  });

  await scenario('a switch refused while a turn runs shows the host\'s reason', async () => {
    await send('stay busy');
    await page.getByText('Working on it...').waitFor();
    await row(/What did we decide about the parser\?/).click();
    await page.getByRole('alert').getByText('Stop the running turn first.').waitFor();
    if ((await page.getByText('We kept the recursive-descent parser.').count()) !== 0) {
      throw new Error('the refused switch changed the transcript');
    }
    if (!receivedFrameTypes.includes('session_change_failed')) {
      throw new Error('the refusal did not arrive as session_change_failed');
    }
    await page.getByRole('button', { name: 'Dismiss notice' }).click();
    await send('all done');
    await page.getByText('Working on it...').last().waitFor();
    await page.getByLabel('message').waitFor();
  });

  await scenario('clicking another session switches the transcript to it', async () => {
    await row(/What did we decide about the parser\?/).click();
    await page.getByText('We kept the recursive-descent parser.').waitFor();
    await page.getByText('Hello from the scripted agent.').waitFor({ state: 'detached' });
    await sidebar.locator('[aria-current="true"]', { hasText: 'What did we decide' }).waitFor();
  });

  await scenario('/resume opens the collapsed sidebar instead of a "not available" line', async () => {
    await page.getByRole('button', { name: 'Hide sessions' }).click();
    await sidebar.waitFor({ state: 'detached' });
    await send('/resume');
    await sidebar.waitFor();
    if ((await page.getByText(/session picker is not available/).count()) !== 0) {
      throw new Error('/resume still printed the unavailable line');
    }
  });

  await scenario('+ New session starts an empty session and lists it', async () => {
    await sidebar.getByRole('button', { name: /New session/ }).first().click();
    await page.getByText(/Session connected\. Send a message/).waitFor();
    await sidebar.locator('[aria-current="true"]', { hasText: 'New session' }).waitFor();
  });
} finally {
  if (process.env.CAPTURE_OUT) await page.screenshot({ path: join(process.env.CAPTURE_OUT, 'web-e2e.png') });
  await browser.close();
  await server.close();
  sidecar.kill('SIGTERM');
}

process.stdout.write(line(failures === 0 ? '\nWEB E2E PASSED' : `\nWEB E2E FAILED (${failures})`));
process.exit(failures === 0 ? 0 : 1);
