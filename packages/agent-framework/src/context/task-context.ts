import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

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
}

export interface IUpdateTaskFileStatusOptions {
  now?: Date;
  progressMessage?: string;
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
  return content
    .split(/\r?\n/)
    .map((line) => /^- \[ \]\s+(.+)$/.exec(line)?.[1]?.trim())
    .filter((item): item is string => item !== undefined && item.length > 0);
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

function formatDate(date: Date): string {
  return date.toISOString().slice(Number('0'), Number('10'));
}

function upsertStatusLine(content: string, status: TTaskFileStatus): string {
  const lines = content.split(/\r?\n/);
  const statusLine = `- **Status**: ${status}`;
  const statusIndex = lines.findIndex((line) => /^- \*\*Status\*\*:\s*/.test(line));
  if (statusIndex >= Number('0')) {
    lines[statusIndex] = statusLine;
    return lines.join('\n');
  }

  const hasTopHeading = lines.length > Number('0') && /^#\s+/.test(lines[Number('0')]);
  if (hasTopHeading) {
    lines.splice(Number('1'), Number('0'), '', statusLine);
  } else {
    lines.unshift(statusLine, '');
  }
  return lines.join('\n');
}

function appendProgressEntry(content: string, now: Date, progressMessage: string): string {
  const entryLines = [`### ${formatDate(now)}`, `- ${progressMessage.trim()}`];
  const lines = content.replace(/\s+$/u, '').split(/\r?\n/);
  const progressIndex = lines.findIndex((line) => /^## Progress\s*$/.test(line));
  if (progressIndex < Number('0')) {
    return [...lines, '', '## Progress', '', ...entryLines, ''].join('\n');
  }

  const nextHeadingIndex = lines.findIndex(
    (line, index) => index > progressIndex && /^##\s+/.test(line),
  );
  if (nextHeadingIndex < Number('0')) {
    return [...lines, '', ...entryLines, ''].join('\n');
  }

  lines.splice(nextHeadingIndex, Number('0'), '', ...entryLines, '');
  return lines.join('\n');
}

function resolveGitDirectory(cwd: string): string | undefined {
  let current = resolve(cwd);
  let reachedRoot = false;
  while (!reachedRoot) {
    const gitPath = join(current, '.git');
    if (existsSync(gitPath)) {
      const stats = statSync(gitPath);
      if (stats.isDirectory()) return gitPath;
      const content = readFileSync(gitPath, 'utf8').trim();
      const gitdir = content.match(/^gitdir:\s*(.+)$/)?.[1];
      if (gitdir) return isAbsolute(gitdir) ? gitdir : resolve(current, gitdir);
    }

    const parent = dirname(current);
    reachedRoot = parent === current;
    current = parent;
  }
  return undefined;
}

export function readCurrentGitBranch(cwd: string): string | undefined {
  const gitDir = resolveGitDirectory(cwd);
  if (!gitDir) return undefined;
  const headPath = join(gitDir, 'HEAD');
  if (!existsSync(headPath)) return undefined;

  const head = readFileSync(headPath, 'utf8').trim();
  const branch = head.match(/^ref:\s+refs\/heads\/(.+)$/)?.[1];
  return branch?.trim();
}

export function discoverTaskFiles(cwd: string): string[] {
  const tasksDir = join(cwd, TASKS_DIR);
  if (!existsSync(tasksDir)) {
    return [];
  }

  return readdirSync(tasksDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name !== README_FILENAME && name.endsWith(MARKDOWN_EXTENSION))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => join(tasksDir, name));
}

export function parseTaskFile(taskPath: string, cwd: string): ITaskContextFile {
  const content = readFileSync(taskPath, 'utf8');
  return {
    path: taskPath,
    relativePath: relative(cwd, taskPath),
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

export function loadTaskContext(cwd: string, options: ITaskSelectionOptions = {}): string {
  const currentBranch = options.currentBranch ?? readCurrentGitBranch(cwd);
  const tasks = discoverTaskFiles(cwd).map((path) => parseTaskFile(path, cwd));
  return formatTaskContext(selectRelevantTasks(tasks, { ...options, currentBranch }));
}

export function updateTaskFileStatus(
  taskPath: string,
  status: TTaskFileStatus,
  options: IUpdateTaskFileStatusOptions = {},
): void {
  const updated = upsertStatusLine(readFileSync(taskPath, 'utf8'), status);
  const withProgress = options.progressMessage
    ? appendProgressEntry(updated, options.now ?? new Date(), options.progressMessage)
    : updated;
  writeFileSync(taskPath, withProgress, 'utf8');
}
