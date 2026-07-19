#!/usr/bin/env node
import { cpSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// GUI-007: the CLI's built-in web monitor SPA is packages/agent-cli-web; its dist is copied here and served over localhost HTTP.
const src = join(__dirname, '../../agent-cli-web/dist');
const dest = join(__dirname, '../dist/web');

if (!existsSync(src)) {
  console.error(`Web SPA not built: ${src}`);
  console.error('Run: pnpm --filter @robota-sdk/agent-cli-web build');
  process.exit(1);
}

// Clean the destination first so a stale asset from a previous build (e.g. the old remote.html) never lingers.
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`Copied web assets: ${src} → ${dest}`);
