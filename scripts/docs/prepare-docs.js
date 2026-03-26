#!/usr/bin/env node

/**
 * Documentation deployment preparation script
 * Used identically in GitHub Actions and locally
 * Actual deployment is performed separately in GitHub Actions
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ROOT_DIR = process.cwd();
const DOCS_DIR = path.join(ROOT_DIR, 'apps/docs');

function log(message) {
  console.log(`[PREPARE] ${message}`);
}

function executeCommand(command, options = {}) {
  log(`Executing: ${command}`);
  try {
    execSync(command, {
      stdio: 'inherit',
      cwd: options.cwd || ROOT_DIR,
      ...options,
    });
  } catch (error) {
    console.error(`❌ Command failed: ${command}`);
    throw error;
  }
}

async function main() {
  log('🚀 Starting documentation build preparation...');

  // 1. Build documentation (copy-docs.js + vitepress build + copy-public.js)
  log('🔨 Building documentation...');
  executeCommand('pnpm run build', { cwd: DOCS_DIR });

  // 2. Add .nojekyll file (for GitHub Pages)
  log('📄 Adding .nojekyll file...');
  const nojekyllPath = path.join(DOCS_DIR, '.vitepress/dist/.nojekyll');
  fs.writeFileSync(nojekyllPath, '');

  // 3. Check build results
  const distDir = path.join(DOCS_DIR, '.vitepress/dist');
  const files = fs.readdirSync(distDir);
  log(`📁 Generated files: ${files.join(', ')}`);

  log('🎉 Documentation build completed!');
  log('📤 Ready for deployment to GitHub Pages');
}

// Execute script
main().catch((error) => {
  console.error('❌ Documentation preparation failed:', error);
  process.exit(1);
});
