// Exercise the shell's trust/daemon commands and the serve transport in the actual packaged binary.
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { dirname, join as pjoin } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { buildBundledRuntimeChildEnv } from './child-env.mjs';
import { buildDaemonStartSpawn, parseDaemonStartOutput } from '../dist/electron/sidecar.js';

const releaseDir = pjoin(dirname(fileURLToPath(import.meta.url)), '..', 'release');
const BIN =
  process.platform === 'darwin'
    ? pjoin(
        releaseDir,
        `mac-${process.arch}`,
        'robota-desktop.app',
        'Contents',
        'Resources',
        'robota',
      )
    : process.platform === 'win32'
      ? pjoin(releaseDir, 'win-unpacked', 'resources', 'robota.exe')
      : pjoin(releaseDir, 'linux-unpacked', 'resources', 'robota');
if (!existsSync(BIN)) throw new Error(`Packaged runtime not found: ${BIN}`);

const freePort = () =>
  new Promise((res, rej) => {
    const s = createServer();
    s.on('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });

const waitTcp = async (port, budget) => {
  const end = Date.now() + budget;
  for (;;) {
    const ok = await new Promise((res) => {
      const s = connect({ host: '127.0.0.1', port });
      const done = (v) => {
        s.destroy();
        res(v);
      };
      s.once('connect', () => done(true));
      s.once('error', () => done(false));
      s.setTimeout(400, () => done(false));
    });
    if (ok) return;
    if (Date.now() >= end) throw new Error('serve host did not come up');
    await new Promise((r) => setTimeout(r, 200));
  }
};

const drive = (url, onOpen, predicate, timeout) =>
  new Promise((res) => {
    const frames = [];
    const ws = new WebSocket(url);
    let settled = false;
    const finish = (timedOut, closed) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      try {
        ws.close();
      } catch {
        /* socket already closing */
      }
      res({ frames, timedOut, closed });
    };
    const t = setTimeout(() => finish(true, false), timeout);
    ws.onopen = () => onOpen((f) => ws.send(JSON.stringify(f)));
    ws.onmessage = (e) => {
      try {
        frames.push(JSON.parse(String(e.data)));
      } catch {
        /* socket already closing */
      }
      if (predicate(frames)) finish(false, false);
    };
    ws.onclose = () => finish(false, true);
  });

const binCwd = mkdtempSync(join(tmpdir(), 'gui003-bin-'));
const home = mkdtempSync(join(tmpdir(), 'gui003-home-'));
// macOS's default temp directory is too long for the daemon's Unix control socket.
const runtime = mkdtempSync(join(process.platform === 'darwin' ? '/tmp' : tmpdir(), 'rg-'));
mkdirSync(join(binCwd, '.robota'), { recursive: true });
mkdirSync(join(home, '.robota'), { recursive: true });
writeFileSync(
  join(home, '.robota', 'settings.json'),
  JSON.stringify({
    currentProvider: 'anthropic',
    providers: {
      anthropic: { type: 'anthropic', model: 'claude-test-model', apiKey: 'gui003-dummy' },
    },
  }),
);

const token = 'gui003-nonce-0123456789abcdef';
const port = await freePort();
const url = (t = token) => `ws://127.0.0.1:${port}?token=${encodeURIComponent(t)}`;

const serveEnv = buildBundledRuntimeChildEnv({
  path: process.env.PATH,
  home,
  token,
  port,
  systemRoot: process.env.SystemRoot,
});
const { ROBOTA_WS_TOKEN: _token, ROBOTA_WS_PORT: _port, ...baseCliEnv } = serveEnv;
const cliEnv = { ...baseCliEnv, XDG_RUNTIME_DIR: runtime };
const exec = promisify(execFile);
const runCli = (args) => exec(BIN, args, { cwd: binCwd, env: cliEnv, timeout: 30000 });
let child;
let stderr = '';

let ok = true;
const check = (label, cond) => {
  console.log(`${cond ? '✓' : '✗'} ${label}`);
  if (!cond) ok = false;
};

try {
  const trust = JSON.parse((await runCli(['trust', 'status', '--json'])).stdout);
  check('desktop: bundled CLI reports workspace trust as JSON', typeof trust.askable === 'boolean');
  const start = buildDaemonStartSpawn(BIN, cliEnv, { restricted: true });
  try {
    const endpoint = parseDaemonStartOutput((await runCli(start.args)).stdout);
    if (!endpoint) throw new Error('bundled daemon start did not report a valid loopback endpoint');
    const authed = await drive(
      endpoint.url,
      () => {},
      (f) => f.some((m) => m.type === 'messages'),
      8000,
    );
    check(
      'desktop: bundled daemon connects with its own launch nonce',
      authed.frames.some((m) => m.type === 'messages'),
    );
    const reused = parseDaemonStartOutput((await runCli(start.args)).stdout);
    check(
      'desktop: reopening reuses the workspace daemon',
      reused?.id === endpoint.id && reused?.url === endpoint.url,
    );
  } finally {
    await runCli(['daemon', 'stop']);
  }
  const stopped = JSON.parse((await runCli(['daemon', 'status', '--json'])).stdout);
  check('desktop: bundled CLI stops its workspace daemon', stopped.running === false);

  child = spawn(BIN, ['--serve', '--no-session-persistence'], {
    cwd: binCwd,
    env: serveEnv,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });
  try {
    await waitTcp(port, 20000);
  } catch (error) {
    throw new Error(`${error.message}; packaged runtime stderr: ${stderr}`);
  }

  // TC-02a: authed nonce connection → the session `messages` snapshot arrives (handshake complete).
  const authed = await drive(
    url(),
    () => {},
    (f) => f.some((m) => m.type === 'messages'),
    8000,
  );
  check(
    'TC-02a: bundled runtime accepts the launch nonce (handshake → messages snapshot)',
    authed.frames.some((m) => m.type === 'messages'),
  );

  // TC-04: wrong token → closed before any session data.
  const bad = await drive(
    url('wrong'),
    () => {},
    (f) => f.some((m) => m.type === 'messages'),
    3000,
  );
  check(
    'TC-04: wrong nonce is rejected before any session data',
    bad.closed && !bad.frames.some((m) => m.type === 'messages'),
  );

  // TC-02a: clean SIGTERM shutdown.
  const exited = await new Promise((res) => {
    const timer = setTimeout(() => res({ timeout: true }), 8000);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      res({ code, signal });
    });
    child.kill('SIGTERM');
  });
  const successfulShutdown =
    process.platform === 'win32'
      ? exited.code === 0 || (exited.code === null && exited.signal === 'SIGTERM')
      : exited.code === 0 && exited.signal === null;
  check(
    'TC-02a: SIGTERM shuts the bundled runtime down cleanly',
    !exited.timeout && successfulShutdown,
  );
} finally {
  if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  rmSync(binCwd, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
  rmSync(runtime, { recursive: true, force: true });
}

console.log(ok ? '\nGUI-003 bundled-runtime e2e PASSED' : '\nGUI-003 bundled-runtime e2e FAILED');
process.exit(ok ? 0 : 1);
