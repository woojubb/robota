#!/usr/bin/env node

/** Select the harness tests that own a changed file before broad verification. */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { TEST_DIR } from './harness-test-classification.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const ROOT = resolveWorkspaceRoot(import.meta);
const EXAMINED = ['::', 'examined::'].join('');

function tests(root = ROOT) {
  return readdirSync(path.join(root, TEST_DIR), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.test.mjs'))
    .map((entry) => path.join(TEST_DIR, entry.name).replaceAll(path.sep, '/'))
    .sort();
}

export function owningTests(file, root = ROOT) {
  const normalized = file.replaceAll(path.sep, '/');
  const base = path.basename(normalized).replace(/\.mjs$/, '');
  const candidates = tests(root);
  const owned = candidates.filter((candidate) => {
    const text = readFileSync(path.join(root, candidate), 'utf8');
    return (
      candidate.includes(`/${base}.test.mjs`) ||
      text.includes(`../${base}.mjs`) ||
      text.includes(`./${base}.mjs`)
    );
  });
  if (owned.length > 0) return owned;
  if (normalized.startsWith('scripts/harness/')) {
    const generic = candidates.filter((candidate) =>
      readFileSync(path.join(root, candidate), 'utf8').includes(normalized),
    );
    return generic;
  }
  return [];
}

export function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1) {
    console.error('usage: test-owning.mjs <workspace-relative-file>');
    return 2;
  }
  if (!existsSync(path.join(ROOT, argv[0]))) {
    console.error(`owning-test: file does not exist: ${argv[0]}`);
    return 1;
  }
  const selected = owningTests(argv[0]);
  process.stdout.write(`${EXAMINED} ${selected.length} owning test(s) for ${argv[0]}\n`);
  for (const test of selected) process.stdout.write(`${test}\n`);
  if (selected.length === 0) {
    console.error(`owning-test: no test owner found for ${argv[0]}`);
    return 1;
  }
  return 0;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename))
  process.exitCode = main();
