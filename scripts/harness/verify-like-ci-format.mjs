import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { WORKSPACE_ROOT, git, run } from './verify-like-ci-shared.mjs';

const LINT_STAGED_CONFIG = '.lintstagedrc.json';

export function globExtensions(glob) {
  const braced = /^\*\.\{([^}]+)\}$/.exec(glob);
  if (braced) return braced[1].split(',').map((ext) => `.${ext.trim()}`);
  const single = /^\*\.([A-Za-z0-9]+)$/.exec(glob);
  return single ? [`.${single[1]}`] : [];
}

export function lintStagedExtensions(config) {
  const extensions = new Set();
  for (const glob of Object.keys(config ?? {})) {
    for (const ext of globExtensions(glob)) extensions.add(ext.toLowerCase());
  }
  return [...extensions].sort();
}

export function readLintStagedExtensions(root = WORKSPACE_ROOT) {
  const configPath = path.join(root, LINT_STAGED_CONFIG);
  if (!existsSync(configPath)) {
    throw new Error(`${LINT_STAGED_CONFIG} not found — cannot derive the formatter's file set.`);
  }
  return lintStagedExtensions(JSON.parse(readFileSync(configPath, 'utf8')));
}

export function selectFormatTargets(files, extensions) {
  const owned = new Set(extensions.map((ext) => ext.toLowerCase()));
  return [...new Set(files)]
    .filter((file) => file && owned.has(path.extname(file).toLowerCase()))
    .sort();
}

export function collectChangedFiles(baseRef, gitRunner = git) {
  return [
    ...gitRunner(['diff', '--name-only', '--diff-filter=ACMR', `${baseRef}...HEAD`]),
    ...gitRunner(['diff', '--name-only', '--diff-filter=ACMR', 'HEAD']),
    ...gitRunner(['ls-files', '--others', '--exclude-standard']),
  ].filter((file) => existsSync(path.join(WORKSPACE_ROOT, file)));
}

export async function runFormatCheck({ baseRef, allFiles }) {
  const extensions = readLintStagedExtensions();
  if (allFiles) {
    const glob = `**/*{${extensions.join(',')}}`;
    const code = await run('pnpm', ['exec', 'prettier', '--check', glob]);
    return { code, note: `whole repo, ${extensions.length} formatter-owned extension(s)` };
  }
  const targets = selectFormatTargets(collectChangedFiles(baseRef), extensions);
  if (targets.length === 0) {
    return { code: 0, note: `no formatter-owned files changed vs ${baseRef}` };
  }
  const code = await run('pnpm', ['exec', 'prettier', '--check', ...targets]);
  if (code !== 0) {
    process.stderr.write(
      `\n[format-check] Prettier is the SSOT formatter (lint-staged / .husky/pre-commit). A fresh\n` +
        `[format-check] worktree pushing with --no-verify never runs it. Fix with:\n` +
        `[format-check]   pnpm exec prettier --write ${targets.slice(0, 6).join(' ')}${
          targets.length > 6 ? ' …' : ''
        }\n`,
    );
  }
  return { code, note: `${targets.length} changed file(s) vs ${baseRef}` };
}
