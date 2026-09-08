#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

if (process.env.FULL_VERIFICATION !== 'true') {
  console.log('[build] desktop Electron app is not required outside full verification.');
  process.exit(0);
}

console.log('[build] full verification requires the desktop Electron app.');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const result = spawnSync(pnpm, ['--filter', '@robota-sdk/agent-app', 'build'], {
  stdio: 'inherit',
});

if (result.error) {
  console.error(`[build] failed to start desktop Electron build: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
