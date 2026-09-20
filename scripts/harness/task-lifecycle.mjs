#!/usr/bin/env node

/**
 * Canonical Task lifecycle classifier (HARNESS-091).
 *
 * Scope: Task YAML frontmatter only. Body prose and checkbox state are deliberately excluded.
 * Generic YAML-frontmatter parsing remains owned by `frontmatter.mjs`; this module owns only the
 * Task status vocabulary and terminal-date contract shared by placement, archival, and hooks.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { asScalar, parseFrontmatterBlock } from './frontmatter.mjs';

export const OPEN_TASK_STATUSES = new Set(['todo', 'in-progress', 'blocked']);
export const TERMINAL_TASK_STATUSES = new Set(['done', 'wontfix', 'skipped', 'superseded']);

export function isValidTaskCompletionDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * @returns {{status: string|null, state: 'open'|'terminal'|'invalid', completed: string|null,
 *   valid: boolean, problems: string[]}}
 */
export function classifyTaskLifecycle(content) {
  const entries = parseFrontmatterBlock(content);
  if (entries === null) {
    return {
      status: null,
      state: 'invalid',
      completed: null,
      valid: false,
      problems: ['no `status:` in YAML frontmatter'],
    };
  }

  const statusValue = asScalar(entries.get('status')).trim().split(/\s+/)[0];
  const status = statusValue === '' ? null : statusValue;
  const completedValue = asScalar(entries.get('completed')).trim();
  const completed = completedValue === '' ? null : completedValue;

  if (status !== null && OPEN_TASK_STATUSES.has(status)) {
    return { status, state: 'open', completed, valid: true, problems: [] };
  }

  if (status !== null && TERMINAL_TASK_STATUSES.has(status)) {
    const valid = completed !== null && isValidTaskCompletionDate(completed);
    return {
      status,
      state: 'terminal',
      completed,
      valid,
      problems: valid ? [] : ['terminal status requires a valid `completed: YYYY-MM-DD` date'],
    };
  }

  return {
    status,
    state: 'invalid',
    completed,
    valid: false,
    problems: [
      status === null ? 'missing `status:` in YAML frontmatter' : `unknown status "${status}"`,
    ],
  };
}

/**
 * Classify every Task file directly under `dir` in one process (INFRA-2772).
 *
 * The SessionStart hook used to spawn this script once per file — 166 `node` processes and ~6 s
 * before the notice appeared. One line per file, `<basename>\t<state>\t<status>`, sorted by name;
 * `README.md` is not a Task and is skipped. Per-file trouble travels in the line, never in the exit
 * code, so one bad file cannot silence the report on the others — and it says WHICH trouble: bad or
 * missing frontmatter is `invalid`, a file that could not be read at all (permissions, removed
 * between readdir and read) is `unreadable`. Folding the second into the first sent the reader to
 * "correct the YAML" of a file whose YAML was never seen (review, INFRA-2772).
 * Symlinks are not followed: `isFile()` is false for them, which keeps a pnpm-store link out.
 *
 * @returns {Promise<string[]>}
 */
export async function classifyTaskDirectory(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'README.md')
    .map((entry) => entry.name)
    .sort();
  const lines = [];
  for (const name of names) {
    let content;
    try {
      content = await fs.readFile(path.join(dir, name), 'utf8');
    } catch {
      lines.push(`${name}\tunreadable\t-`);
      continue;
    }
    const lifecycle = classifyTaskLifecycle(content);
    const state = lifecycle.valid ? lifecycle.state : 'invalid';
    lines.push(`${name}\t${state}\t${lifecycle.status ?? '-'}`);
  }
  return lines;
}

async function main() {
  const [command, target] = process.argv.slice(2);
  if (command === 'classify-dir' && target !== undefined) {
    const lines = await classifyTaskDirectory(target);
    process.stdout.write(lines.map((line) => `${line}\n`).join(''));
    return 0;
  }
  if (command !== 'classify' || target === undefined) {
    process.stderr.write(
      'Usage: task-lifecycle.mjs classify <task-file> | classify-dir <tasks-directory>\n',
    );
    return 2;
  }
  const lifecycle = classifyTaskLifecycle(await fs.readFile(target, 'utf8'));
  process.stdout.write(`${lifecycle.valid ? lifecycle.state : 'invalid'}\n`);
  return lifecycle.valid ? 0 : 2;
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isDirectExecution) process.exitCode = await main();
