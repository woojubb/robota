#!/usr/bin/env node
/** The desktop window loads the GUI web app: copy its build (`agent-gui-web/dist`) to `dist/renderer`. */
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(appRoot, '..', '..', 'packages', 'agent-gui-web', 'dist');
const target = join(appRoot, 'dist', 'renderer');

if (!existsSync(join(source, 'index.html'))) {
  process.stderr.write(
    `copy-renderer: ${source} has no index.html; build @robota-sdk/agent-gui-web first.\n`,
  );
  process.exit(1);
}
rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
