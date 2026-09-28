#!/usr/bin/env node
/**
 * Copy the host CLI to the canonical path electron-builder bundles and the shell resolves.
 *
 * `build-bun.mjs` emits host-suffixed names (`robota-<os>-<arch>`, `.exe` on Windows); a static
 * `electron-builder.yml` cannot interpolate the host arch. So this copies the matching binary to
 * `apps/agent-app/resources-bin/robota(.exe)` — the fixed path `extraResources` bundles into `resources/`,
 * where `sidecar.ts:resolveSidecarCommand` resolves it in a packaged app.
 */
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, '..'); // apps/agent-app
const cliDir = join(appDir, '..', '..', 'packages', 'agent-cli');

const os = process.platform === 'win32' ? 'windows' : process.platform; // darwin | linux | windows
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
const isWin = process.platform === 'win32';
const srcName = `robota-${os}-${arch}${isWin ? '.exe' : ''}`;
const src = join(cliDir, 'dist-bun', srcName);

if (!existsSync(src)) {
  throw new Error(
    `bundle-runtime: ${src} is missing. ` +
      `Build it first: pnpm --filter @robota-sdk/agent-cli build:bun:${os}-${arch}`,
  );
}

const outDir = join(appDir, 'resources-bin');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const dest = join(outDir, isWin ? 'robota.exe' : 'robota');
copyFileSync(src, dest);
console.log(`bundle-runtime: ${srcName} -> resources-bin/${isWin ? 'robota.exe' : 'robota'}`);
