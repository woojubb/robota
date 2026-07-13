// GUI-003 TC-02a/TC-04 — the BUNDLED runtime inside the packaged app is a working `robota --serve`.
// nonce handshake succeeds, a wrong token is rejected before session data, SIGTERM shuts down cleanly.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { dirname, join as pjoin } from 'node:path';
import { fileURLToPath } from 'node:url';
const BIN = pjoin(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'release',
  'linux-unpacked',
  'resources',
  'robota',
);

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
mkdirSync(join(binCwd, '.robota'), { recursive: true });
writeFileSync(
  join(binCwd, '.robota', 'settings.json'),
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

const child = spawn(BIN, ['--serve', '--no-session-persistence'], {
  cwd: binCwd,
  env: { PATH: process.env.PATH, HOME: home, ROBOTA_WS_TOKEN: token, ROBOTA_WS_PORT: String(port) },
  stdio: 'ignore',
});

let ok = true;
const check = (label, cond) => {
  console.log(`${cond ? '✓' : '✗'} ${label}`);
  if (!cond) ok = false;
};

try {
  await waitTcp(port, 20000);

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
    child.once('exit', (code, signal) => res({ code, signal }));
    child.kill('SIGTERM');
    setTimeout(() => res({ timeout: true }), 8000);
  });
  check(
    'TC-02a: SIGTERM shuts the bundled runtime down cleanly (no hang/SIGKILL)',
    !exited.timeout && exited.signal !== 'SIGKILL',
  );
} finally {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  rmSync(binCwd, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}

console.log(ok ? '\nGUI-003 bundled-runtime e2e PASSED' : '\nGUI-003 bundled-runtime e2e FAILED');
process.exit(ok ? 0 : 1);
