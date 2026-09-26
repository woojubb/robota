#!/usr/bin/env node
/**
 * `pnpm gui:dev` — the GUI in a browser, with hot reload.
 *
 * Starts a sidecar (`robota --serve`, the repo CLI from source via `scripts/dev/robota`) on a free
 * loopback port with a fresh token, then the Vite dev server, and prints the page URL that carries the
 * sidecar address (`?ws=`). The sidecar runs in the directory you ran the command from (or
 * `ROBOTA_DEV_CWD`) and uses your own `~/.robota`; that directory must be a trusted workspace
 * (`robota trust`).
 *
 *   --scripted   use the deterministic test sidecar (e2e/scripted-sidecar.mjs): no model, no key.
 */

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer } from 'vite';

/** One line of output (scripts write to the streams directly). */
const line = (text) => `${text}\n`;

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const scripted = process.argv.includes('--scripted');
const [sidecarCommand, sidecarArgs] = scripted
  ? [process.execPath, [join(packageRoot, 'e2e', 'scripted-sidecar.mjs'), '--serve']]
  : [join(packageRoot, '..', '..', 'scripts', 'dev', 'robota'), ['--serve']];

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const port = await freePort();
const token = randomBytes(32).toString('hex');
const sidecar = spawn(sidecarCommand, sidecarArgs, {
  cwd: process.env.ROBOTA_DEV_CWD ?? process.env.INIT_CWD ?? process.cwd(),
  env: { ...process.env, ROBOTA_WS_TOKEN: token, ROBOTA_WS_PORT: String(port) },
  stdio: 'inherit',
});

const vite = await createServer({
  root: packageRoot,
  configFile: join(packageRoot, 'vite.config.ts'),
});
await vite.listen();
const pageUrl = new URL(vite.resolvedUrls.local[0]);
pageUrl.searchParams.set('ws', `ws://127.0.0.1:${port}?token=${token}`);
process.stdout.write(
  line(`\n  GUI (${scripted ? 'scripted sidecar' : 'robota --serve'}): ${pageUrl.href}\n`),
);

let stopping = false;
async function stop(code) {
  if (stopping) return;
  stopping = true;
  sidecar.kill('SIGTERM');
  await vite.close();
  process.exit(code);
}
sidecar.on('exit', (code) => {
  if (!stopping) process.stderr.write(line(`gui:dev: the sidecar exited (${code ?? 'signal'}).`));
  void stop(code ?? 1);
});
process.on('SIGINT', () => void stop(0));
process.on('SIGTERM', () => void stop(0));
