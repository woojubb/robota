/**
 * The GUI's user scenarios in a plain browser (Playwright Chromium) — no Electron, no display server.
 *
 * Serves the built app (`vite preview`), starts the deterministic scripted sidecar on a free loopback
 * port, and opens the page with the sidecar address in `?ws=`, as `gui:dev` does. The desktop app's
 * own concerns (sidecar spawn, launch nonce, fatal state) stay in apps/agent-app's smoke test.
 *
 * Run: `pnpm --filter @robota-sdk/agent-gui-web build && pnpm --filter @robota-sdk/agent-gui-web test:e2e`
 * The app-view scenarios require Chromium 158 or later. Set PLAYWRIGHT_EXECUTABLE_PATH to a compatible
 * browser binary, or PLAYWRIGHT_CHANNEL=chrome to use an installed Chrome.
 */

import { loadProductConfig } from '@robota-sdk/product-config/node';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import { preview } from 'vite';


/** One line of output (scripts write to the streams directly). */
const line = (text) => `${text}\n`;

const product = loadProductConfig({ environment: { ...process.env } });
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

const canaryHits = [];
const canary = createHttpServer((request, response) => {
  canaryHits.push(request.url);
  response.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' });
  response.end('canary');
});
await new Promise((resolve) => canary.listen(0, '127.0.0.1', resolve));
const canaryUrl = `http://127.0.0.1:${canary.address().port}`;
const stunPackets = [];
const stunCanary = createSocket('udp4');
stunCanary.on('message', (packet) => stunPackets.push(packet.length));
await new Promise((resolve) => stunCanary.bind(0, '127.0.0.1', resolve));
const stunUrl = `stun:127.0.0.1:${stunCanary.address().port}`;

const port = await freePort();
const token = randomBytes(32).toString('hex');
const sidecar = spawn(process.execPath, [join(packageRoot, 'e2e', 'scripted-sidecar.mjs')], {
  // #3282 §3: starts as a served runtime with no provider configured would — the first scenario below
  // exercises the setup panel and clears it via /provider add, then every later scenario runs exactly
  // as it did before setup mode existed.
  env: {
    ...process.env,
    PRODUCT_CLI_NAME: product.identity.cliName,
    PRODUCT_WS_TOKEN: token,
    PRODUCT_WS_PORT: String(port),
    PRODUCT_E2E_SETUP_REQUIRED: '1',
    PRODUCT_E2E_CANARY_URL: canaryUrl,
  },
  stdio: ['ignore', 'ignore', 'pipe'],
});
await new Promise((resolve) => sidecar.stderr.once('data', resolve));

const server = await preview({ root: packageRoot, preview: { port: 0, host: '127.0.0.1' } });
const pageUrl = new URL(server.resolvedUrls.local[0]);
pageUrl.searchParams.set('ws', `ws://127.0.0.1:${port}?token=${token}`);

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
    : process.env.PLAYWRIGHT_CHANNEL
      ? { channel: process.env.PLAYWRIGHT_CHANNEL }
      : {},
);
process.stdout.write(line(`Browser: Chromium ${browser.version()}`));
const page = await browser.newPage({ viewport: { width: 1100, height: 780 } });
// #3289 §2: the copy-code-block scenario reads the clipboard back to check what was copied.
await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: pageUrl.origin });
// The server frames the page receives, by type: a refusal must arrive as its own frame.
const receivedFrameTypes = [];
const sentFrames = [];
page.on('websocket', (socket) => {
  socket.on('framesent', ({ payload }) => {
    sentFrames.push(JSON.parse(String(payload)));
  });
  socket.on('framereceived', ({ payload }) => {
    const type = /"type":"([a-z_]+)"/.exec(String(payload))?.[1];
    if (type) receivedFrameTypes.push(type);
  });
});
const policyMessages = [];
page.on('console', (message) => {
  if (/Content Security Policy|Refused to/u.test(message.text())) policyMessages.push(message.text());
});
const send = async (text) => {
  await page.getByLabel('message').fill(text);
  await page.getByLabel('message').press('Enter');
};
/** Settings applies at once (no Save) — poll until the server's fresh snapshot lands. */
const waitForSelectValue = async (locator, value, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await locator.inputValue()) === value) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`select never reached value "${value}"`);
};
/** Same idea as {@link waitForSelectValue}, for a `role="switch"` control's `aria-checked`. */
const waitForSwitchChecked = async (locator, checked, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await locator.getAttribute('aria-checked')) === String(checked)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`switch never reached aria-checked="${checked}"`);
};

/**
 * #3289 §2 — the composer's own center point must resolve to the composer itself, not the narrow
 * session sheet (or its backdrop) sitting over it. `CAPTURE_OUT`, when set, gets a screenshot per
 * label for the PR to point at.
 */
const expectComposerUncovered = async (label) => {
  const composer = page.getByLabel('message');
  await composer.waitFor();
  const box = await composer.boundingBox();
  if (!box) throw new Error(`${label}: the composer has no bounding box`);
  const point = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  const covered = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return !el || !el.closest('[aria-label="message"]');
  }, point);
  if (covered) throw new Error(`${label}: the composer is covered at its own center point`);
  if (process.env.CAPTURE_OUT) {
    await page.screenshot({ path: join(process.env.CAPTURE_OUT, `composer-${label}.png`) });
  }
};

try {
  await page.goto(pageUrl.href);

  await scenario(
    'first run: the setup panel replaces the composer until /provider add configures one (#3282 §3)',
    async () => {
      await page.locator('.agent-gui-status[data-status="connected"]').waitFor({ timeout: 20_000 });
      await page.getByRole('heading', { name: 'Connect a model provider to start.' }).waitFor();
      if ((await page.getByLabel('message').count()) !== 0) {
        throw new Error('the composer is present while setup is required');
      }
      await page.getByRole('button', { name: 'Set up provider' }).click();
      // The question docks where the composer would be — there is no composer yet to dock above.
      const dialog = page.locator('[role="dialog"][aria-label="pending question"]');
      await dialog.waitFor();
      await page.getByText('Provider model').waitFor();
      const field = page.getByPlaceholder('scripted-model');
      await field.fill('scripted-provider-model');
      await field.press('Enter');
      await page
        .getByRole('heading', { name: 'Connect a model provider to start.' })
        .waitFor({ state: 'detached' });
      // Setup is over: the composer is how a turn starts again, live, with no restart or reload.
      await page.getByLabel('message').waitFor();
    },
  );

  await scenario('connects to the token-gated sidecar and streams a reply', async () => {
    await page.locator('.agent-gui-status[data-status="connected"]').waitFor({ timeout: 20_000 });
    await send('hi there');
    await page.getByText('Hello from the scripted agent.').waitFor({ timeout: 10_000 });
  });

  await scenario(
    '#3282 §4e: / opens the command menu with a Commands group and a Skills group, and Enter completes/runs',
    async () => {
      await page.getByLabel('message').fill('/');
      const menu = page.getByRole('listbox', { name: 'commands' });
      await menu.getByText('Commands', { exact: true }).waitFor();
      await menu.getByText('Skills', { exact: true }).waitFor();
      await menu.getByText('/parity-demo').waitFor();
      await page.getByLabel('message').fill('/mo');
      await page.getByLabel('message').press('Enter');
      if ((await page.getByLabel('message').inputValue()) !== '/mode ') {
        throw new Error('Enter did not complete the highlighted command');
      }
      await page.getByLabel('message').press('Enter');
      await page.getByText('Permission mode: acceptEdits').waitFor();
    },
  );

  await scenario(
    '#3282 §4e: a command the GUI cannot run at all is left out of the menu entirely',
    async () => {
      await page.getByLabel('message').fill('/sh');
      if ((await page.getByRole('option', { name: /\/shell/ }).count()) !== 0) {
        throw new Error('an excluded command still showed in the menu');
      }
      await page.getByLabel('message').fill('');
    },
  );

  await scenario('#3282 §4e: typing /theme by hand shows its plain sentence, never "not available"', async () => {
    await send('/theme');
    await page.getByText('This app follows your system appearance.').waitFor();
    if ((await page.getByText(/not available on this surface/).count()) !== 0) {
      throw new Error('/theme still printed the "not available" line');
    }
  });

  await scenario('#3282 §4e: /help opens the Help sheet instead of a terminal-style text list', async () => {
    // An earlier scenario (/theme) already left its own info card in the conversation — the count
    // must not GROW, not "must be zero" (#3282 §4e: excluded commands render the same card kind).
    const cardsBefore = await page.getByTestId('command-output').count();
    await send('/help');
    const sheet = page.getByRole('dialog', { name: 'Help' });
    await sheet.waitFor();
    await sheet.getByText('Commands', { exact: true }).waitFor();
    await sheet.getByText('Shortcuts', { exact: true }).waitFor();
    const cardsAfter = await page.getByTestId('command-output').count();
    if (cardsAfter !== cardsBefore) {
      throw new Error(
        `/help still printed the old terminal-style text list (${cardsBefore} → ${cardsAfter} command cards)`,
      );
    }
    await sheet.getByRole('button', { name: 'Close Help' }).click();
    await sheet.waitFor({ state: 'detached' });
  });

  await scenario('the status row shows the session status and follows a change', async () => {
    await page.getByRole('button', { name: 'model: scripted-model' }).waitFor();
    await page.getByRole('button', { name: 'mode: acceptEdits' }).waitFor();
    await page.getByLabel('context 12% used').waitFor();
  });

  await scenario('#3282 §4d: the attach button (paperclip) is present, with an accessible name', async () => {
    await page.getByRole('button', { name: 'Attach files' }).waitFor();
  });

  await scenario(
    '#3282 §4d: a plain-browser attach attempt shows the plain sentence, and adds no chip',
    async () => {
      // A plain browser page has no real filesystem path for a `File` (no Electron bridge) — every
      // pick, even the hidden HTML file input the attach button falls back to, is refused the same way.
      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles({
        name: 'photo.png',
        mimeType: 'image/png',
        buffer: Buffer.from('not a real image, just e2e bytes'),
      });
      await page.getByText('Only files inside this project folder can be attached.').waitFor();
      if ((await page.getByRole('list', { name: 'attachments' }).count()) !== 0) {
        throw new Error('a plain-browser pick added a chip despite having no real path');
      }
    },
  );

  await scenario(
    'switching model from the model control (#3282 §2) changes the next reply\'s model',
    async () => {
      await page.getByRole('button', { name: 'model: scripted-model' }).click();
      const menu = page.getByRole('menu', { name: 'Model' });
      await menu.waitFor();
      await menu.getByRole('menuitemradio', { name: 'Scripted Model 2' }).click();
      await page.getByRole('button', { name: 'model: scripted-model-2' }).waitFor();

      await send('hi there');
      await page.getByText('(model: scripted-model-2)').waitFor({ timeout: 10_000 });

      // Restore for every scenario below that assumes the original scripted model.
      await page.getByRole('button', { name: 'model: scripted-model-2' }).click();
      await page
        .getByRole('menu', { name: 'Model' })
        // exact: 'Scripted Model' is a substring of 'Scripted Model 2' — Playwright's name match is
        // substring by default, and both items are in this menu at once.
        .getByRole('menuitemradio', { name: 'Scripted Model', exact: true })
        .click();
      await page.getByRole('button', { name: 'model: scripted-model' }).waitFor();
    },
  );

  await scenario('a long command result is a folded card and the composer stays usable', async () => {
    // Not `/help` — #3282 §4e made that one the GUI's own Help sheet, never sent to the session.
    await send('/context');
    const card = page.getByTestId('command-output').last();
    await card.getByText('Command 1 (/c1)').waitFor();
    await card.getByRole('button', { name: /Show all \d+ lines/ }).waitFor();
    await page.getByLabel('message').fill('still typing');
    await page.getByLabel('message').fill('');
  });

  await scenario('/settings opens the Settings screen instead of the "not available" line', async () => {
    await send('/settings');
    await page.getByRole('dialog', { name: 'Settings' }).waitFor();
    if ((await page.getByText(/settings screen is not available/).count()) !== 0) {
      throw new Error('/settings still printed the unavailable line');
    }
    await page.getByRole('button', { name: 'Close Settings' }).click();
    await page.getByRole('dialog', { name: 'Settings' }).waitFor({ state: 'detached' });
  });

  await scenario(
    'the gear opens Settings; a change to the output style persists across close and reopen',
    async () => {
      await page.getByRole('button', { name: 'Settings' }).click();
      await page.getByRole('dialog', { name: 'Settings' }).waitFor();
      const outputStyle = page.getByLabel('Output style');
      if ((await outputStyle.inputValue()) !== 'default') {
        throw new Error('the output style did not start at its current value');
      }
      await outputStyle.selectOption('concise');
      await waitForSelectValue(outputStyle, 'concise');

      await page.getByRole('button', { name: 'Close Settings' }).click();
      await page.getByRole('dialog', { name: 'Settings' }).waitFor({ state: 'detached' });

      await page.getByRole('button', { name: 'Settings' }).click();
      await page.getByRole('dialog', { name: 'Settings' }).waitFor();
      if ((await page.getByLabel('Output style').inputValue()) !== 'concise') {
        throw new Error('the output style did not persist across reopen');
      }
      await page.getByRole('button', { name: 'Close Settings' }).click();
      await page.getByRole('dialog', { name: 'Settings' }).waitFor({ state: 'detached' });
    },
  );

  await scenario(
    'Settings → Providers & Models: switching the active profile\'s model changes the next reply (#3282 §4b)',
    async () => {
      // Scoped to the dialog throughout: the status row's own "model: …" chip sits underneath the
      // modal, still in the DOM, and its accessible name also contains "Model" — an unscoped
      // getByRole('button', { name: 'Model' }) would match both and fail Playwright's strict mode.
      // `exact: true` on the "Model" button itself for the same reason: the section nav button
      // "Providers & Models" also contains "Model" as a substring.
      const settingsDialog = page.getByRole('dialog', { name: 'Settings' });

      await page.getByRole('button', { name: 'Settings' }).click();
      await settingsDialog.waitFor();
      await settingsDialog.getByRole('button', { name: 'Providers & Models' }).click();
      await settingsDialog.getByText('Scripted · Scripted Model', { exact: true }).waitFor();

      await settingsDialog.getByRole('button', { name: 'Model', exact: true }).click();
      const modelMenu = page.getByRole('menu', { name: 'Models for scripted' });
      await modelMenu.waitFor();
      await modelMenu.getByRole('menuitemradio', { name: 'Scripted Model 2' }).click();
      // Settings applies at once — the row reflects the fresh snapshot without closing the dialog.
      await settingsDialog.getByText('Scripted · Scripted Model 2', { exact: true }).waitFor();

      await settingsDialog.getByRole('button', { name: 'Close Settings' }).click();
      await settingsDialog.waitFor({ state: 'detached' });

      await send('hi there');
      // .last(): an earlier scenario already produced one "(model: scripted-model-2)" reply.
      await page.getByText('(model: scripted-model-2)').last().waitFor({ timeout: 10_000 });

      // Restore for every scenario below that assumes the original scripted model, through Settings
      // again (not the status row) — proof the two controls stay in agreement either way. A Settings
      // change alone never refreshes the status chip (only a command sent through the composer does,
      // via the `command_result` -> `get-status` refresh) — a second reply is what proves the restore
      // reached the session, and it is what brings the chip back in step for later scenarios.
      await page.getByRole('button', { name: 'Settings' }).click();
      await settingsDialog.waitFor();
      await settingsDialog.getByRole('button', { name: 'Providers & Models' }).click();
      await settingsDialog.getByRole('button', { name: 'Model', exact: true }).click();
      await modelMenu.waitFor();
      await modelMenu
        // exact: 'Scripted Model' is a substring of 'Scripted Model 2', both present in this menu.
        .getByRole('menuitemradio', { name: 'Scripted Model', exact: true })
        .click();
      await settingsDialog.getByText('Scripted · Scripted Model', { exact: true }).waitFor();
      await settingsDialog.getByRole('button', { name: 'Close Settings' }).click();
      await settingsDialog.waitFor({ state: 'detached' });

      await send('hi again');
      await page.getByText('(model: scripted-model)').last().waitFor({ timeout: 10_000 });
      await page.getByRole('button', { name: 'model: scripted-model' }).waitFor();
    },
  );

  await scenario(
    'Settings → MCP Servers: lists the scripted server and its switch sends a typed update (#3282 §4 part b-2)',
    async () => {
      await page.getByRole('button', { name: 'Settings' }).click();
      await page.getByRole('dialog', { name: 'Settings' }).waitFor();
      await page.getByRole('button', { name: 'MCP Servers' }).click();
      await page.getByText('docs').waitFor();
      await page.getByText(/This project/).waitFor();
      const serverSwitch = page.getByRole('switch', { name: 'docs' });
      if ((await serverSwitch.getAttribute('aria-checked')) !== 'true') {
        throw new Error('the docs server did not start enabled');
      }
      await serverSwitch.click();
      await waitForSwitchChecked(serverSwitch, false);

      await page.getByRole('button', { name: 'Close Settings' }).click();
      await page.getByRole('dialog', { name: 'Settings' }).waitFor({ state: 'detached' });
    },
  );

  await scenario('Settings → Plugins: shows the one installed plugin (#3282 §4 part b-2)', async () => {
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('dialog', { name: 'Settings' }).waitFor();
    await page.getByRole('button', { name: 'Plugins' }).click();
    await page.getByText('formatter@example').waitFor();
    await page.getByText('Formats code on save.').waitFor();

    await page.getByRole('button', { name: 'Close Settings' }).click();
    await page.getByRole('dialog', { name: 'Settings' }).waitFor({ state: 'detached' });
  });

  await scenario('/plugin opens the Settings screen on Plugins, not the "not available" line', async () => {
    await send('/plugin');
    await page.getByRole('dialog', { name: 'Settings' }).waitFor();
    if ((await page.getByText(/plugin manager is not available/).count()) !== 0) {
      throw new Error('/plugin still printed the unavailable line');
    }
    await page.getByText('formatter@example').waitFor();

    await page.getByRole('button', { name: 'Close Settings' }).click();
    await page.getByRole('dialog', { name: 'Settings' }).waitFor({ state: 'detached' });
  });

  await scenario(
    '#3282 §4 part b-3: /agent opens the switcher; choosing an agent shows a plain confirmation, not a card',
    async () => {
      await send('/agent');
      await page.getByRole('dialog', { name: 'Switch agent' }).waitFor();
      // Not getByText: general-purpose's own description ("General-purpose task execution
      // agent.") contains the same text, so a plain text match is ambiguous — the row is one
      // button whose accessible name starts with the agent's name.
      await page.getByRole('button', { name: /^general-purpose\b/ }).waitFor();
      const explore = page.getByRole('button', { name: /Explore/ });
      await explore.waitFor();
      if ((await explore.getAttribute('aria-current')) !== null) {
        throw new Error('Explore was checked before it was chosen');
      }
      await explore.click();
      await page.getByRole('status').filter({ hasText: 'Default agent: Explore' }).waitFor();
      // The checked row follows the switch, and no conversation card was added for it.
      if ((await explore.getAttribute('aria-current')) !== 'true') {
        throw new Error('Explore was not checked after being chosen');
      }
      if ((await page.getByText('Default agent: Explore', { exact: false }).count()) > 1) {
        throw new Error('the switch also added a conversation card, not just the sheet confirmation');
      }
      await page.getByRole('button', { name: 'Close' }).click();
      await page.getByRole('dialog', { name: 'Switch agent' }).waitFor({ state: 'detached' });
    },
  );

  await scenario(
    '#3282 §4 part b-3: the Agents panel shows one schedule, and Delete (confirmed) removes it',
    async () => {
      await page.getByText('Scheduled').waitFor();
      await page.getByText('check the nightly build').waitFor();
      await page.getByRole('button', { name: 'Delete…' }).click();
      // #3282 §4e: a destructive ConfirmDialog is an alertdialog, not a plain dialog.
      await page.getByRole('alertdialog', { name: 'Delete this schedule?' }).waitFor();
      await page.getByRole('button', { name: 'Delete', exact: true }).click();
      await page.getByText('check the nightly build').waitFor({ state: 'detached' });
    },
  );

  await scenario(
    '#3282 §4 part b-3: the Agents panel shows the current goal, and Cancel goal stops it',
    async () => {
      await send('set a goal');
      // Scoped to the Agents panel: the pre-existing GoalBar (#3307, docked above the composer,
      // `aria-label="goal"`) shows the same objective text while the goal is active, so a bare
      // page-wide text match is ambiguous between the two.
      const agentsPanel = page.getByRole('complementary', { name: 'Agents' });
      await agentsPanel.getByText('Land the release notes').waitFor();
      await agentsPanel.getByText('Active', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Cancel goal' }).click();
      await page.getByRole('button', { name: 'Cancel goal' }).waitFor({ state: 'detached' });
      await agentsPanel.getByText('Cancelled', { exact: true }).waitFor();
    },
  );

  await scenario('a finished turn keeps its tool calls as one line that opens', async () => {
    await send('read the file');
    await page.getByText('Read the file.').waitFor();
    await page.getByRole('button', { name: /1 tool call/ }).click();
    await page.getByText('src/a.ts').waitFor();
  });

  await scenario('#3288: an Edit row expands to show its diff', async () => {
    await send('edit it');
    await page.getByText('Edited the title.').waitFor();
    await page.getByRole('button', { name: /1 tool call/ }).last().click();
    // Matched on "Edit <path>", not "Edit" alone (the status bar's "mode: acceptEdits" button also
    // matches /Edit/ as a substring) and not the path alone (the Changed files row repeats it too).
    const toolRow = page.getByRole('button', { name: /Edit src\/task-title\.ts/ });
    await toolRow.waitFor();
    await toolRow.click();
    await page.getByText(/const title = 'new';/).waitFor();
    await page.getByText(/const title = 'old';/).waitFor();
  });

  await scenario('#3288: a Shell row expands to show its output and exit status', async () => {
    await send('run tests');
    await page.getByText('Tests passed.').waitFor();
    await page.getByRole('button', { name: /1 tool call/ }).last().click();
    const toolRow = page.getByRole('button', { name: /pnpm test/ });
    await toolRow.waitFor();
    await toolRow.click();
    await page.getByText(/^Test Files\s+1 passed/u).waitFor();
    await page.getByText(/exit 0/).waitFor();
  });

  const appBase = new URL(server.resolvedUrls.local[0]);
  const appFrame = page.getByTestId('app-view-frame');
  const appView = page.frameLocator('[data-testid="app-view-frame"]').frameLocator('iframe');
  const permissionPrompt = page.locator('[role="dialog"][aria-label="pending question"]');

  await scenario(
    '#3558: the built page admits its own origin as a frame, and the sandbox page ships with a policy of its own',
    async () => {
      const policyOf = (documentText) =>
        [...documentText.matchAll(/<meta\b[^>]*http-equiv="Content-Security-Policy"[^>]*>/gu)].map(
          (meta) => /content="([^"]*)"/u.exec(meta[0])?.[1]?.replaceAll('&#39;', "'"),
        );
      const index = await (await fetch(appBase)).text();
      const [pagePolicy, ...otherPagePolicies] = policyOf(index);
      if (otherPagePolicies.length !== 0 || !pagePolicy?.includes("frame-src 'self'")) {
        throw new Error(`the page policy lacks frame-src 'self': ${pagePolicy}`);
      }
      if (!pagePolicy.includes("script-src 'self'")) {
        throw new Error(`the page policy lost script-src 'self': ${pagePolicy}`);
      }
      const sandboxResponse = await fetch(new URL('app-sandbox.html?e2e=policy', appBase));
      if (sandboxResponse.headers.get('connection-allowlist') !== '()') {
        throw new Error('the sandbox response does not block native network connections');
      }
      if ((await fetch(appBase)).headers.has('connection-allowlist')) {
        throw new Error('the app sandbox connection restriction leaked onto the host page');
      }
      const sandboxPage = await sandboxResponse.text();
      const sandboxPolicies = policyOf(sandboxPage);
      if (sandboxPolicies.length !== 1) {
        throw new Error(`the sandbox page has ${sandboxPolicies.length} policies, expected its own alone`);
      }
      if (
        sandboxPolicies[0] !==
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
      ) {
        throw new Error(`the sandbox page policy is not its own: ${sandboxPolicies[0]}`);
      }
    },
  );

  for (const version of ['156.0.0.0', '157.0.8093.0', '157.0.8103.6', '157.0.0.0']) {
    await scenario(
      `#3558: Chromium ${version} refuses app HTML and never announces readiness`,
      async () => {
        const context = await browser.newContext({
          userAgent: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`,
        });
        const oldPage = await context.newPage();
        try {
          await oldPage.route('**/e2e-old-browser.html', (route) => route.fulfill({
            contentType: 'text/html',
            body: '<!doctype html><script>window.appMessages=[];addEventListener("message",event=>appMessages.push(event.data))</script><iframe id="unsupported-app" sandbox="allow-scripts" src="/app-sandbox.html"></iframe>',
          }));
          await oldPage.goto(new URL('e2e-old-browser.html', appBase).href);
          const unsupported = oldPage.frameLocator('#unsupported-app');
          await unsupported.getByText(
            'App views are unavailable because this browser cannot enforce their network isolation.',
            { exact: true },
          ).waitFor();
          await oldPage.evaluate(() => {
            document.querySelector('#unsupported-app').contentWindow.postMessage({
              jsonrpc: '2.0',
              method: 'ui/notifications/sandbox-resource-ready',
              params: { html: '<script>parent.postMessage({ escaped: true }, "*")</script>' },
            }, '*');
          });
          await oldPage.waitForTimeout(100);
          if (await unsupported.locator('iframe').count()) {
            throw new Error('an unsupported browser admitted an app document');
          }
          const messages = await oldPage.evaluate(() => window.appMessages);
          if (messages.some((message) => message?.method === 'ui/notifications/sandbox-proxy-ready')) {
            throw new Error('an unsupported browser announced readiness');
          }
          if (messages.some((message) => message?.escaped === true)) {
            throw new Error('an unsupported browser executed app HTML');
          }
        } finally {
          await context.close();
        }
      },
    );
  }

  await scenario(
    '#3558: the sandbox page refuses to run on its own, and when its host forgot the sandbox attribute',
    async () => {
      const lone = await browser.newPage();
      try {
        await lone.goto(new URL('app-sandbox.html', appBase).href);
        await lone.getByText('This page only runs inside an app frame.').waitFor();
        await lone.route('**/e2e-unsandboxed.html', (route) =>
          route.fulfill({
            contentType: 'text/html',
            body: '<!doctype html><iframe id="f" src="/app-sandbox.html"></iframe>',
          }),
        );
        await lone.goto(new URL('e2e-unsandboxed.html', appBase).href);
        await lone.frameLocator('#f').getByText('This page must run in a sandboxed frame.').waitFor();
      } finally {
        await lone.close();
      }
    },
  );

  await scenario('#3558: the canary sees a direct request (the control for the sandbox checks)', async () => {
    await (await fetch(`${canaryUrl}/control`)).text();
    if (!canaryHits.includes('/control')) throw new Error('the canary did not record a request');
    canaryHits.length = 0;
  });

  await scenario('#3558: a browser without the sandbox policy reaches the UDP STUN canary', async () => {
    const control = await browser.newPage();
    try {
      await control.goto(`${canaryUrl}/rtc-control`);
      await control.evaluate(async ({ url, httpControl }) => {
        await fetch(httpControl);
        const peer = new RTCPeerConnection({ iceServers: [{ urls: url }], iceCandidatePoolSize: 1 });
        try {
          peer.createDataChannel('network-control');
          await peer.setLocalDescription(await peer.createOffer());
          await new Promise((resolve) => setTimeout(resolve, 1500));
        } finally {
          peer.close();
        }
      }, { url: stunUrl, httpControl: `${canaryUrl}/browser-fetch-control` });
      if (!canaryHits.includes('/browser-fetch-control')) {
        throw new Error('the browser did not reach the HTTP canary');
      }
      if (stunPackets.length === 0) throw new Error('the UDP canary did not receive a browser STUN packet');
      process.stdout.write(line(`STUN control packets: ${stunPackets.length}`));
    } finally {
      await control.close();
      await page.waitForTimeout(100);
      stunPackets.length = 0;
      canaryHits.length = 0;
    }
  });

  await scenario('#3558: a tool call without an app view shows no frame', async () => {
    if ((await appFrame.count()) !== 0) throw new Error('a frame showed for a call with no app view');
    if ((await page.getByText(/returned an app view/u).count()) !== 0) {
      throw new Error('a plain line about an app view showed for a call with none');
    }
  });

  await scenario(
    '#3558: a finished call’s app view shows below the collapsed group and blocks fetch, images and nested frames',
    async () => {
      await send('show app view');
      await page.getByText('Opened the app view.').waitFor();
      const group = page.getByRole('button', { name: /2 tool calls/u }).last();
      await group.waitFor();
      await appFrame.waitFor();
      if ((await appFrame.count()) !== 1) throw new Error('expected exactly one app frame');
      if ((await group.getAttribute('aria-expanded')) !== 'false') {
        throw new Error('the group was open: the app should show without opening it');
      }
      await page.getByText('App from e2e-apps', { exact: true }).waitFor();

      if ((await appFrame.getAttribute('sandbox')) !== 'allow-scripts') {
        throw new Error(`sandbox attribute is ${await appFrame.getAttribute('sandbox')}`);
      }
      if ((await appFrame.getAttribute('allow')) !== null) throw new Error('the frame has an allow attribute');
      if ((await appFrame.getAttribute('referrerpolicy')) !== 'no-referrer') {
        throw new Error('the frame leaks a referrer');
      }

      await appView.locator('body[data-ready="true"]').waitFor({ timeout: 20_000 });
      await appView.locator('#title').getByText('E2E app view').waitFor();
      await appView.locator('#input').getByText('"path":"src"').waitFor();
      const result = await appView.locator('#result').textContent();
      if (!result?.includes('Opened the e2e app.') || !result.includes('"rows":3')) {
        throw new Error(`the view got ${result}`);
      }

      await appView.locator('#probe-top').getByText('top: blocked').waitFor();
      await appView.locator('#probe-parent').getByText('parent: blocked').waitFor();
      await appView.locator('#probe-fetch').getByText('fetch: blocked').waitFor();
      await appView.locator('#probe-image').getByText('image: blocked').waitFor();
      await appView.locator('#probe-open-link').getByText('open-link: refused -32601').waitFor();
      const violations = (await appView.locator('#violations').textContent()) ?? '';
      for (const directive of ['connect-src', 'img-src', 'frame-src']) {
        if (!violations.includes(directive)) {
          throw new Error(`the view's sandbox did not report ${directive}: ${violations}`);
        }
      }
      await page.waitForTimeout(300);
      if (canaryHits.length !== 0) {
        throw new Error(`an app resource probe reached the canary: ${canaryHits.join(', ')}`);
      }

      const wanted = await appView.locator('body').evaluate((body) =>
        Math.ceil(body.getBoundingClientRect().height),
      );
      const shown = (await appFrame.boundingBox())?.height ?? 0;
      if (Math.abs(shown - Math.min(640, Math.max(48, wanted))) > 3) {
        throw new Error(`the frame is ${shown}px tall; the view asked for ${wanted}px`);
      }

      await group.click();
      await page.getByRole('button', { name: /^mcp__e2e_apps__echo browse/u }).waitFor();
      if ((await appFrame.count()) !== 1) throw new Error('opening the group duplicated the frame');
      await group.click();

      const refusedOwnFrame = policyMessages.filter(
        (message) => /Refused to frame/u.test(message) && /app-sandbox\.html|about:srcdoc/u.test(message),
      );
      if (refusedOwnFrame.length !== 0) throw new Error(refusedOwnFrame.join('\n'));
    },
  );

  await scenario('#3558: the app frame cannot send STUN through WebRTC', async () => {
    const configurations = await appView.locator('body').evaluate(async (_body, url) => {
      const peer = new RTCPeerConnection({ iceServers: [{ urls: url }], iceCandidatePoolSize: 1 });
      try {
        const created = peer.getConfiguration().iceServers;
        peer.setConfiguration({ iceServers: [{ urls: url }], iceCandidatePoolSize: 1 });
        const changed = peer.getConfiguration().iceServers;
        peer.createDataChannel('network-probe');
        await peer.setLocalDescription(await peer.createOffer());
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return { created, changed };
      } finally {
        peer.close();
      }
    }, stunUrl);
    if (configurations.created.length !== 0 || configurations.changed.length !== 0) {
      throw new Error(`the browser retained forbidden ICE servers: ${JSON.stringify(configurations)}`);
    }
    if (stunPackets.length !== 0) {
      throw new Error(`the app sent ${stunPackets.length} UDP packets to the STUN canary`);
    }
    process.stdout.write(line('STUN app packets: 0'));
  });

  await scenario(
    '#3558: messages from the parent and a sibling cannot impersonate an app or replace its resource',
    async () => {
      const before = sentFrames.length;
      const originalResult = await appView.locator('#result').textContent();
      await page.evaluate(async () => {
        const outer = document.querySelector('[data-testid="app-view-frame"]');
        const sibling = document.createElement('iframe');
        sibling.id = 'foreign-app-message-source';
        sibling.name = 'foreign-app-message-source';
        sibling.src = 'about:blank';
        const loaded = new Promise((resolve) => sibling.addEventListener('load', resolve, { once: true }));
        document.body.appendChild(sibling);
        await loaded;
        const forgedCall = {
          jsonrpc: '2.0',
          id: 'foreign-parent-call',
          method: 'tools/call',
          params: { name: 'echo', arguments: { text: 'forged' } },
        };
        window.postMessage(forgedCall, '*');
        window.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/sandbox-proxy-ready' }, '*');
        outer.contentWindow.postMessage(forgedCall, '*');
      });
      try {
        const sibling = page.frames().find((frame) => frame.name() === 'foreign-app-message-source');
        if (!sibling) throw new Error('the foreign source frame was not created');
        await sibling.evaluate(() => {
          const forgedCall = {
            jsonrpc: '2.0',
            id: 'foreign-sibling-call',
            method: 'tools/call',
            params: { name: 'echo', arguments: { text: 'forged' } },
          };
          const outer = window.parent.document.querySelector('[data-testid="app-view-frame"]');
          window.parent.postMessage(forgedCall, '*');
          outer.contentWindow.postMessage(forgedCall, '*');
          outer.contentWindow.postMessage({
            jsonrpc: '2.0',
            method: 'ui/notifications/sandbox-resource-ready',
            params: { html: '<body id="foreign-resource">Replaced by a sibling</body>' },
          }, '*');
        });
        await page.waitForTimeout(300);
        const appRequests = sentFrames.slice(before).filter(
          (frame) => frame.type === 'call-app-tool' || frame.type === 'read-app-view',
        );
        if (appRequests.length !== 0) {
          throw new Error(`a foreign window triggered app requests: ${JSON.stringify(appRequests)}`);
        }
        if (await permissionPrompt.count()) throw new Error('a foreign window raised a permission prompt');
        if ((await appFrame.count()) !== 1) throw new Error('a foreign window replaced the app frame');
        if ((await appView.locator('#result').textContent()) !== originalResult) {
          throw new Error('a foreign window changed the app document');
        }
      } finally {
        await page.locator('#foreign-app-message-source').evaluate((frame) => frame.remove());
      }
    },
  );

  await scenario(
    '#3558: a tool call from the view raises the GUI permission prompt; Deny shows the denial, Allow the result',
    async () => {
      const before = sentFrames.length;
      await appView.getByRole('button', { name: 'Call echo' }).click();
      await permissionPrompt.waitFor();
      await permissionPrompt.getByText('mcp__e2e_apps__echo').waitFor();
      await permissionPrompt.getByRole('button', { name: 'Deny', exact: true }).click();
      await appView
        .locator('#call-result')
        .getByText('call: error Permission denied for mcp__e2e_apps__echo')
        .waitFor();
      await permissionPrompt.waitFor({ state: 'detached' });

      await appView.getByRole('button', { name: 'Call echo' }).click();
      await permissionPrompt.waitFor();
      await permissionPrompt.getByRole('button', { name: 'Allow', exact: true }).click();
      await appView.locator('#call-result').getByText('call: ok echo: hi').waitFor();
      await permissionPrompt.waitFor({ state: 'detached' });
      const appCalls = sentFrames.slice(before).filter((frame) => frame.type === 'call-app-tool');
      const viewRead = sentFrames.findLast((frame) => frame.type === 'read-app-view');
      if (!viewRead?.viewId || appCalls.length !== 2 || appCalls.some(
        (frame) => frame.viewId !== viewRead.viewId || frame.name !== 'mcp__e2e_apps__echo',
      )) {
        throw new Error(`the real app did not send two view-scoped calls: ${JSON.stringify(appCalls)}`);
      }
      if (canaryHits.length !== 0) {
        throw new Error(`an app resource probe reached the canary: ${canaryHits.join(', ')}`);
      }
    },
  );

  await scenario(
    '#3558: after a reload the turn is replayed as text, with no frame',
    async () => {
      await page.reload();
      await page.locator('.agent-gui-status[data-status="connected"]').waitFor({ timeout: 20_000 });
      await page.getByText('Opened the app view.').waitFor();
      if ((await appFrame.count()) !== 0) throw new Error('a replayed turn showed a frame');
    },
  );

  await scenario(
    '#3289 §2: wheel-scrolling up mid-stream stops auto-scroll, and "Jump to latest" returns to it',
    async () => {
      await send('give me a long reply');
      await page.getByText('Paragraph 3 of the long reply').waitFor();

      const conversation = page.getByRole('main', { name: 'Conversation' });
      await conversation.hover();
      await page.mouse.wheel(0, -4000);
      await page.waitForTimeout(150); // let the scroll (and its handler) settle before measuring it

      const scrolledTo = await conversation.evaluate((el) => el.scrollTop);
      await page.getByRole('button', { name: 'Jump to latest' }).waitFor();

      // More of the reply streams in while scrolled away — the view must stay exactly there.
      await page.getByText('Paragraph 12 of the long reply').waitFor({ timeout: 10_000 });
      const stillAt = await conversation.evaluate((el) => el.scrollTop);
      if (Math.abs(stillAt - scrolledTo) > 2) {
        throw new Error(
          `the view moved on its own while streaming after a manual scroll (${scrolledTo} -> ${stillAt})`,
        );
      }

      await page.getByRole('button', { name: 'Jump to latest' }).click();
      // Pinning resumed: the rest of the reply keeps the view at the bottom, and the button goes away
      // once it finishes there.
      await page.getByText('Paragraph 20 of the long reply').waitFor({ timeout: 10_000 });
      await page.getByRole('button', { name: 'Jump to latest' }).waitFor({ state: 'detached' });
    },
  );

  await scenario('#3289 §2: copying a code block puts its text on the clipboard', async () => {
    await send('show code please');
    await page.getByText('Here you go:').waitFor();
    const copyButton = page.getByRole('button', { name: 'Copy code' });
    await copyButton.hover();
    await copyButton.click();
    // The "Copied" feedback lives in a visually-hidden aria-live region (not the button's own visible,
    // constant label) — attached, not "visible", is the right wait here.
    await page.locator('[role="status"]', { hasText: 'Copied' }).waitFor({ state: 'attached' });
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    if (!clipboardText.includes('function greet(name)')) {
      throw new Error(`clipboard did not hold the code block's own text: ${JSON.stringify(clipboardText)}`);
    }
  });

  await scenario(
    '#3288 §2: after a reload, an earlier turn\'s Edit diff and Shell output are still expandable',
    async () => {
      // A fresh page load re-requests the transcript from scratch — no live stream to rebuild these
      // rows from, only the server's history-display projection (`getMessagesDisplay`). Proves the
      // #3288 §2 gap this closes: before it, a reload showed the same replies as plain text bubbles,
      // with every tool row, diff and "Changed files" line gone.
      await page.reload();
      await page.locator('.agent-gui-status[data-status="connected"]').waitFor({ timeout: 20_000 });
      await page.getByText('Edited the title.').waitFor();
      await page.getByText('Tests passed.').waitFor();

      // Each of the three earlier turns (Read, Edit, Bash, submitted in that order) kept its OWN
      // "N tool call" group, all three now rendering at once instead of one at a time as the live
      // conversation grew — matched by POSITION (Edit is the 2nd, 0-indexed), since `.last()` no
      // longer picks out a single turn once every turn is on screen simultaneously.
      const editGroup = page.getByRole('button', { name: /1 tool call/ }).nth(1);
      await editGroup.waitFor();
      await editGroup.click();
      const editRow = page.getByRole('button', { name: /Edit src\/task-title\.ts/ });
      await editRow.waitFor();
      await editRow.click();
      await page.getByText(/const title = 'new';/).waitFor();
      await page.getByText(/const title = 'old';/).waitFor();

      const shellGroup = page.getByRole('button', { name: /1 tool call/ }).nth(2);
      await shellGroup.waitFor();
      await shellGroup.click();
      const shellRow = page.getByRole('button', { name: /pnpm test/ });
      await shellRow.waitFor();
      await shellRow.click();
      await page.getByText(/^Test Files\s+1 passed/u).waitFor();
      await page.getByText(/exit 0/).waitFor();

      // The Edit turn's "Changed files" row survived too (built from the SAME replayed diff).
      await page.getByRole('button', { name: /src\/task-title\.ts/ }).first().waitFor();
    },
  );

  await scenario(
    'a permission prompt docks above the composer; typing stays safe, Shift+Tab then 1 allows it',
    async () => {
      await send('please ask permission');
      const dialog = page.locator('[role="dialog"][aria-label="pending question"]');
      await dialog.waitFor();
      // One uninterrupted keystroke stream, slow enough to run well past the arm delay — the composer
      // kept focus when the prompt appeared, so the prompt must never take it away, however long it
      // stays, and the 1 and 2 typed along the way must never reach it either.
      const typed = 'typing along for a while, then 1 and 2 more';
      await page.getByLabel('message').pressSequentially(typed, { delay: 40 });
      if ((await page.getByText('Wrote the file.').count()) !== 0) {
        throw new Error('typing in the composer answered the permission prompt');
      }
      if ((await page.getByLabel('message').inputValue()) !== typed) {
        throw new Error('the composer lost text while the permission prompt was up');
      }
      await page.getByLabel('message').fill('');
      // The person reaches the prompt deliberately — Shift+Tab from the composer — and only then do
      // its keys answer it.
      await page.getByLabel('message').press('Shift+Tab');
      await page.keyboard.press('1');
      await page.getByText('Wrote the file.').waitFor();
    },
  );

  await scenario(
    'a free-text question shows a field; typing an answer and Enter answers it',
    async () => {
      await send('please duplicate the profile');
      await page.locator('[role="dialog"][aria-label="pending question"]').waitFor();
      await page.getByText('Duplicate anthropic as').waitFor();
      const field = page.getByPlaceholder('anthropic-copy');
      await field.waitFor();
      await field.fill('anthropic-copy-2');
      await field.press('Enter');
      await page.getByText('Duplicated as anthropic-copy-2.').waitFor();
    },
  );

  await scenario(
    'a provider failure keeps the partial reply and raises a toast in plain words (#3289 §3)',
    async () => {
      await send('please fail');
      const toast = page.getByRole('alert');
      await toast.getByText('Anthropic rejected the API key. Check the key for this provider.').waitFor();
      // The raw detail sits collapsed behind "Details" — not shown until it is opened.
      const rawDetail = toast.getByText('Scripted provider failure: invalid API key', {
        exact: false,
      });
      if (await rawDetail.isVisible()) {
        throw new Error('the raw provider message showed before opening Details');
      }
      await toast.getByText('Details').click();
      await rawDetail.waitFor();
      await page.getByText('Partial reply before failure.').waitFor();
      await page.getByRole('button', { name: 'Dismiss notice' }).click();
    },
  );

  await scenario('the usage dashboard renders the sidecar report without raw content', async () => {
    // Exact: the sidebar also lists a stored session named "Usage e2e session" (below), whose row
    // text otherwise substring-matches this nav button too.
    await page.getByRole('button', { name: 'Usage', exact: true }).click();
    await page.getByRole('heading', { name: 'Personal usage' }).waitFor();
    await page.getByText('scripted-model').waitFor();
    // The report itself is content-free; the session button is named from this workspace's own
    // local session-directory listing (the scripted sidecar's fake directory), never a raw id.
    await page.getByRole('button', { name: 'Open session Usage e2e session' }).click();
    const detail = page.getByRole('region', { name: 'Session usage detail' });
    await detail.getByText('42').waitFor();
    await detail.getByRole('heading', { name: 'Usage e2e session' }).waitFor();
    if ((await page.getByText('PROMPT_CONTENT_MUST_NOT_APPEAR').count()) !== 0) {
      throw new Error('dashboard rendered raw persisted content');
    }
    if ((await page.getByText('usage-e2e-session').count()) !== 0) {
      throw new Error('dashboard rendered the raw session id as visible text');
    }
  });

  await scenario('#3282 §4c: the Project panel lists the changed file, and a click shows its diff', async () => {
    await page.getByRole('button', { name: 'Project', exact: true }).click();
    await page.getByText('Changes — main').waitFor();
    await page.getByText('src/task-title.ts').waitFor();
    await page.getByText('Modified').waitFor();
    await page.getByText('+1').waitFor();
    await page.getByText('-1').waitFor();
    await page.getByText('src/task-title.ts').click();
    await page.getByText(/const title = 'new';/).waitFor();
    await page.getByText(/const title = 'old';/).waitFor();
    // Refresh re-requests the status without leaving the panel.
    await page.getByRole('button', { name: 'Refresh' }).click();
    await page.getByText('Changes — main').waitFor();
  });

  const sidebar = page.getByRole('complementary', { name: 'Sessions' });
  // A row's "More" button is also named after its title ("More for <title>"), so an unanchored name
  // match finds both; the row button itself is always first in the DOM, the "More" trigger beside it.
  const row = (name) => sidebar.getByRole('button', { name }).first();

  await scenario('the sidebar lists this workspace\'s sessions, the current one marked', async () => {
    await page.getByRole('button', { name: 'Chat' }).click();
    await row(/Scripted e2e session/).waitFor();
    if ((await row(/Scripted e2e session/).getAttribute('aria-current')) !== 'true') {
      throw new Error('the current session is not marked current');
    }
    await row(/What did we decide about the parser\?/).waitFor();
    await row(/Set up the release checklist/).waitFor();
    await sidebar.getByText(/1 older session in this folder can't be opened/).waitFor();
    if ((await sidebar.getByRole('button', { name: /damaged-session/ }).count()) !== 0) {
      throw new Error('an unreadable session is a clickable row');
    }
  });

  await scenario('the title bar and the page title show the workspace folder', async () => {
    // The scripted sidecar's workspace cwd defaults to '/scripted/workspace' (#3282 §4d); the folder
    // name shown here is its basename, 'workspace'.
    await page.getByText('workspace', { exact: true }).waitFor();
    if ((await page.title()) !== `workspace — ${product.identity.displayName}`) {
      throw new Error(`unexpected page title: ${await page.title()}`);
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

  // Regression for the MUST fix: `session_switched` clears the status before `get-status` answers, so
  // every switch passes through a transient no-session-id moment, not only the very first one. A
  // composer that mistook that moment for "no session has ever been known" would leak keystrokes
  // typed mid-switch into whichever session answered next (or the pre-session fallback key).
  await scenario('#3280: switching between two sidebar sessions keeps each one\'s own draft', async () => {
    // Currently on "What did we decide about the parser?" (the previous scenario switched to it).
    await page.getByLabel('message').fill('draft for the parser session');
    await row(/Set up the release checklist/).click();
    await sidebar.locator('[aria-current="true"]', { hasText: 'Set up the release checklist' }).waitFor();
    if ((await page.getByLabel('message').inputValue()) !== '') {
      throw new Error('the release-checklist session inherited the parser session\'s draft');
    }
    await page.getByLabel('message').fill('draft for the release-checklist session');
    await row(/What did we decide about the parser\?/).click();
    await sidebar.locator('[aria-current="true"]', { hasText: 'What did we decide' }).waitFor();
    if ((await page.getByLabel('message').inputValue()) !== 'draft for the parser session') {
      throw new Error('switching back lost the parser session\'s own draft');
    }
    await row(/Set up the release checklist/).click();
    await sidebar.locator('[aria-current="true"]', { hasText: 'Set up the release checklist' }).waitFor();
    if ((await page.getByLabel('message').inputValue()) !== 'draft for the release-checklist session') {
      throw new Error('the release-checklist session lost its own draft');
    }
  });

  await scenario('the row menu renames a session and the new title replaces the old one', async () => {
    await sidebar.getByRole('button', { name: 'More for Set up the release checklist' }).click();
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    const input = sidebar.getByRole('textbox', { name: 'Rename Set up the release checklist' });
    await input.fill('Renamed from the row menu');
    await input.press('Enter');
    await row(/Renamed from the row menu/).waitFor();
    if ((await sidebar.getByText('Set up the release checklist').count()) !== 0) {
      throw new Error('the old title is still shown after renaming');
    }
  });

  await scenario('the row menu deletes a session after a confirmation', async () => {
    await sidebar.getByRole('button', { name: 'More for Scripted e2e session' }).click();
    await page.getByRole('menuitem', { name: 'Delete…' }).click();
    // The shared Dialog primitive (#3282 §4a) names the panel via aria-labelledby, not visible text.
    // #3282 §4e: a destructive ConfirmDialog is an alertdialog, not a plain dialog.
    const dialog = page.getByRole('alertdialog', { name: /Delete/ });
    await dialog.getByText('This removes its conversation from this computer.').waitFor();
    await dialog.getByRole('button', { name: 'Delete' }).click();
    await row(/Scripted e2e session/).waitFor({ state: 'detached' });
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

  // Last: these leave "Working on it..." in the transcript, which an earlier scenario's strict
  // `getByText('Working on it...')` would otherwise match twice (this fresh session is not read again).
  await scenario('#3280: Send becomes Stop while a turn runs; Stop ends it and keeps the partial reply', async () => {
    await send('stay busy');
    await page.getByText('Working on it...').waitFor();
    if ((await page.getByRole('button', { name: 'Send' }).count()) !== 0) {
      throw new Error('Send is still shown while the turn runs');
    }
    await page.getByRole('button', { name: 'Stop' }).click();
    await page.getByRole('button', { name: 'Send' }).waitFor();
    await page.getByText('Working on it...').last().waitFor();
  });

  await scenario('#3280: Esc in the composer stops a running turn', async () => {
    await send('stay busy');
    await page.getByRole('button', { name: 'Stop' }).waitFor();
    await page.getByLabel('message').press('Escape');
    await page.getByRole('button', { name: 'Send' }).waitFor();
  });

  await scenario(
    '#3289 §2: at 390×800 the status chips collapse without overflow, and the composer stays uncovered',
    async () => {
      await page.setViewportSize({ width: 390, height: 800 });
      try {
        // The session-list-covers-the-composer overlay at a narrow width is #3289 §2's OTHER,
        // separate bug (the sheet-with-backdrop fix is out of scope here — this PR only owns the
        // status controls' own collapse). Close it first, the same way a person would, so this
        // scenario checks what it owns: the status chips and composer, not that unrelated overlay.
        const hideSessions = page.getByRole('button', { name: 'Hide sessions' });
        if ((await hideSessions.count()) > 0) {
          await hideSessions.click();
          await page.getByRole('complementary', { name: 'Sessions' }).waitFor({ state: 'detached' });
        }

        const viewport = page.viewportSize();
        const modelChip = page.getByRole('button', { name: 'model: scripted-model' });
        const modeChip = page.getByRole('button', { name: 'mode: acceptEdits' });
        const composer = page.getByLabel('message');
        await modelChip.waitFor();
        await composer.waitFor();

        // Nothing truncated to "d…"/"claude-…" (#3289 §2's exact bug): the icon-only chip is narrow
        // and its box stays fully inside the viewport width, on both sides.
        for (const chip of [modelChip, modeChip]) {
          const box = await chip.boundingBox();
          if (!box) throw new Error('a status chip has no layout box at 390px');
          if (box.x < 0 || box.x + box.width > viewport.width) {
            throw new Error(`a status chip overflows the 390px viewport: ${JSON.stringify(box)}`);
          }
        }
        // The composer is not covered by the session list or anything else at this width.
        const composerBox = await composer.boundingBox();
        if (!composerBox) throw new Error('the composer has no layout box at 390px');
        if (composerBox.x < 0 || composerBox.x + composerBox.width > viewport.width) {
          throw new Error(`the composer overflows the 390px viewport: ${JSON.stringify(composerBox)}`);
        }
        // A real click reaches it — proof nothing else sits visually on top of it.
        await composer.click();
        await composer.fill('typed at 390px');
        if ((await composer.inputValue()) !== 'typed at 390px') {
          throw new Error('the composer did not receive input at 390px — something covers it');
        }
        await composer.fill('');
      } finally {
        // Every later scenario assumes the desktop viewport this suite opened with.
        await page.setViewportSize({ width: 1100, height: 780 });
      }
    },
  );

  // Truly last: a reload drops every other scenario's assumed UI state (view, sidebar, transcript).
  await scenario('#3280: a draft survives a Chat -> Usage -> Chat switch and a reload', async () => {
    await page.getByLabel('message').fill('an unsent draft');

    // Exact: a stored session named "Usage e2e session" otherwise substring-matches this nav button.
    await page.getByRole('button', { name: 'Usage', exact: true }).click();
    await page.getByRole('heading', { name: 'Personal usage' }).waitFor();
    await page.getByRole('button', { name: 'Chat' }).click();
    await page.getByLabel('message').waitFor();
    if ((await page.getByLabel('message').inputValue()) !== 'an unsent draft') {
      throw new Error('the draft did not survive the Chat -> Usage -> Chat switch');
    }

    await page.reload();
    await page.locator('.agent-gui-status[data-status="connected"]').waitFor({ timeout: 20_000 });
    // Waits for the session's own status, so the draft (keyed by session id) has had its chance to load.
    await page.getByRole('button', { name: 'model: scripted-model' }).waitFor();
    if ((await page.getByLabel('message').inputValue()) !== 'an unsent draft') {
      throw new Error('the draft did not survive a reload');
    }
  });

  // #3288 §1: the Agents panel — open a task's detail sheet and its transcript, then close it.
  await scenario('the Agents panel opens a task, showing its transcript', async () => {
    await send('show background work');
    await page.getByText('Started background work.').waitFor();
    const panel = page.getByRole('complementary', { name: 'Agents' });
    await panel.getByText('Reviewing the auth module').waitFor();
    await panel.getByText('Loop: check the deploy').waitFor();

    await panel.getByText('Reviewing the auth module').click();
    const sheet = page.getByRole('dialog', { name: 'Reviewing the auth module' });
    await sheet.waitFor();
    await sheet.getByText('Checking the auth module for issues').waitFor();
    await sheet.getByText('Reviewing packages/auth/login.ts').waitFor();
    await sheet.getByText('Read login.ts').waitFor();

    await sheet.getByRole('button', { name: 'Close' }).click();
    await sheet.waitFor({ state: 'detached' });
  });

  // #3288 §1: Stop on an ordinary task sends cancel-background-task and its true status replaces
  // "Done"/silence — it shows "Stopped", never lingering unlabeled.
  await scenario('Stop on a task sends cancel-background-task and shows "Stopped"', async () => {
    const panel = page.getByRole('complementary', { name: 'Agents' });
    await panel.getByRole('button', { name: 'Stop Reviewing the auth module' }).click();
    await panel.getByText('Stopped').waitFor();
    // Still there (an ordinary task stays listed, unlike a loop) but no longer stoppable.
    await panel.getByText('Reviewing the auth module').waitFor();
    if ((await panel.getByRole('button', { name: /^Stop Reviewing/ }).count()) !== 0) {
      throw new Error('a stopped task still offers Stop');
    }
  });

  // #3288 §1: Stop on a loop sends `/loop stop <id>` — never cancel-background-task, which would
  // only cancel its disposable wake timer, not the loop — and the loop leaves the list, not
  // lingering the way a stopped ordinary task's row does.
  await scenario('Stop on a loop sends /loop stop <id>, and the loop leaves the list', async () => {
    const panel = page.getByRole('complementary', { name: 'Agents' });
    await panel.getByRole('button', { name: 'Stop Loop: check the deploy' }).click();
    await page.getByText(/Loop stopped: loop-e2e-1/).waitFor();
    await panel.getByText('Loop: check the deploy').waitFor({ state: 'detached' });
  });

  // #3289 §2 — a fresh reload at each size, so `initialSidebarOpen()` sees the real viewport: below
  // `md` the sheet starts closed (as a person opening the app at that size would see it), which is
  // exactly the "composer never covered while the sheet is closed" case the issue calls out.
  await scenario('1280×800: the composer is visible and uncovered', async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.reload();
    await page.locator('.agent-gui-status[data-status="connected"]').waitFor({ timeout: 20_000 });
    await expectComposerUncovered('1280x800');
  });

  await scenario('640×400: the sheet starts closed at this width; the composer is visible and uncovered', async () => {
    await page.setViewportSize({ width: 640, height: 400 });
    await page.reload();
    await page.locator('.agent-gui-status[data-status="connected"]').waitFor({ timeout: 20_000 });
    await expectComposerUncovered('640x400');
  });

  await scenario('390×800: the sheet starts closed at this width too; the composer is visible and uncovered', async () => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.reload();
    await page.locator('.agent-gui-status[data-status="connected"]').waitFor({ timeout: 20_000 });
    await expectComposerUncovered('390x800');
  });
} finally {
  if (process.env.CAPTURE_OUT) await page.screenshot({ path: join(process.env.CAPTURE_OUT, 'web-e2e.png') });
  if (process.env.E2E_DEBUG_CSP) {
    process.stdout.write(line(`policy messages:\n${policyMessages.join('\n')}`));
  }
  await browser.close();
  await server.close();
  await new Promise((resolve) => canary.close(resolve));
  await new Promise((resolve) => stunCanary.close(resolve));
  sidecar.kill('SIGTERM');
}

process.stdout.write(line(failures === 0 ? '\nWEB E2E PASSED' : `\nWEB E2E FAILED (${failures})`));
process.exit(failures === 0 ? 0 : 1);
