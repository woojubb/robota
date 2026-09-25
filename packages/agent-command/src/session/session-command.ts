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
  ISessionUsageRecord,
} from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-command';

export const CLEAR_COMMAND_MESSAGE = 'Conversation cleared.';

export const CD_COMMAND_DESCRIPTION = 'Move this session to another working directory';
export const CD_COMMAND_USAGE = 'Usage: /cd <directory>';

/**
 * `/cd <directory>` (issue #3081) requests the host-executed move. The checks — no turn running, no
 * live background task, the target exists, no `Cd(...)` deny rule — run where the session state is,
 * when the host applies the action.
 */
export function executeCdCommand(_context: ICommandHostNoCapability, args: string): ICommandResult {
  const path = args.trim();
  if (path === '') return { success: false, message: CD_COMMAND_USAGE };
  return { success: true, message: '', hostActions: [{ type: 'workspace-move', path }] };
}

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

interface ICostTotals {
  inputTokens: number;
  outputTokens: number;
  /** Absent when nothing could be priced. */
  costUsd?: number;
  /** Some usage could not be priced, so the cost is a lower bound. */
  partial: boolean;
  /** The models the cost was priced on. */
  models: string[];
}

/**
 * Total the session's usage records. A record priced on its own model (the advisor's) keeps that
 * price; a main-thread record without one is priced on the session's model. A consulted model whose
 * price is unknown is left unpriced rather than priced as the main model.
 */
function totalSessionUsage(
  records: readonly ISessionUsageRecord[],
  modelId: string | undefined,
): ICostTotals | undefined {
  if (records.length === 0) return undefined;
  const totals: ICostTotals = { inputTokens: 0, outputTokens: 0, partial: false, models: [] };
  const models = new Set<string>();
  let cost = 0;
  let priced = false;
  for (const record of records) {
    totals.inputTokens += record.promptTokens;
    totals.outputTokens += record.completionTokens;
    const consulted = record.source?.scope === 'tool';
    const recordCost =
      record.costUsd ??
      (!consulted && modelId
        ? calculateCost(modelId, record.promptTokens, record.completionTokens)
        : undefined);
    if (recordCost === undefined) {
      totals.partial = true;
      continue;
    }
    cost += recordCost;
    priced = true;
    models.add(consulted ? (record.source?.label ?? 'another model') : (modelId ?? 'main model'));
  }
  if (priced) totals.costUsd = cost;
  totals.models = [...models];
  return totals;
}

function buildCostOutput(context: TCostCommandContext): {
  lines: string[];
  data: Record<string, unknown>;
} {
  const session = context.getSession();
  const sessionInfo = readCommandSessionInfo(context);
  const modelId = session.getModelId();
  const totals = totalSessionUsage(context.getSessionUsage(), modelId);
  const lines: string[] = [
    `Session:  ${sessionInfo.sessionId}`,
    `Messages: ${sessionInfo.messageCount}`,
  ];
  const data: Record<string, unknown> = {
    sessionId: sessionInfo.sessionId,
    messageCount: sessionInfo.messageCount,
  };

  if (totals) {
    lines.push(
      `Tokens:   ${formatTokens(totals.inputTokens)} input  /  ${formatTokens(totals.outputTokens)} output`,
    );
    data.inputTokens = totals.inputTokens;
    data.outputTokens = totals.outputTokens;

    const cost = totals.costUsd;
    if (cost !== undefined) {
      const priced =
        totals.models.length > 1 ? `mixed: ${totals.models.join(', ')}` : (totals.models[0] ?? '');
      const note = totals.partial ? '; some usage could not be priced' : '';
      lines.push(`Cost:     ${formatUsd(cost)}  (${priced}${note})`);
      data.estimatedCostUsd = cost;
      data.costModels = totals.models;
      if (totals.partial) data.costPartial = true;

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
  } else {
    lines.push('Tokens:   not yet available (no turns completed)');
  }

  return { lines, data };
}

export function executeCostCommand(context: TCostCommandContext, args: string): ICommandResult {
  const trimmed = args.trim();

  if (trimmed.startsWith('budget')) {
    const budgetArg = trimmed.slice('budget'.length).trim();
    // Argument shape is judged before the host is asked for persistence: a malformed amount is a
    // usage error on every host, not a symptom of the adapter that would have stored it.
    const amount = budgetArg === 'clear' || budgetArg === '' ? undefined : parseFloat(budgetArg);
    if (amount !== undefined && (!Number.isFinite(amount) || amount <= 0)) {
      return {
        success: false,
        message: 'Usage: /cost budget <amount>  (e.g. /cost budget 5.00)',
      };
    }
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

    if (amount === undefined) return { success: false, message: BUDGET_UNAVAILABLE_MESSAGE };
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
