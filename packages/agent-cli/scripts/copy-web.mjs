#!/usr/bin/env node
/** Copy the built web-monitor SPA (`agent-cli-web/dist`) into this package's `dist/web`. */
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(packageRoot, '..', 'agent-cli-web', 'dist');
const target = join(packageRoot, 'dist', 'web');

if (!existsSync(join(source, 'index.html'))) {
  process.stderr.write(
    `copy-web: ${source} has no index.html; build @robota-sdk/agent-cli-web first.\n`,
  );
  process.exit(1);
}
rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
