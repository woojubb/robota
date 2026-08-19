import { join } from 'node:path';

import { loadSessionLogEntries, validateSessionReplayLogEntries } from '@robota-sdk/agent-session';

import { projectPaths } from '../../paths.js';

import type { TCommandHostAction, TCommandUiIntent } from '../effects.js';
import type { ICommandHostSessionAccess } from '../host-context.js';
import type { ICommandSessionReplayValidationReport } from '../host-context.js';

export const CLEAR_COMMAND_DESCRIPTION = 'Clear conversation history';
export const RENAME_COMMAND_DESCRIPTION = 'Rename the current session';
export const RENAME_COMMAND_USAGE = 'Usage: rename <name>';
export const RESUME_COMMAND_DESCRIPTION = 'Resume a previous session';
export const COST_COMMAND_DESCRIPTION =
  'Show session token usage and estimated cost. /cost budget <amount> sets a monthly budget.';
export const VALIDATE_SESSION_COMMAND_DESCRIPTION = 'Validate current session replay log';
export const EXIT_COMMAND_DESCRIPTION = 'Exit CLI';

export interface ICommandSessionInfo {
  sessionId: string;
  messageCount: number;
}

/**
 * ARCH-029 TC-09 — one path, chosen because the member is required rather than possibly absent.
 *
 * This used to branch: call the host's richer clear when present, otherwise reach past it into
 * `getSession().clearHistory()`. Those are not the same operation — the host's version also
 * broadcasts `history_cleared` to every attached surface (CMD-004 Stage E), so the fallback
 * silently cleared the transcript on ONE surface and left the others showing it. That divergence
 * is what an absence-guarded default buys, and why the member being required removes the guard
 * rather than keeping it "just in case".
 */
export function clearConversationHistory(context: ICommandHostSessionAccess): void {
  context.clearConversationHistory();
}

export function parseSessionNameArgument(args: string): string | undefined {
  const name = args.trim();
  return name.length > 0 ? name : undefined;
}

/** CMD-004: `/rename` requests the HOST-executed rename (direct-on-session; `session_renamed` broadcast follows). */
export function createSessionRenameHostAction(name: string): TCommandHostAction {
  return { type: 'session-rename', name };
}

/** CMD-004: `/resume` asks the REQUESTING surface to open its session picker (UI intent). */
export function createShowSessionPickerIntent(): TCommandUiIntent {
  return { type: 'show-session-picker' };
}

/** CMD-004: `/exit` requests the HOST-executed session exit (process adapter; works on every surface). */
export function createSessionExitHostAction(): TCommandHostAction {
  return { type: 'session-exit' };
}

export function readCommandSessionInfo(context: ICommandHostSessionAccess): ICommandSessionInfo {
  const session = context.getSession();
  return {
    sessionId: session.getSessionId(),
    messageCount: session.getMessageCount(),
  };
}

/**
 * ARCH-029 TC-08 — the one computed path, and its only owner.
 *
 * This used to be the ELSE branch of an override hook: `validateCurrentSessionReplayLog?.()` was
 * optional, and no production host implemented it, so this branch was the only code that ever ran.
 * An override with a framework-owned default and no overrider is not a capability — it is two
 * declared paths, one of which is dead, and the dead one is where the two would silently diverge.
 *
 * So the member is now REQUIRED, the host delegates here, and this is the single place the report
 * is computed. Deleting the branch rather than leaving it as a fallback is the point (No-Fallback):
 * a fallback that no longer has a caller is a second implementation waiting to drift.
 */
export function computeSessionReplayValidationReport(
  cwd: string,
  sessionId: string,
): ICommandSessionReplayValidationReport {
  const logFile = join(projectPaths(cwd).logs, `${sessionId}.jsonl`);
  const entries = loadSessionLogEntries(logFile);
  return {
    logFile,
    entryCount: entries.length,
    validation: validateSessionReplayLogEntries(entries),
  };
}

export function validateCommandSessionReplayLog(
  context: ICommandHostSessionAccess,
): ICommandSessionReplayValidationReport {
  return context.validateCurrentSessionReplayLog();
}

export function formatCommandSessionReplayValidationReport(
  report: ICommandSessionReplayValidationReport,
): string {
  const header = report.validation.ok
    ? 'Session replay log is valid.'
    : `Session replay log has ${report.validation.issues.length} issue(s).`;
  const details = [`Log: ${report.logFile}`, `Entries: ${report.entryCount}`];
  if (report.validation.ok) {
    return [header, ...details].join('\n');
  }

  const issueLines = report.validation.issues.map((issue, index) => {
    const location = formatReplayValidationIssueLocation(issue);
    return `${index + 1}. ${issue.code}${location}: ${issue.message}`;
  });
  return [header, ...details, '', ...issueLines].join('\n');
}

function formatReplayValidationIssueLocation(
  issue: ICommandSessionReplayValidationReport['validation']['issues'][number],
): string {
  const parts: string[] = [];
  if (issue.executionId !== undefined) {
    parts.push(`execution=${issue.executionId}`);
  }
  if (issue.round !== undefined) {
    parts.push(`round=${issue.round}`);
  }
  if (issue.toolCallId !== undefined) {
    parts.push(`tool=${issue.toolCallId}`);
  }
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

export type { ICommandSessionReplayValidationReport };
