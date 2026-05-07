#!/usr/bin/env node

/**
 * Deploy VitePress build output to Cloudflare Pages.
 *
 * Usage: pnpm docs:deploy
 *
 * Prerequisites:
 *   - pnpm docs:build must have been run (or use pnpm docs:deploy which runs it)
 *   - CLOUDFLARE_ACCOUNT_ID must be set
 *   - CLOUDFLARE_API_TOKEN must be set
 *
 * Cloudflare Pages Git integration deploys docs automatically from main. This
 * script is a manual direct-upload escape hatch for release verification or
 * emergency documentation deploys.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const distDir = path.join(rootDir, 'apps/docs/.vitepress/dist');
const projectName = 'robota';
const wranglerVersion = '4.87.0';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Error: ${name} must be set for Cloudflare Pages deployment.`);
    process.exit(1);
  }
}

if (!existsSync(distDir)) {
  console.error('Error: Build output not found at apps/docs/.vitepress/dist/.');
  console.error('Run "pnpm docs:build" first.');
  process.exit(1);
}

if (!existsSync(path.join(distDir, 'index.html'))) {
  console.error('Error: index.html not found in build output. Build may have failed.');
  process.exit(1);
}

requireEnv('CLOUDFLARE_ACCOUNT_ID');
requireEnv('CLOUDFLARE_API_TOKEN');

const args = [
  'dlx',
  `wrangler@${wranglerVersion}`,
  'pages',
  'deploy',
  distDir,
  `--project-name=${projectName}`,
];

const branch = process.env.CLOUDFLARE_PAGES_BRANCH;
if (branch) {
  args.push(`--branch=${branch}`);
}

console.log(`\nDeploying docs to Cloudflare Pages project "${projectName}"...\n`);
execFileSync('pnpm', args, { cwd: rootDir, stdio: 'inherit', env: process.env });
