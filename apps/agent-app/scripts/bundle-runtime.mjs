#!/usr/bin/env node
/**
 * GUI-003 / RUNTIME-002 — copy the verified host-arch headless Bun binary to a FIXED canonical path electron-builder can reference.
 *
 * `build-bun.mjs headless` emits host-suffixed names (`robota-headless-<os>-<arch>`, `.exe` on Windows); a static
 * `electron-builder.yml` cannot interpolate the host arch. So this copies the matching binary to
 * `apps/agent-app/resources-bin/robota(.exe)` — the fixed path `extraResources` bundles into `resources/`,
 * where `sidecar.ts:resolveSidecarCommand` resolves it in a packaged app.
 */
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { pinGeneration } from '../../../scripts/artifacts/generation.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, '..'); // apps/agent-app
const cliDir = join(appDir, '..', '..', 'packages', 'agent-cli');
const pinned = pinGeneration(cliDir, { outputName: 'dist-bun-headless' });

const os = process.platform === 'win32' ? 'windows' : process.platform; // darwin | linux | windows
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
const isWin = process.platform === 'win32';
const srcName = `robota-headless-${os}-${arch}${isWin ? '.exe' : ''}`;
const src = join(pinned.root, srcName);

if (!pinned.manifest.files.some((file) => file.path === srcName)) {
  throw new Error(
    `bundle-runtime: verified headless generation lacks ${srcName}. ` +
      `Build it first: pnpm --filter @robota-sdk/agent-cli build:bun:headless:${os}-${arch}`,
  );
}

const outDir = join(appDir, 'resources-bin');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const dest = join(outDir, isWin ? 'robota.exe' : 'robota');
copyFileSync(src, dest);
console.log(`bundle-runtime: ${srcName} -> resources-bin/${isWin ? 'robota.exe' : 'robota'}`);
