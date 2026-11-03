// Check the packaged desktop app itself, after `electron-builder --dir`: the fuse wire the packager wrote into the
// binary, and that a launch asking for Chromium remote debugging exits before it opens anything. Neither needs a window.
// Usage: node e2e/packaged-app-e2e.mjs [path to the packaged .app or executable]
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fuseMismatches, getCurrentFuseWire } from './electron-fuses.mjs';
import { readDesktopTestIdentity } from './product-fixture.mjs';
import { REMOTE_DEBUGGING_REFUSED_EXIT_CODE } from '../dist/electron/launch-guard.js';

// A refused launch exits as soon as the main script runs (about a second cold on an M-series Mac); only a launch that
// is not refused waits the budget out, so it is sized for a slow CI runner rather than for speed.
const LAUNCH_BUDGET_MS = 30_000;

const appDirectory = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The packaged app electron-builder wrote for this host, as `{ fuseTarget, executable }`. */
function packagedApp(override) {
  const identity = readDesktopTestIdentity(join(appDirectory, 'dist', 'electron'));
  if (!identity) throw new Error('Generated desktop product identity not found.');
  const name = `${identity.identity.cliName}-desktop`;
  const arch = process.arch === 'x64' ? '' : `-${process.arch}`;
  const release = join(appDirectory, 'release');
  if (process.platform === 'darwin') {
    const bundle = override ?? join(release, `mac${arch}`, `${name}.app`);
    return { fuseTarget: bundle, executable: join(bundle, 'Contents', 'MacOS', name) };
  }
  const executable =
    override ??
    join(release, `${process.platform === 'win32' ? 'win' : 'linux'}${arch}-unpacked`, `${name}${process.platform === 'win32' ? '.exe' : ''}`);
  return { fuseTarget: executable, executable };
}

const app = packagedApp(process.argv[2]);
if (!existsSync(app.executable)) throw new Error(`Packaged app not found: ${app.executable}`);

const freePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

const portOpen = (port) =>
  new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('connect', () => (socket.destroy(), resolve(true)));
    socket.once('error', () => resolve(false));
  });

/** Launch with `args` and a throwaway HOME; report how it ended and whether remote debugging came up meanwhile. */
async function launch(args, { port, pipes = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'packaged-app-home-'));
  const env = { PATH: process.env.PATH ?? '', HOME: home, USERPROFILE: home, ELECTRON_ENABLE_LOGGING: '1' };
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  // --remote-debugging-pipe speaks over file descriptors 3 and 4.
  const child = spawn(app.executable, args, { env, stdio: ['ignore', 'pipe', 'pipe', ...(pipes ? ['pipe', 'pipe'] : [])] });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  let debuggerUp = false;
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  const deadline = Date.now() + LAUNCH_BUDGET_MS;
  let ended;
  while (!ended && Date.now() < deadline) {
    ended = await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 250))]);
    if (/DevTools listening/u.test(output) || (port !== undefined && (await portOpen(port)))) debuggerUp = true;
  }
  if (!ended) {
    child.kill('SIGKILL');
    await exited;
  }
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  return { ended, debuggerUp, output };
}

let ok = true;
const check = (label, cond, detail) => {
  console.log(`${cond ? '✓' : '✗'} ${label}`);
  if (!cond) {
    ok = false;
    if (detail) console.log(`  ${detail.replaceAll('\n', '\n  ')}`);
  }
};

const mismatches = fuseMismatches(await getCurrentFuseWire(app.fuseTarget));
check('packaged binary carries every intended Electron fuse', mismatches.length === 0, mismatches.join('\n'));

const port = await freePort();
for (const [label, args, options] of [
  ['--remote-debugging-port=<port>', [`--remote-debugging-port=${port}`], { port }],
  ['--remote-debugging-port <port>', ['--remote-debugging-port', String(port)], { port }],
  ['--remote-debugging-pipe', ['--remote-debugging-pipe'], { pipes: true }],
]) {
  const { ended, debuggerUp, output } = await launch(args, options);
  check(
    `${label}: the packaged app refuses to start and opens no DevTools endpoint`,
    ended?.code === REMOTE_DEBUGGING_REFUSED_EXIT_CODE && !debuggerUp,
    `exit ${ended ? JSON.stringify(ended) : 'none (killed)'}; DevTools endpoint ${debuggerUp ? 'opened' : 'not seen'}\n${output.split('\n').slice(-8).join('\n')}`,
  );
}

console.log(ok ? '\npackaged app e2e PASSED' : '\npackaged app e2e FAILED');
process.exit(ok ? 0 : 1);
