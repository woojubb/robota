import { join } from 'node:path';

import { loadSessionLogEntries, validateSessionReplayLogEntries } from '@robota-sdk/agent-session';

import { projectPaths } from '../../paths.js';

import type { TCommandHostAction, TCommandUiIntent } from '../effects.js';
import type { ICommandHostContext } from '../host-context.js';
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

export function clearConversationHistory(context: ICommandHostContext): void {
  if (context.clearConversationHistory !== undefined) {
    context.clearConversationHistory();
    return;
  }

  context.getSession().clearHistory();
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

export function readCommandSessionInfo(context: ICommandHostContext): ICommandSessionInfo {
  const session = context.getSession();
  return {
    sessionId: session.getSessionId(),
    messageCount: session.getMessageCount(),
  };
}

export function validateCommandSessionReplayLog(
  context: ICommandHostContext,
): ICommandSessionReplayValidationReport {
  const hostReport = context.validateCurrentSessionReplayLog?.();
  if (hostReport !== undefined) {
    return hostReport;
  }

  const sessionId = context.getSession().getSessionId();
  const logFile = join(projectPaths(context.getCwd()).logs, `${sessionId}.jsonl`);
  const entries = loadSessionLogEntries(logFile);
  return {
    logFile,
    entryCount: entries.length,
    validation: validateSessionReplayLogEntries(entries),
  };
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
