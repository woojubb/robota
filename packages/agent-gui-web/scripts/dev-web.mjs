#!/usr/bin/env node
/**
 * `pnpm gui:dev` — the GUI in a browser, with hot reload.
 *
 * Starts a sidecar (`robota --serve`, the repo CLI from source via `scripts/dev/robota`) on a free
 * loopback port with a fresh token, then the Vite dev server, and prints the page URL that carries the
 * sidecar address (`?ws=`). The sidecar runs in the directory you ran the command from (or
 * `ROBOTA_DEV_CWD`) and uses your own `~/.robota`. In a folder that is not trusted yet it asks first,
 * at this terminal: trust it, start Restricted, or quit.
 *
 *   --scripted   use the deterministic test sidecar (e2e/scripted-sidecar.mjs): no model, no key.
 */

import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer } from 'vite';

import { shouldAskToTrust, sidecarTrustDecision, trustQuestionLines } from './sidecar-trust.mjs';

/** One line of output (scripts write to the streams directly). */
const line = (text) => `${text}\n`;

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const scripted = process.argv.includes('--scripted');
const [sidecarCommand, sidecarArgs] = scripted
  ? [process.execPath, [join(packageRoot, 'e2e', 'scripted-sidecar.mjs'), '--serve']]
  : [join(packageRoot, '..', '..', 'scripts', 'dev', 'robota'), ['--serve']];
const sidecarCwd = process.env.ROBOTA_DEV_CWD ?? process.env.INIT_CWD ?? process.cwd();

/** The folder's trust, as `robota trust status --json` reports it; undefined when it cannot say. */
function trustStatus() {
  const result = spawnSync(sidecarCommand, ['trust', 'status', '--json'], {
    cwd: sidecarCwd,
    encoding: 'utf8',
  });
  if (result.status !== 0) return undefined;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return undefined;
  }
}

async function ask(question) {
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

if (!scripted) {
  const status = trustStatus();
  if (shouldAskToTrust(status, process.stdin.isTTY === true && process.stdout.isTTY === true)) {
    process.stdout.write(trustQuestionLines(status).map(line).join(''));
    const decision = sidecarTrustDecision(
      await ask('Trust this folder? [y] trust and start / [r] start Restricted / [N] quit: '),
    );
    if (decision === 'quit') {
      process.stdout.write(line('gui:dev: not started. Trust it later with: robota trust --yes'));
      process.exit(1);
    }
    if (decision === 'trust') {
      const granted = spawnSync(sidecarCommand, ['trust', '--yes'], {
        cwd: sidecarCwd,
        stdio: 'inherit',
      });
      if (granted.status !== 0) process.exit(granted.status ?? 1);
    } else {
      sidecarArgs.push('--restricted-workspace');
    }
  }
}

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
  cwd: sidecarCwd,
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
