/**
 * What the harness reads off DISK, as opposed to out of the session.
 *
 * Split from `scripted-session-harness.ts`, which had reached its size ratchet where the rule is to
 * split rather than extend. The boundary is real rather than convenient: everything here answers a
 * question about the workspace — what the framework WROTE — while the harness's other inspectors
 * answer questions about live session state. A test asserting on the transcript is using the
 * system's own durable record as its verification surface, and that is a different kind of evidence
 * from reading an in-memory field.
 *
 * Free functions taking the paths they need, so none of them can reach for session state and
 * quietly become the other kind.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** The real session-log directory the framework writes to, under the workspace. */
export function logsDirOf(cwd: string): string {
  return join(cwd, '.robota', 'logs');
}

/** Path of the real JSONL transcript the framework writes for one session. */
export function transcriptPathOf(cwd: string, sessionId: string): string {
  return join(logsDirOf(cwd), `${sessionId}.jsonl`);
}

/**
 * Raw contents of the real session transcript.
 *
 * Returns `''` when no transcript exists rather than throwing: "the framework wrote nothing" is a
 * legitimate outcome a test may want to assert, and it is not the same as a broken read.
 */
export function transcriptOf(cwd: string, sessionId: string): string {
  const path = transcriptPathOf(cwd, sessionId);
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

/**
 * The transcript parsed into structured log entries — the durable record the framework itself
 * writes (`{ timestamp, sessionId, event, … }` per line).
 */
export function logEntriesOf(cwd: string, sessionId: string): Array<Record<string, unknown>> {
  return transcriptOf(cwd, sessionId)
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** Read a workspace file by workspace-relative path. */
export function readWorkspaceFile(cwd: string, relPath: string): string {
  return readFileSync(join(cwd, relPath), 'utf8');
}

/** Does a workspace-relative path exist? */
export function workspaceFileExists(cwd: string, relPath: string): boolean {
  return existsSync(join(cwd, relPath));
}

/**
 * Every file in the workspace, workspace-relative, excluding the framework's own state directory —
 * a test asserting "what did the agent create" means the agent's files, and the session log is not
 * one of them.
 *
 * Paths are normalised to forward slashes. A test asserting `'src/index.ts'` should not have to
 * care which platform ran it, and the alternative is an assertion that passes on CI and fails on a
 * developer's Windows machine for a reason that has nothing to do with the behaviour under test.
 */
export function workspaceFiles(cwd: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.robota') continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else out.push(relative(cwd, abs).split(sep).join('/'));
    }
  };
  walk(cwd);
  return out.sort();
}
