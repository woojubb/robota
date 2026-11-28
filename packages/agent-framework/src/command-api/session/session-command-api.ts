import { loadSessionLogEntries, validateSessionReplayLogEntries } from '@robota-sdk/agent-session';

import type { TCommandHostAction, TCommandUiIntent } from '../effects.js';
import type { ICommandHostSessionAccess } from '../host-context.js';
import type { ICommandSessionReplayValidationReport } from '../host-context.js';
import type { IAbandonedExecutions, ISessionLogSource } from '@robota-sdk/agent-session';

export const CLEAR_COMMAND_DESCRIPTION = 'Clear conversation history';
/**
 * Written for the model although the command is user-only: it states what the command does and why
 * the model does not run it, so the model neither offers it as routine nor attempts it. It discards
 * an unfinished managed execution whose effects nobody can confirm; only the person decides that.
 */
export const ABANDON_EXECUTION_COMMAND_DESCRIPTION =
  'Abandon a managed execution that did not finish (a crash or failure left it unresolved). ' +
  'Use it only when the session refuses new input because an earlier managed execution is unresolved. ' +
  'It records the abandonment, closes the open tool calls as failed, and returns what was abandoned ' +
  'and a warning that its tool calls may already have changed files or reached outside the session. ' +
  'The execution is never resumed or re-run. Only the user runs it: it discards an execution whose effects cannot be confirmed.';
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
 * One path, chosen because the member is required rather than possibly absent.
 *
 * There is no branch that falls back to reaching past the host into `getSession().clearHistory()`.
 * That is not the same operation — the host's version also broadcasts `history_cleared` to every
 * attached surface, so the fallback would silently clear the transcript on ONE surface and leave
 * the others showing it. That divergence is what an absence-guarded default buys, and why the
 * member is required instead of guarded "just in case".
 */
export function clearConversationHistory(context: ICommandHostSessionAccess): void {
  context.clearConversationHistory();
}

/** One path: the host owns the journal and the session, so it abandons and says what happened. */
export function abandonUnresolvedCommandExecutions(
  context: ICommandHostSessionAccess,
): Promise<IAbandonedExecutions> {
  return context.abandonUnresolvedExecutions();
}

export function parseSessionNameArgument(args: string): string | undefined {
  const name = args.trim();
  return name.length > 0 ? name : undefined;
}

/** `/rename` requests the HOST-executed rename (direct-on-session; `session_renamed` broadcast follows). */
export function createSessionRenameHostAction(name: string): TCommandHostAction {
  return { type: 'session-rename', name };
}

/** `/resume` asks the REQUESTING surface to open its session picker (UI intent). */
export function createShowSessionPickerIntent(): TCommandUiIntent {
  return { type: 'show-session-picker' };
}

/** `/exit` requests the HOST-executed session exit (process adapter; works on every surface). */
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
 * The one computed path, and its only owner.
 *
 * It is not the ELSE branch of an optional override hook: an override with a framework-owned
 * default and no overrider is not a capability — it is two declared paths, one of which is dead,
 * and the dead one is where the two would silently diverge.
 *
 * So the host's member is REQUIRED, the host delegates here, and this is the single place the
 * report is computed. There is no fallback branch (No-Fallback): a fallback with no caller is a
 * second implementation waiting to drift.
 */
export function computeSessionReplayValidationReport(
  source: ISessionLogSource,
  logReference: string,
): ICommandSessionReplayValidationReport {
  const entries = loadSessionLogEntries(source);
  return {
    logFile: logReference,
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
