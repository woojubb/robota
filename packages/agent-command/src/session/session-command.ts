import { closeSync, constants, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { confirmAction, isConfirmed } from '@robota-sdk/agent-core';
import {
  RENAME_COMMAND_USAGE,
  clearConversationHistory,
  createShowSessionPickerIntent,
  createSessionRenameHostAction,
  formatCommandSessionReplayValidationReport,
  parseSessionNameArgument,
  readCommandSessionInfo,
  validateCommandSessionReplayLog,
} from '@robota-sdk/agent-framework';

import { calculateCost, formatTokens, formatUsd } from './model-pricing.js';

import type {
  ICommandHostNoCapability,
  ICommandHostSessionAccess,
  ICommandHostUserInteraction,
  ICommandHostWorkspace,
} from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-transport';

export const CLEAR_COMMAND_MESSAGE = 'Conversation cleared.';

export async function executeClearCommand(
  context: ICommandHostSessionAccess & ICommandHostUserInteraction,
  _args: string,
): Promise<ICommandResult> {
  // Confirm only when an interactive renderer is attached; with no human the explicit /clear proceeds.
  const ui = context.getUserInteraction();
  if (ui) {
    const response = await ui.ask(confirmAction('clear', 'Clear conversation history?'));
    if (!isConfirmed(response)) {
      return { success: true, message: 'Clear cancelled.' };
    }
  }

  // CMD-004 Stage E: the clear mutation runs host-side and the session broadcasts `history_cleared`
  // to every attached surface — the result carries no separate notification.
  clearConversationHistory(context);
  return { success: true, message: CLEAR_COMMAND_MESSAGE };
}

export function executeRenameCommand(
  _context: ICommandHostNoCapability,
  args: string,
): ICommandResult {
  const name = parseSessionNameArgument(args);
  if (name === undefined) {
    return { success: false, message: RENAME_COMMAND_USAGE };
  }

  return {
    success: true,
    message: `Session renamed to "${name}".`,
    data: { name },
    hostActions: [createSessionRenameHostAction(name)],
  };
}

export function executeResumeCommand(): ICommandResult {
  return {
    success: true,
    message: 'Opening session picker...',
    data: { triggerResumePicker: true },
    uiIntents: [createShowSessionPickerIntent()],
  };
}

const BUDGET_FILE = '.robota/budget.json';

interface IBudgetConfig {
  monthly: number;
}

function readBudget(cwd: string): IBudgetConfig | undefined {
  let raw: string;
  try {
    // No `existsSync` first: the catch already answers the question it asked, and asking twice is
    // the check-then-use shape CodeQL flags — here it was merely redundant, in `clearBudget` it was
    // exploitable.
    raw = readFileSync(join(cwd, BUDGET_FILE), 'utf-8');
  } catch {
    // allow-fallback: an absent or unreadable budget file disables the feature gracefully
    return undefined;
  }
  try {
    return JSON.parse(raw) as IBudgetConfig;
  } catch {
    // allow-fallback: malformed budget JSON treated as no budget set
    return undefined;
  }
}

/**
 * Write the budget document, refusing to follow a symlink at that path.
 *
 * Two separate problems were reachable here, and only one of them was the reported race:
 *
 * 1. `clearBudget` checked `existsSync` and then wrote — CodeQL `js/file-system-race`, high. Swapping
 *    the path for a symlink inside that window made the write land on the target instead. Removing
 *    the check closes the window, because there is no longer a moment between asking and acting.
 * 2. That alone is not enough. A symlink planted BEFORE the call is still followed, so removing the
 *    check fixes the race and leaves the redirection. Demonstrated both ways before and after.
 *
 * `O_NOFOLLOW` closes the second: the open itself fails with `ELOOP` when the final path component is
 * a symlink, so the decision is made by the kernel at open time rather than by a check that can go
 * stale. Windows has no such flag — `O_NOFOLLOW` is undefined there — so the write falls back to the
 * plain one rather than silently claiming a protection the platform cannot give.
 */
function writeBudgetFile(cwd: string, contents: string): void {
  mkdirSync(join(cwd, dirname(BUDGET_FILE)), { recursive: true });
  const file = join(cwd, BUDGET_FILE);
  const noFollow = constants.O_NOFOLLOW;
  if (noFollow === undefined) {
    writeFileSync(file, contents);
    return;
  }
  const handle = openSync(
    file,
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | noFollow,
  );
  try {
    writeFileSync(handle, contents);
  } finally {
    closeSync(handle);
  }
}

function writeBudget(cwd: string, config: IBudgetConfig): void {
  writeBudgetFile(cwd, JSON.stringify(config, null, 2));
}

/**
 * Clear the budget by writing an empty document.
 *
 * The `existsSync` that used to guard this write was a check-then-use race — CodeQL
 * `js/file-system-race`, high severity. Demonstrated rather than assumed: replacing the path with a
 * symlink between the check and the write makes the write follow it and overwrite the target, so the
 * guard let a caller reach a file outside the session directory entirely.
 *
 * The guard also bought nothing. `readBudget` reads an absent file, an empty document and malformed
 * JSON all as "no budget set", so writing unconditionally says exactly what the check was protecting.
 * The only visible change is that clearing on a project that never had the file now creates one
 * holding `{}` — the same meaning, written down.
 */
function clearBudget(cwd: string): void {
  writeBudgetFile(cwd, '{}');
}

/**
 * What to tell the operator when the budget write was refused.
 *
 * `ELOOP` is the guard firing, not a bug: the path is a symlink and the open declined to follow it.
 * Naming that specifically matters — "could not write the budget" would send someone looking at
 * permissions, when the thing to look at is what the budget file points to.
 */
function describeBudgetWriteFailure(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ELOOP') {
    return (
      `Refused: ${BUDGET_FILE} is a symbolic link, and the budget is never written through one. ` +
      'Replace it with a regular file, or remove it.'
    );
  }
  return `Could not write the budget: ${error instanceof Error ? error.message : String(error)}`;
}

function buildCostOutput(context: ICommandHostSessionAccess & ICommandHostWorkspace): {
  lines: string[];
  data: Record<string, unknown>;
} {
  const session = context.getSession();
  const sessionInfo = readCommandSessionInfo(context);
  const tokenUsage = session.getSessionTokenUsage();
  const modelId = session.getModelId();
  const lines: string[] = [
    `Session:  ${sessionInfo.sessionId}`,
    `Messages: ${sessionInfo.messageCount}`,
  ];
  const data: Record<string, unknown> = {
    sessionId: sessionInfo.sessionId,
    messageCount: sessionInfo.messageCount,
  };

  if (tokenUsage) {
    lines.push(
      `Tokens:   ${formatTokens(tokenUsage.inputTokens)} input  /  ${formatTokens(tokenUsage.outputTokens)} output`,
    );
    data.inputTokens = tokenUsage.inputTokens;
    data.outputTokens = tokenUsage.outputTokens;

    if (modelId) {
      const cost = calculateCost(modelId, tokenUsage.inputTokens, tokenUsage.outputTokens);
      if (cost !== undefined) {
        lines.push(`Cost:     ${formatUsd(cost)}  (${modelId})`);
        data.estimatedCostUsd = cost;

        const budget = readBudget(context.getCwd());
        if (budget?.monthly) {
          const remaining = budget.monthly - cost;
          const pct = Math.min(100, Math.round((cost / budget.monthly) * 100));
          lines.push(
            `Budget:   ${formatUsd(remaining)} remaining of ${formatUsd(budget.monthly)}/mo  (${pct}% used)`,
          );
          data.budgetMonthly = budget.monthly;
          data.budgetRemainingUsd = remaining;
        }
      }
    }
  } else {
    lines.push('Tokens:   not yet available (no turns completed)');
  }

  return { lines, data };
}

export function executeCostCommand(
  context: ICommandHostSessionAccess & ICommandHostWorkspace,
  args: string,
): ICommandResult {
  const trimmed = args.trim();

  if (trimmed.startsWith('budget')) {
    const budgetArg = trimmed.slice('budget'.length).trim();

    if (budgetArg === 'clear') {
      try {
        clearBudget(context.getCwd());
      } catch (error) {
        return { success: false, message: describeBudgetWriteFailure(error) };
      }
      return { success: true, message: 'Monthly budget cleared.' };
    }

    if (budgetArg === '') {
      const current = readBudget(context.getCwd());
      if (!current?.monthly) {
        return {
          success: true,
          message: 'No budget set. Use: /cost budget <amount>',
        };
      }
      return { success: true, message: `Monthly budget: ${formatUsd(current.monthly)}` };
    }

    const amount = parseFloat(budgetArg);
    if (!Number.isFinite(amount) || amount <= 0) {
      return {
        success: false,
        message: 'Usage: /cost budget <amount>  (e.g. /cost budget 5.00)',
      };
    }
    try {
      writeBudget(context.getCwd(), { monthly: amount });
    } catch (error) {
      return { success: false, message: describeBudgetWriteFailure(error) };
    }
    return { success: true, message: `Monthly budget set to ${formatUsd(amount)}.` };
  }

  const { lines, data } = buildCostOutput(context);
  return { success: true, message: lines.join('\n'), data };
}

export function executeValidateSessionCommand(
  context: ICommandHostSessionAccess & ICommandHostWorkspace,
  _args: string,
): ICommandResult {
  const report = validateCommandSessionReplayLog(context);
  return {
    success: report.validation.ok,
    message: formatCommandSessionReplayValidationReport(report),
    data: {
      logFile: report.logFile,
      entryCount: report.entryCount,
      issueCount: report.validation.issues.length,
      ok: report.validation.ok,
    },
  };
}
