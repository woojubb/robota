/**
 * #3282 §4c: the Project panel's "File diff" section — one file's change, as `IDiffLine[]` for the
 * SAME `DiffLines` component (#3330) the Edit/Write tool-call preview renders. A git-tracked path
 * diffs against HEAD (or the empty tree on an unborn branch — `git diff --cached` handles that on its
 * own, verified against a real unborn repository); an untracked path has no git baseline at all, so it
 * is shown the same way `buildWriteDiffState` shows a brand-new file: every line an addition.
 *
 * Every path this reads is checked with `isPathInside` (SEC-006, the repo's one containment
 * decision) before any git or filesystem call — a diff request naming a path outside the workspace is
 * refused, never run.
 */
import { resolve } from 'node:path';

import { isPathInside } from '@robota-sdk/agent-core/node';

import { NodeFileSystemAsync } from '../adapters/node-file-system.js';
import { GIT_STATUS_ARGS, parseStatusRecords } from './git-status.js';
import { isNotAGitRepositoryFailure } from './project-status-read.js';

import type { IGitProcessPort } from './git-process.js';
import type { IFileSystemAsync } from '@robota-sdk/agent-core';
import type { IDiffLine } from '@robota-sdk/agent-interface-session';

export type TProjectGitDiffResult =
  | { ok: true; diffLines: readonly IDiffLine[]; truncated: boolean }
  | { ok: false; code: 'not_a_repository'; message: string }
  | { ok: false; code: 'outside_workspace'; message: string }
  | { ok: false; code: 'git_failed'; message: string };

/** Matches `MAX_WRITE_DIFF_LINES` in `interactive-session-streaming.ts` — the ONE diff-line cap a
 *  surface already renders correctly (DiffLines has no fold of its own; a builder caps its output). */
export const MAX_PROJECT_DIFF_LINES = 500;

const BYTES_PER_KIB = 1024;
/**
 * The untracked-file diff preview's OWN read cap — smaller than the general 4 MiB project-read cap
 * (`MAX_PROJECT_READ_BYTES` in `workspace-trust/project-reader-path.ts`) because this file is
 * materialized whole into a string to build a line-by-line diff view, not streamed, and a Project
 * panel preview has no reason to hold megabytes of a build artifact or log file in the daemon's
 * memory just to say "too large". Checked via `stat` BEFORE any read (#3282 §4c review): a file over
 * this size is refused without ever touching the file's contents, so it can neither block the event
 * loop with a large synchronous-equivalent read nor slip a pathologically long line past the cap
 * below.
 */
const MAX_UNTRACKED_DIFF_BYTES = BYTES_PER_KIB * BYTES_PER_KIB; // 1 MiB

/** Matches the attachment resolver's own binary sniff (`prompt-file-reference-resolver.ts`): a NUL
 *  byte survives UTF-8 decoding unchanged, so checking the first 8 KiB of the (already size-capped)
 *  decoded content for one reliably flags binary content without raw-byte access. */
const BINARY_SNIFF_CHARS = 8 * BYTES_PER_KIB;

/** The line-count cap above bounds how many lines are shown, not how long any ONE of them is — a
 *  single very long line (e.g. a minified file on one line) is truncated here too. */
const MAX_DIFF_LINE_CHARS = 2000;

function outsideWorkspace(path: string): TProjectGitDiffResult {
  return { ok: false, code: 'outside_workspace', message: `"${path}" is outside the workspace.` };
}

/** Parses `git diff`'s unified-diff body into `IDiffLine[]`. A binary file's one-line notice becomes
 *  a single `hunk` line; anything before the first `@@` hunk header (the `diff --git`/`index`/`---`/
 *  `+++` preamble) is not itself a line of the change and is skipped. */
export function parseUnifiedDiffLines(diffText: string): IDiffLine[] {
  if (diffText.length === 0) return [];
  const lines = diffText.split('\n');
  const binary = lines.find((line) => line.startsWith('Binary files ') && line.endsWith('differ'));
  if (binary !== undefined) return [{ type: 'hunk', text: binary, lineNumber: 1 }];

  const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
  const result: IDiffLine[] = [];
  let oldLine = 1;
  let newLine = 1;
  for (const line of lines) {
    const hunk = HUNK_HEADER.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      result.push({ type: 'hunk', text: line, lineNumber: newLine });
      continue;
    }
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff --git')) continue;
    if (line.startsWith('index ') && /^index [0-9a-f]+\.\.[0-9a-f]+/.test(line)) continue;
    if (line.startsWith('\\')) continue; // "\ No newline at end of file" — not a diff line
    if (line.startsWith('+')) {
      result.push({ type: 'add', text: line.slice(1), lineNumber: newLine });
      newLine += 1;
    } else if (line.startsWith('-')) {
      result.push({ type: 'remove', text: line.slice(1), lineNumber: oldLine });
      oldLine += 1;
    } else if (line.startsWith(' ')) {
      result.push({ type: 'context', text: line.slice(1), lineNumber: newLine });
      oldLine += 1;
      newLine += 1;
    }
    // Anything else (an empty trailing element from the final `\n`) is skipped.
  }
  return result;
}

function capDiffLines(diffLines: readonly IDiffLine[]): { diffLines: IDiffLine[]; truncated: boolean } {
  if (diffLines.length <= MAX_PROJECT_DIFF_LINES) return { diffLines: [...diffLines], truncated: false };
  const shown = diffLines.slice(0, MAX_PROJECT_DIFF_LINES);
  const remaining = diffLines.length - MAX_PROJECT_DIFF_LINES;
  return {
    diffLines: [...shown, { type: 'hunk', text: `… ${remaining} more lines truncated`, lineNumber: 0 }],
    truncated: true,
  };
}

function couldNotReadDiffLines(): IDiffLine[] {
  return [{ type: 'hunk', text: 'This file could not be read.', lineNumber: 1 }];
}

function tooLargeDiffLines(): IDiffLine[] {
  return [{ type: 'hunk', text: 'This file is too large to show here.', lineNumber: 1 }];
}

function binaryFileDiffLines(): IDiffLine[] {
  return [{ type: 'hunk', text: 'Binary file', lineNumber: 1 }];
}

function looksBinary(content: string): boolean {
  return content.slice(0, BINARY_SNIFF_CHARS).includes('\u0000');
}

function truncateDiffLineText(text: string): string {
  return text.length > MAX_DIFF_LINE_CHARS ? `${text.slice(0, MAX_DIFF_LINE_CHARS)}… (line truncated)` : text;
}

/**
 * An untracked file has no git baseline — shown as a whole-file addition, `buildWriteDiffState`-style.
 * Stats the file before reading it: over `MAX_UNTRACKED_DIFF_BYTES`, it is refused without ever being
 * read. At or under that size, it is read once (bounded by the same check) and sniffed for binary
 * content the same way the composer's attachment resolver does.
 */
async function readUntrackedFileDiffLines(fs: IFileSystemAsync, absolutePath: string): Promise<IDiffLine[]> {
  let size: number;
  try {
    size = (await fs.stat(absolutePath)).size;
  } catch {
    return couldNotReadDiffLines();
  }
  if (size > MAX_UNTRACKED_DIFF_BYTES) return tooLargeDiffLines();

  let content: string;
  try {
    content = await fs.readFile(absolutePath, 'utf8');
  } catch {
    return couldNotReadDiffLines();
  }
  if (looksBinary(content)) return binaryFileDiffLines();

  // A file read from disk ends with a trailing newline far more often than not; without stripping
  // it, `split('\n')` manufactures one extra empty "added" line that was never really there.
  const lines = content.replace(/\n$/, '').split('\n');
  return [
    { type: 'hunk', text: `@@ -0,0 +1,${lines.length} @@`, lineNumber: 1 },
    ...lines.map((text, index) => ({
      type: 'add' as const,
      text: truncateDiffLineText(text),
      lineNumber: index + 1,
    })),
  ];
}

/** Whether `relativePath` (as `git status` names it from `cwd`) is untracked right now. */
async function isUntracked(
  port: IGitProcessPort,
  cwd: string,
  relativePath: string,
): Promise<boolean> {
  const outcome = await port.run([...GIT_STATUS_ARGS, '--', relativePath], { cwd });
  if (outcome.kind !== 'exited' || outcome.exitCode !== 0) return false;
  const parsed = parseStatusRecords(outcome.stdout);
  return parsed.records.some((record) => record.kind === 'untracked' && record.path === relativePath);
}

/**
 * The Project panel's one-file diff. `requestedPath` is workspace-relative, exactly as
 * {@link readProjectGitStatus} reported it — resolved against `cwd` and checked with `isPathInside`
 * before anything else runs.
 */
export async function readProjectGitDiff(
  port: IGitProcessPort,
  cwd: string,
  requestedPath: string,
  fs: IFileSystemAsync = new NodeFileSystemAsync(),
): Promise<TProjectGitDiffResult> {
  const absolutePath = resolve(cwd, requestedPath);
  if (!isPathInside(cwd, absolutePath)) return outsideWorkspace(requestedPath);

  const probe = await port.run(GIT_STATUS_ARGS, { cwd });
  if (probe.kind !== 'exited') {
    return { ok: false, code: 'git_failed', message: `git status failed: ${probe.reason} — ${probe.detail}` };
  }
  if (probe.exitCode !== 0) {
    if (isNotAGitRepositoryFailure(probe.stderr)) {
      return { ok: false, code: 'not_a_repository', message: 'This folder is not a git repository.' };
    }
    return { ok: false, code: 'git_failed', message: probe.stderr.trim() || 'git status failed' };
  }

  if (await isUntracked(port, cwd, requestedPath)) {
    const { diffLines, truncated } = capDiffLines(await readUntrackedFileDiffLines(fs, absolutePath));
    return { ok: true, diffLines, truncated };
  }

  const unborn = parseStatusRecords(probe.stdout).unborn;
  const args = unborn
    ? ['diff', '--cached', '--', requestedPath]
    : ['diff', '--end-of-options', 'HEAD', '--', requestedPath];
  const outcome = await port.run(args, { cwd });
  if (outcome.kind !== 'exited') {
    return { ok: false, code: 'git_failed', message: `git diff failed: ${outcome.reason} — ${outcome.detail}` };
  }
  if (outcome.exitCode !== 0) {
    const stderr = outcome.stderr.trim();
    return { ok: false, code: 'git_failed', message: stderr.length > 0 ? stderr : 'git diff failed' };
  }
  const { diffLines, truncated } = capDiffLines(parseUnifiedDiffLines(outcome.stdout));
  return { ok: true, diffLines, truncated };
}
