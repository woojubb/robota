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
  ICommandCostBudgetAdapter,
  ICommandHostAdapterAccess,
  ICommandHostNoCapability,
  ICommandHostSessionAccess,
  ICommandHostUserInteraction,
  ICommandHostWorkspace,
} from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-command';

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

type TCostCommandContext = ICommandHostSessionAccess &
  ICommandHostWorkspace &
  ICommandHostAdapterAccess;

/**
 * CMD-007 (issue #2058): the budget lives behind `ICommandCostBudgetAdapter`, composed by the shell.
 * This package owns no path literal and no filesystem call for it any more — atomic/symlink-safe
 * writing is the adapter's policy (agent-cli's file adapter keeps the O_NOFOLLOW guard).
 */
function costBudgetAdapter(context: TCostCommandContext): ICommandCostBudgetAdapter | undefined {
  return context.getCommandHostAdapters?.().costBudget;
}

const BUDGET_UNAVAILABLE_MESSAGE =
  'Budget persistence is not available on this host (no cost-budget adapter was composed).';

/** What to tell the operator when the adapter refused the write; the adapter names the cause. */
function describeBudgetWriteFailure(error: unknown): string {
  return `Could not write the budget: ${error instanceof Error ? error.message : String(error)}`;
}

function buildCostOutput(context: TCostCommandContext): {
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

        const budget = costBudgetAdapter(context)?.read();
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

export function executeCostCommand(context: TCostCommandContext, args: string): ICommandResult {
  const trimmed = args.trim();

  if (trimmed.startsWith('budget')) {
    const budgetArg = trimmed.slice('budget'.length).trim();
    const adapter = costBudgetAdapter(context);
    if (adapter === undefined) return { success: false, message: BUDGET_UNAVAILABLE_MESSAGE };

    if (budgetArg === 'clear') {
      try {
        adapter.clear();
      } catch (error) {
        return { success: false, message: describeBudgetWriteFailure(error) };
      }
      return { success: true, message: 'Monthly budget cleared.' };
    }

    if (budgetArg === '') {
      const current = adapter.read();
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
      adapter.write({ monthly: amount });
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
