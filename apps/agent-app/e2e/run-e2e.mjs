/**
 * Desktop smoke test — only what the Electron shell itself owns. The GUI's user scenarios run in a plain
 * browser in packages/agent-gui-web (`test:e2e`).
 *
 * Launches the REAL built app (Playwright `_electron`) with the deterministic scripted sidecar as its
 * "robota", and checks: the shell starts the workspace daemon and the page connects with its token (TC-01);
 * a turn round-trips (TC-01); closing the window leaves the daemon running, and the next launch reattaches
 * to that same daemon and its conversation (#3189); a daemon that stops while the window is open leaves the
 * window saying so, and Reconnect starts a new daemon and attaches to it (or, when the new start fails,
 * shows the CLI's reason); and a daemon that cannot start reaches the fatal screen with the CLI's reason
 * instead of hanging.
 *
 * Run: `pnpm --filter @robota-sdk/agent-app test:e2e` (wraps this in `xvfb-run`; on macOS run it with node).
 */

import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

const stateDir = mkdtempSync(join(tmpdir(), 'agent-app-e2e-'));
const statePath = join(stateDir, 'daemon.json');

let failures = 0;
const check = (label, ok) => {
  process.stdout.write(line(`${ok ? '✓' : '✗'} ${label}`));
  if (!ok) failures += 1;
};

const failFile = join(stateDir, 'fail-next-start');

/** Stop the attached daemon the way `robota daemon stop` does, and wait for the window to say so. */
const stopDaemonAndAwaitReconnect = async (page) => {
  const pid = readDaemonPid();
  process.kill(pid, 'SIGTERM');
  // The page retries before it gives up on the daemon, so the stopped screen takes a while.
  const reconnect = page.getByRole('alert').getByRole('button', { name: 'Reconnect' });
  await reconnect.waitFor({ timeout: 60_000 });
  return { pid, reconnect };
};

const readDaemonPid = () =>
  existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')).pid : undefined;

const isAlive = (pid) => {
  if (!Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const launch = (extraEnv = {}) =>
  electron.launch({
    executablePath: electronPath,
    args: ['--no-sandbox', '--disable-gpu', mainJs],
    // The shell runs THIS as `robota daemon start --json`; it records its daemon in the state file.
    env: {
      ...process.env,
      ROBOTA_GUI_SIDECAR_CMD: sidecar,
      ROBOTA_E2E_DAEMON_STATE: statePath,
      ...extraEnv,
    },
  });

const connected = (page) =>
  page.locator('.agent-gui-status[data-status="connected"]').waitFor({ timeout: 20_000 });

let firstPid;
try {
  const app = await launch();
  try {
    const page = await app.firstWindow();
    await connected(page);
    firstPid = readDaemonPid();
    check('TC-01: the window connects to the token-gated daemon it started', isAlive(firstPid));
    await page.getByLabel('message').fill('hi there');
    await page.getByLabel('message').press('Enter');
    await page.getByText('Hello from the scripted agent.').waitFor({ timeout: 10_000 });
    check('TC-01: a turn round-trips through the desktop shell', true);
  } catch (err) {
    check(`first launch threw: ${err?.message ?? err}`, false);
  } finally {
    await app.close();
  }
  check('#3189: closing the window leaves the daemon running', isAlive(firstPid));

  const again = await launch();
  try {
    const page = await again.firstWindow();
    await connected(page);
    check('#3189: the next launch reattaches to the same daemon', readDaemonPid() === firstPid);
    await page.getByText('Hello from the scripted agent.').waitFor({ timeout: 10_000 });
    check('#3189: the conversation from the first launch is still there', true);
  } catch (err) {
    check(`second launch threw: ${err?.message ?? err}`, false);
  } finally {
    await again.close();
  }

  const stopped = await launch();
  try {
    const page = await stopped.firstWindow();
    await connected(page);
    const { pid: stoppedPid, reconnect } = await stopDaemonAndAwaitReconnect(page);
    check('#3189: a daemon that stops while the window is open leaves the window saying so', !isAlive(stoppedPid));
    await reconnect.click();
    await connected(page);
    const restartedPid = readDaemonPid();
    check(
      '#3189: Reconnect starts a new daemon and the window attaches to it',
      restartedPid !== stoppedPid && isAlive(restartedPid),
    );
  } catch (err) {
    check(`reconnect check threw: ${err?.message ?? err}`, false);
  } finally {
    await stopped.close();
  }

  const unrestartable = await launch({ ROBOTA_E2E_DAEMON_FAIL_FILE: failFile });
  try {
    const page = await unrestartable.firstWindow();
    await connected(page);
    const { reconnect } = await stopDaemonAndAwaitReconnect(page);
    writeFileSync(failFile, '');
    await reconnect.click();
    await page.getByRole('alert').getByText(/robota trust/).waitFor({ timeout: 20_000 });
    check('#3189: a Reconnect whose start fails shows the CLI reason', true);
  } catch (err) {
    check(`failed-reconnect check threw: ${err?.message ?? err}`, false);
  } finally {
    await unrestartable.close();
    rmSync(failFile, { force: true });
  }

  const refused = await launch({ ROBOTA_E2E_DAEMON_FAIL: '1' });
  try {
    const page = await refused.firstWindow();
    await page.getByRole('alert').getByText(/robota trust/).waitFor({ timeout: 20_000 });
    check('#3189: a daemon that cannot start reaches the fatal screen with the CLI reason', true);
  } catch (err) {
    check(`fatal-state check threw: ${err?.message ?? err}`, false);
  } finally {
    await refused.close();
  }
} finally {
  const pid = readDaemonPid();
  if (isAlive(pid)) process.kill(pid, 'SIGTERM');
  rmSync(stateDir, { recursive: true, force: true });
}

process.stdout.write(line(failures === 0 ? '\nE2E PASSED' : `\nE2E FAILED (${failures})`));
process.exit(failures === 0 ? 0 : 1);
