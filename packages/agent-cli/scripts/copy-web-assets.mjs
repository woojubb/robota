#!/usr/bin/env node
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// GUI-006: the CLI-served web GUI (monitor + Stage-D remote pages) is now the apps/agent-web-monitor app.
const src = join(__dirname, '../../../apps/agent-web-monitor/dist');
const dest = join(__dirname, '../dist/web');

if (!existsSync(src)) {
  console.error(`Web SPA not built: ${src}`);
  console.error('Run: pnpm --filter @robota-sdk/agent-web-monitor build');
  process.exit(1);
}

mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`Copied web assets: ${src} → ${dest}`);
