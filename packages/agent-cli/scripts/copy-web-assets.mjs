#!/usr/bin/env node
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = join(__dirname, '../../agent-web/dist/spa');
const dest = join(__dirname, '../dist/web');

if (!existsSync(src)) {
  console.error(`Web SPA not built: ${src}`);
  console.error('Run: pnpm --filter @robota-sdk/agent-web build:spa');
  process.exit(1);
}

mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`Copied web assets: ${src} → ${dest}`);
