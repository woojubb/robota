import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { asScalar, frontmatterObject } from './frontmatter.mjs';
import { classifyTaskLifecycle } from './task-lifecycle.mjs';

const TASK_ROOT = '.agents/tasks';
const COMPLETED_TASK_ROOT = '.agents/tasks/completed';
const SPEC_ROOTS = ['draft', 'backlog', 'todo', 'active', 'done'];

function escaped(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function markdownFiles(root, relative) {
  const directory = path.join(root, relative);
  try {
    if (lstatSync(directory).isSymbolicLink()) return [];
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => path.join(directory, entry.name));
  } catch {
    return [];
  }
}

function taskCandidates(root, workId) {
  const prefix = new RegExp(`^${escaped(workId)}-`);
  return [TASK_ROOT, COMPLETED_TASK_ROOT]
    .flatMap((folder) => markdownFiles(root, folder))
    .filter((file) => prefix.test(path.basename(file)));
}

function specCandidates(root, taskFile) {
  const basename = path.basename(taskFile);
  return SPEC_ROOTS.flatMap((folder) =>
    markdownFiles(root, path.join('.agents/spec-docs', folder)),
  ).filter((file) => path.basename(file) === basename);
}

/**
 * Enforce the only truthful pre-receipt ordering: substantive work first, Task/spec terminalization
 * next, then Work-Run ready and its receipt-only closure. The final full scan observes that closure.
 */
export function assertWorkRunReadyOrder(root, workId) {
  if (!workId) return;
  const tasks = taskCandidates(root, workId);
  if (tasks.length === 0) return;
  if (tasks.length !== 1) {
    throw new Error(`ready requires exactly one Task for ${workId}; found ${tasks.length}`);
  }

  const taskFile = tasks[0];
  const lifecycle = classifyTaskLifecycle(requireText(taskFile));
  const taskRel = path.relative(root, taskFile).split(path.sep).join('/');
  if (lifecycle.state !== 'terminal' || !taskRel.startsWith(`${COMPLETED_TASK_ROOT}/`)) {
    throw new Error(
      `ready requires Task ${workId} to be terminalized before Work-Run ready; ` +
        `current location/status is ${taskRel}/${lifecycle.status ?? '(missing)'}`,
    );
  }

  const specs = specCandidates(root, taskFile);
  if (specs.length > 1) {
    throw new Error(`ready requires exactly one spec for Task ${workId}; found ${specs.length}`);
  }
  if (specs.length === 1) {
    const specFolder = path.basename(path.dirname(specs[0]));
    const specStatus = asScalar(frontmatterObject(requireText(specs[0])).status);
    if (specFolder !== 'done' || specStatus !== 'done') {
      throw new Error(
        `ready requires spec ${workId} to be terminalized before Work-Run ready; ` +
          `current location/status is ${specFolder}/${specStatus || '(missing)'}`,
      );
    }
  }
}

function requireText(file) {
  // Malformed documents fail closed through their lifecycle classifier.
  return readFileSync(file, 'utf8');
}
