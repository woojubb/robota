#!/usr/bin/env node

/**
 * Deploy VitePress build output to gh-pages branch.
 *
 * Usage: pnpm docs:deploy
 *
 * Prerequisites:
 *   - pnpm docs:build must have been run (or use pnpm docs:deploy which runs it)
 *   - Git must be clean (no uncommitted changes in working tree)
 *
 * Preserves CNAME (robota.io) and .nojekyll on gh-pages.
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const distDir = path.join(rootDir, 'apps/docs/.vitepress/dist');

function run(cmd, opts = {}) {
  console.log(`$ ${cmd}`);
  return execSync(cmd, { cwd: rootDir, stdio: 'inherit', ...opts });
}

// Verify build output exists
if (!existsSync(distDir)) {
  console.error('Error: Build output not found at apps/docs/.vitepress/dist/');
  console.error('Run "pnpm docs:build" first.');
  process.exit(1);
}

// Verify index.html exists
if (!existsSync(path.join(distDir, 'index.html'))) {
  console.error('Error: index.html not found in build output. Build may have failed.');
  process.exit(1);
}

console.log('\nDeploying to gh-pages...\n');

// Create a temporary worktree for gh-pages
const tmpDir = path.join(rootDir, '.gh-pages-tmp');

try {
  // Clean up any previous failed attempt
  execSync(`rm -rf ${tmpDir}`, { cwd: rootDir });

  // Add worktree for gh-pages branch
  try {
    run(`git worktree add ${tmpDir} gh-pages`);
  } catch {
    // gh-pages branch might not exist yet
    console.log('Creating gh-pages branch...');
    run(`git worktree add --orphan ${tmpDir} gh-pages`);
  }

  // Clean worktree (preserve CNAME and .nojekyll)
  const preserveFiles = ['CNAME', '.nojekyll'];
  execSync(
    `find ${tmpDir} -mindepth 1 -maxdepth 1 -not -name '.git' ${preserveFiles.map((f) => `-not -name '${f}'`).join(' ')} -exec rm -rf {} +`,
    { cwd: rootDir },
  );

  // Copy build output
  execSync(`cp -r ${distDir}/* ${tmpDir}/`, { cwd: rootDir });

  // Ensure .nojekyll exists
  execSync(`touch ${tmpDir}/.nojekyll`, { cwd: rootDir });

  // Ensure CNAME exists
  if (!existsSync(path.join(tmpDir, 'CNAME'))) {
    execSync(`echo "robota.io" > ${tmpDir}/CNAME`, { cwd: rootDir });
  }

  // Commit and push
  execSync('git add -A', { cwd: tmpDir });

  try {
    execSync('git commit -m "docs: deploy documentation site"', {
      cwd: tmpDir,
      stdio: 'inherit',
    });
    execSync('git push origin gh-pages', { cwd: tmpDir, stdio: 'inherit' });
    console.log('\nDeployment complete! Site will be available at https://robota.io/');
  } catch {
    console.log('\nNo changes to deploy (build output matches gh-pages).');
  }
} finally {
  // Clean up worktree
  execSync(`rm -rf ${tmpDir}`, { cwd: rootDir });
  try {
    execSync('git worktree prune', { cwd: rootDir });
  } catch {
    // ignore
  }
}
