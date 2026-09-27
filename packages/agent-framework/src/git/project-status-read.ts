/**
 * #3282 §4c: the Project panel's "Changes" section — the workspace's git status turned into the
 * panel's shape: a plain-word status per file (never a raw `MM`/`??` code, per the #3277 "usable by
 * anyone" principle) with the lines added/removed since HEAD, and an explicit `repository: false` for
 * a folder that is not a git repository at all — the panel's one plain sentence — rather than an error.
 *
 * Reuses the exact `git status --porcelain=v2` call and record parser `/git status` runs
 * (`parseStatusRecords` in `./git-status.js`), so the panel and the command never disagree about what
 * counts as staged, unstaged or untracked. The lines-added/removed counts are the ONE thing `/git
 * status`'s text summary does not need and this panel does — added here via two batched `git diff
 * --numstat -z` calls (never one per file: a workspace with many changed files must not spawn a git
 * process per row).
 */
import { GIT_STATUS_ARGS, parseStatusRecords } from './git-status.js';

import type { IGitProcessPort } from './git-process.js';

/** Never a raw XY code — the #3277 "usable by anyone" principle applies to this panel too. */
export type TProjectFileStatus =
  | 'Added'
  | 'Modified'
  | 'Deleted'
  | 'Renamed'
  | 'Copied'
  | 'Untracked'
  | 'Conflicted';

export interface IProjectGitStatusFile {
  path: string;
  status: TProjectFileStatus;
  /** For a rename/copy, the record's own prior path. */
  renamedFrom?: string;
  /** Lines added/removed since HEAD (or the empty tree on an unborn branch). Absent for Untracked and
   *  Conflicted — no single baseline to diff against — and for a binary file (git counts it as `-`). */
  added?: number;
  removed?: number;
}

export type TProjectGitStatusResult =
  | {
      ok: true;
      repository: true;
      branch: string | undefined;
      unborn: boolean;
      files: readonly IProjectGitStatusFile[];
      /** True when `files` stopped at {@link MAX_STATUS_FILES} — there were more. */
      truncated: boolean;
    }
  | { ok: true; repository: false }
  | { ok: false; message: string };

/** Bounds the panel's file list — #3282 §4c "bound every output: file count, diff lines and bytes". */
export const MAX_STATUS_FILES = 200;

const NOT_A_REPOSITORY_PATTERN = /not a git repository/i;

/** Whether a failed git run means "this folder is not a git repository" (vs. a real git failure). */
export function isNotAGitRepositoryFailure(stderr: string): boolean {
  return NOT_A_REPOSITORY_PATTERN.test(stderr);
}

const primaryStatusLetter = (xy: string): string => (xy[0] !== '.' ? (xy[0] ?? '.') : (xy[1] ?? '.'));

function plainWordStatus(letter: string): TProjectFileStatus {
  switch (letter) {
    case 'A':
      return 'Added';
    case 'D':
      return 'Deleted';
    case 'R':
      return 'Renamed';
    case 'C':
      return 'Copied';
    default:
      // 'M' (modified) and 'T' (type change, e.g. file <-> symlink) both read as "Modified" — a type
      // change with no content change is still a change worth naming in the panel's own words.
      return 'Modified';
  }
}

/** Parses one `--numstat -z` run's output into `path -> {added, removed}`. `-` (binary) is absent. */
function parseNumstatZ(stdout: string): Map<string, { added?: number; removed?: number }> {
  const result = new Map<string, { added?: number; removed?: number }>();
  const fields = stdout.split('\0').filter((field) => field.length > 0);
  for (const field of fields) {
    const [addedRaw, removedRaw, path] = field.split('\t');
    if (path === undefined) continue;
    const added = addedRaw === '-' ? undefined : Number(addedRaw);
    const removed = removedRaw === '-' ? undefined : Number(removedRaw);
    result.set(path, {
      ...(added !== undefined && Number.isFinite(added) ? { added } : {}),
      ...(removed !== undefined && Number.isFinite(removed) ? { removed } : {}),
    });
  }
  return result;
}

function mergeCounts(
  a: { added?: number; removed?: number } | undefined,
  b: { added?: number; removed?: number } | undefined,
): { added?: number; removed?: number } | undefined {
  if (a === undefined && b === undefined) return undefined;
  const added = (a?.added ?? 0) + (b?.added ?? 0);
  const removed = (a?.removed ?? 0) + (b?.removed ?? 0);
  return { added, removed };
}

/**
 * Lines added/removed for `paths`, staged and unstaged combined — two batched calls (never one per
 * file). `--cached` alone diffs against the empty tree on an unborn branch (verified: git handles this
 * without error), so no branch on `unborn` is needed here. `--no-renames` keeps a renamed path's
 * numstat row keyed by its CURRENT name — the same name `parseStatusRecords` reports — instead of a
 * `{old => new}` pair this parser would then have to unpick.
 */
async function readNumstatCounts(
  port: IGitProcessPort,
  cwd: string,
  paths: readonly string[],
): Promise<Map<string, { added?: number; removed?: number }>> {
  if (paths.length === 0) return new Map();
  const [worktree, staged] = await Promise.all([
    port.run(['diff', '--numstat', '-z', '--no-renames', '--', ...paths], { cwd }),
    port.run(['diff', '--numstat', '-z', '--no-renames', '--cached', '--', ...paths], { cwd }),
  ]);
  const worktreeCounts = worktree.kind === 'exited' ? parseNumstatZ(worktree.stdout) : new Map();
  const stagedCounts = staged.kind === 'exited' ? parseNumstatZ(staged.stdout) : new Map();
  const merged = new Map<string, { added?: number; removed?: number }>();
  for (const path of paths) {
    const combined = mergeCounts(worktreeCounts.get(path), stagedCounts.get(path));
    if (combined !== undefined) merged.set(path, combined);
  }
  return merged;
}

/** The Project panel's git status: `/git status`'s own record parser, turned into the panel's shape. */
export async function readProjectGitStatus(
  port: IGitProcessPort,
  cwd: string,
): Promise<TProjectGitStatusResult> {
  const outcome = await port.run(GIT_STATUS_ARGS, { cwd });
  if (outcome.kind !== 'exited') {
    return { ok: false, message: `git status failed: ${outcome.reason} — ${outcome.detail}` };
  }
  if (outcome.exitCode !== 0) {
    if (isNotAGitRepositoryFailure(outcome.stderr)) return { ok: true, repository: false };
    const stderr = outcome.stderr.trim();
    return {
      ok: false,
      message: stderr.length > 0 ? `git status failed: ${stderr}` : 'git status failed',
    };
  }

  const parsed = parseStatusRecords(outcome.stdout);
  const countable = parsed.records.filter(
    (record) => record.kind === 'ordinary' || record.kind === 'renamed',
  );
  const counts = await readNumstatCounts(
    port,
    cwd,
    countable.map((record) => record.path),
  );

  const files: IProjectGitStatusFile[] = parsed.records.map((record) => {
    if (record.kind === 'untracked') return { path: record.path, status: 'Untracked' };
    if (record.kind === 'unmerged') return { path: record.path, status: 'Conflicted' };
    const status = plainWordStatus(primaryStatusLetter(record.xy));
    const count = counts.get(record.path);
    return {
      path: record.path,
      status,
      ...(record.kind === 'renamed' && record.origPath !== undefined
        ? { renamedFrom: record.origPath }
        : {}),
      ...count,
    };
  });

  const truncated = files.length > MAX_STATUS_FILES;
  return {
    ok: true,
    repository: true,
    branch: parsed.branch,
    unborn: parsed.unborn,
    files: truncated ? files.slice(0, MAX_STATUS_FILES) : files,
    truncated,
  };
}
