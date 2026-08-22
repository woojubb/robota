import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

import { NodeFileSystem } from '../adapters/node-file-system.js';
import { assertWorkspaceProjectReader } from '../workspace-trust/index.js';

import type { IWorkspaceProjectReader } from '../workspace-trust/index.js';
import type { IFileSystem } from '@robota-sdk/agent-core';

export type TTaskFileStatus = 'todo' | 'in-progress' | 'blocked' | 'completed' | 'unknown';

export interface ITaskContextFile {
  path: string;
  relativePath: string;
  title: string;
  status: TTaskFileStatus;
  branch?: string;
  scope?: string;
  objective?: string;
  openItems: readonly string[];
}

export interface ITaskSelectionOptions {
  currentBranch?: string;
  maxTasks?: number;
  /**
   * NEUT-004: task-file scan directory relative to cwd. Defaults to the supported
   * `.agents/tasks` convention.
   */
  dir?: string;
}

const TASKS_DIR = join('.agents', 'tasks');
const README_FILENAME = 'README.md';
const MARKDOWN_EXTENSION = '.md';
const DEFAULT_MAX_TASKS = Number('3');
const STATUS_PRIORITIES: Record<TTaskFileStatus, number> = {
  'in-progress': Number('1'),
  todo: Number('2'),
  blocked: Number('3'),
  unknown: Number('4'),
  completed: Number('5'),
};

function normalizeStatus(value: string | undefined): TTaskFileStatus {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === 'todo' ||
    normalized === 'in-progress' ||
    normalized === 'blocked' ||
    normalized === 'completed'
  ) {
    return normalized;
  }
  return 'unknown';
}

function extractTitle(content: string, taskPath: string): string {
  const heading = content.split(/\r?\n/).find((line) => /^#\s+/.test(line));
  return heading?.replace(/^#\s+/, '').trim() || basename(taskPath, MARKDOWN_EXTENSION);
}

function extractMetadata(content: string, key: string): string | undefined {
  const matcher = new RegExp(`^- \\*\\*${key}\\*\\*:\\s*(.+)$`, 'im');
  return matcher.exec(content)?.[1]?.trim();
}

function extractSection(content: string, title: string): string | undefined {
  const lines = content.split(/\r?\n/);
  const heading = new RegExp(`^(#{2,6})\\s+${title}\\b`, 'i');
  const startIndex = lines.findIndex((line) => heading.test(line));
  if (startIndex < 0) {
    return undefined;
  }

  const collected: string[] = [];
  for (const line of lines.slice(startIndex + Number('1'))) {
    if (/^##\s+/.test(line)) {
      break;
    }
    collected.push(line);
  }

  const result = collected.join('\n').trim();
  return result.length > 0 ? result : undefined;
}

function extractOpenItems(content: string): string[] {
  return (
    content
      .split(/\r?\n/)
      // `(\S.*)` rather than `(.+)` — same `\s`/`.` ambiguity as the `gitdir:` line above. A lone `\r` (a CR-only
      // line ending) survives the `/\r?\n/` split, so a "line" can hold a long space run that never reaches `$`.
      .map((line) => /^- \[ \]\s+(\S.*)$/.exec(line)?.[1]?.trim())
      .filter((item): item is string => item !== undefined && item.length > 0)
  );
}

function taskSortScore(task: ITaskContextFile, currentBranch?: string): number {
  if (currentBranch && task.branch === currentBranch) {
    return Number('0');
  }
  return STATUS_PRIORITIES[task.status];
}

function formatTask(task: ITaskContextFile): string {
  const lines = [`### ${task.title}`, `- **Path:** \`${task.relativePath}\``];
  lines.push(`- **Status:** ${task.status}`);
  if (task.branch) lines.push(`- **Branch:** ${task.branch}`);
  if (task.scope) lines.push(`- **Scope:** ${task.scope}`);
  if (task.objective) lines.push(`- **Objective:** ${task.objective}`);
  if (task.openItems.length > 0) {
    lines.push('- **Open items:**');
    lines.push(...task.openItems.map((item) => `  - ${item}`));
  }
  return lines.join('\n');
}

function resolveGitDirectory(cwd: string, fs: IFileSystem): string | undefined {
  let current = resolve(cwd);
  let reachedRoot = false;
  while (!reachedRoot) {
    const gitPath = join(current, '.git');
    if (fs.existsSync(gitPath)) {
      const stats = fs.statSync(gitPath);
      if (stats.isDirectory()) return gitPath;
      const content = fs.readFileSync(gitPath, 'utf8').trim();
      // `(\S.*)` rather than `(.+)`: `\s*` and `.` both match a space, so the split between them was ambiguous
      // and a `.git` file with a long space run cost O(n²) (SEC-003). Greedy `\s*` already consumed every
      // leading space, so pinning the capture to start non-space accepts exactly the same (trimmed) content.
      const gitdir = content.match(/^gitdir:\s*(\S.*)$/)?.[1];
      if (gitdir) return isAbsolute(gitdir) ? gitdir : resolve(current, gitdir);
    }

    const parent = dirname(current);
    reachedRoot = parent === current;
    current = parent;
  }
  return undefined;
}

export function readCurrentGitBranchFromNodeHost(
  cwd: string,
  fs: IFileSystem = new NodeFileSystem(),
): string | undefined {
  const gitDir = resolveGitDirectory(cwd, fs);
  if (!gitDir) return undefined;
  const headPath = join(gitDir, 'HEAD');
  if (!fs.existsSync(headPath)) return undefined;

  const head = fs.readFileSync(headPath, 'utf8').trim();
  const branch = head.match(/^ref:\s+refs\/heads\/(.+)$/)?.[1];
  return branch?.trim();
}

export function discoverTaskFiles(
  reader: IWorkspaceProjectReader,
  dir: string = TASKS_DIR,
): string[] {
  const accepted = assertWorkspaceProjectReader(reader);
  return accepted
    .listDirectory(dir, 'discover project task context')
    .filter((entry) => entry.kind === 'file')
    .map((entry) => entry.name)
    .filter((name) => name !== README_FILENAME && name.endsWith(MARKDOWN_EXTENSION))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => join(dir, name));
}

export function parseTaskFile(taskPath: string, reader: IWorkspaceProjectReader): ITaskContextFile {
  const content = assertWorkspaceProjectReader(reader).readText(
    taskPath,
    'load project task context',
  );
  if (content === undefined) throw new Error(`Task context file is missing: ${taskPath}`);
  return {
    path: taskPath,
    relativePath: taskPath,
    title: extractTitle(content, taskPath),
    status: normalizeStatus(extractMetadata(content, 'Status')),
    branch: extractMetadata(content, 'Branch'),
    scope: extractMetadata(content, 'Scope'),
    objective: extractSection(content, 'Objective'),
    openItems: extractOpenItems(content),
  };
}

export function selectRelevantTasks(
  tasks: readonly ITaskContextFile[],
  options: ITaskSelectionOptions = {},
): ITaskContextFile[] {
  const maxTasks = options.maxTasks ?? DEFAULT_MAX_TASKS;
  return [...tasks]
    .filter((task) => task.status !== 'completed')
    .sort(
      (left, right) =>
        taskSortScore(left, options.currentBranch) - taskSortScore(right, options.currentBranch) ||
        left.relativePath.localeCompare(right.relativePath),
    )
    .slice(Number('0'), maxTasks);
}

export function formatTaskContext(tasks: readonly ITaskContextFile[]): string {
  return tasks.map(formatTask).join('\n\n');
}

export function loadTaskContext(
  reader: IWorkspaceProjectReader,
  options: ITaskSelectionOptions = {},
): string {
  const currentBranch = options.currentBranch;
  const tasks = discoverTaskFiles(reader, options.dir).map((path) => parseTaskFile(path, reader));
  return formatTaskContext(selectRelevantTasks(tasks, { ...options, currentBranch }));
}
