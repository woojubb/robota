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

async function main() {
  const [command, file] = process.argv.slice(2);
  if (command !== 'classify' || file === undefined) {
    process.stderr.write('Usage: task-lifecycle.mjs classify <task-file>\n');
    return 2;
  }
  const lifecycle = classifyTaskLifecycle(await fs.readFile(file, 'utf8'));
  process.stdout.write(`${lifecycle.valid ? lifecycle.state : 'invalid'}\n`);
  return lifecycle.valid ? 0 : 2;
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isDirectExecution) process.exitCode = await main();
