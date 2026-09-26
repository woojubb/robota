#!/usr/bin/env node
/**
 * `pnpm app:dev` — the desktop app against the repo's code.
 *
 * Builds the Electron shell (`agent-app`) with everything it depends on — the page (`agent-gui-web`) and
 * the workspace libraries the page bundles — so the window never loads a stale `dist`. Then starts
 * Electron with `ROBOTA_GUI_SIDECAR_CMD` pointing at `scripts/dev/robota`, so the window drives the repo
 * CLI from source rather than whatever `robota` is on PATH. A value you set yourself wins (e.g. the scripted
 * sidecar). The daemon serves the directory the command was started from (or `ROBOTA_DEV_CWD`), which
 * must be a trusted workspace (`robota trust`).
 */

import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const appRoot = join(repoRoot, 'apps', 'agent-app');
const build = spawnSync('pnpm', ['--filter', '@robota-sdk/agent-app...', 'build'], {
  cwd: repoRoot,
  stdio: 'inherit',
});
if (build.error) process.stderr.write(`app:dev: could not run pnpm: ${build.error.message}\n`);
if (build.status !== 0) process.exit(build.status ?? 1);

/** The `electron` package's main export is the path of its binary. */
const electron = createRequire(join(appRoot, 'package.json'))('electron');
const app = spawn(electron, [join(appRoot, 'dist', 'electron', 'main.js')], {
  cwd: process.env.ROBOTA_DEV_CWD ?? process.env.INIT_CWD ?? process.cwd(),
  env: {
    ...process.env,
    ROBOTA_GUI_SIDECAR_CMD:
      process.env.ROBOTA_GUI_SIDECAR_CMD ?? join(repoRoot, 'scripts', 'dev', 'robota'),
  },
  stdio: 'inherit',
});
app.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.kill(signal));
