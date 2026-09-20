/**
 * BEHAVIOR-2437: `/git status` — `git status --porcelain=v2 -z --branch`, parsed into the branch and
 * the staged, unstaged, untracked (and, when present, conflicted) path sets.
 *
 * `-z` is what makes a path with a space, a quote, a newline or a non-ASCII character ONE element,
 * and it is why a `2` (rename/copy) record is read as TWO NUL-terminated fields — `path`, then
 * `origPath` — so the pair stays a pair.
 */
import { gitFailureMessage } from './git-process.js';

import type { IGitProcessPort } from './git-process.js';
import type { ICommandResult } from '@robota-sdk/agent-interface-command';

export const GIT_STATUS_ARGS: readonly string[] = ['status', '--porcelain=v2', '-z', '--branch'];

export interface IGitStatusSummary {
  /** `branch.head`; `(detached)` when detached; `undefined` when git printed no branch header. */
  branch: string | undefined;
  /** `branch.oid` is `(initial)` on an unborn branch. */
  unborn: boolean;
  staged: readonly string[];
  unstaged: readonly string[];
  untracked: readonly string[];
  conflicted: readonly string[];
}

const ORDINARY = /^1 (\S\S) \S+ \S+ \S+ \S+ \S+ \S+ ([^]*)$/;
const RENAMED = /^2 (\S\S) \S+ \S+ \S+ \S+ \S+ \S+ \S+ ([^]*)$/;
const UNMERGED = /^u \S\S \S+ \S+ \S+ \S+ \S+ \S+ \S+ \S+ ([^]*)$/;

interface IStatusAccumulator {
  branch: string | undefined;
  unborn: boolean;
  staged: string[];
  unstaged: string[];
  untracked: string[];
  conflicted: string[];
}

function classify(acc: IStatusAccumulator, xy: string, display: string): void {
  if (xy[0] !== '.') acc.staged.push(display);
  if (xy[1] !== '.') acc.unstaged.push(display);
}

function readHeader(acc: IStatusAccumulator, record: string): void {
  if (record.startsWith('# branch.head ')) acc.branch = record.slice('# branch.head '.length);
  else if (record.startsWith('# branch.oid ')) {
    acc.unborn = record.slice('# branch.oid '.length) === '(initial)';
  }
}

/** Reads one record; returns how many EXTRA NUL-terminated fields it consumed (1 for a rename). */
function readRecord(acc: IStatusAccumulator, record: string, next: string | undefined): number {
  if (record.startsWith('# ')) {
    readHeader(acc, record);
    return 0;
  }
  if (record.startsWith('? ')) {
    acc.untracked.push(record.slice(2));
    return 0;
  }
  if (record.startsWith('1 ')) {
    const match = ORDINARY.exec(record);
    if (match) classify(acc, match[1] ?? '..', match[2] ?? '');
    return 0;
  }
  if (record.startsWith('2 ')) {
    // The original path is the NEXT NUL-terminated field.
    const match = RENAMED.exec(record);
    if (match) classify(acc, match[1] ?? '..', `${match[2] ?? ''} (from ${next ?? ''})`);
    return 1;
  }
  if (record.startsWith('u ')) {
    const match = UNMERGED.exec(record);
    if (match) acc.conflicted.push(match[1] ?? '');
  }
  return 0;
}

export function parseStatusPorcelainV2(stdout: string): IGitStatusSummary {
  const fields = stdout.split('\0');
  const acc: IStatusAccumulator = {
    branch: undefined,
    unborn: false,
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: [],
  };
  for (let index = 0; index < fields.length; index += 1) {
    const record = fields[index] ?? '';
    if (record.length === 0) continue;
    index += readRecord(acc, record, fields[index + 1]);
  }
  return acc;
}

function group(label: string, paths: readonly string[]): string {
  return `${label} (${paths.length}):${paths.length > 0 ? ` ${paths.join(', ')}` : ''}`;
}

export function formatGitStatus(summary: IGitStatusSummary): string {
  const head =
    summary.branch === undefined
      ? 'No branch information'
      : summary.branch === '(detached)'
        ? 'HEAD detached'
        : `On branch ${summary.branch}${summary.unborn ? ' (no commits yet)' : ''}`;
  const lines = [
    head,
    group('staged', summary.staged),
    group('unstaged', summary.unstaged),
    group('untracked', summary.untracked),
  ];
  if (summary.conflicted.length > 0) lines.push(group('conflicted', summary.conflicted));
  return lines.join('\n');
}

export async function executeGitStatus(
  port: IGitProcessPort,
  cwd: string,
): Promise<ICommandResult> {
  const outcome = await port.run(GIT_STATUS_ARGS, { cwd });
  const failure = gitFailureMessage('status', outcome);
  if (failure !== undefined || outcome.kind !== 'exited') {
    return { success: false, message: failure ?? 'git status failed' };
  }
  const summary = parseStatusPorcelainV2(outcome.stdout);
  return {
    success: true,
    message: formatGitStatus(summary),
    data: { git: 'status', ...summary },
  };
}
