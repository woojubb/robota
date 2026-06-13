import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  RENAME_COMMAND_USAGE,
  clearConversationHistory,
  createSessionPickerRequestedEffect,
  createSessionRenamedEffect,
  formatCommandSessionReplayValidationReport,
  parseSessionNameArgument,
  readCommandSessionInfo,
  validateCommandSessionReplayLog,
} from '@robota-sdk/agent-framework';

import { calculateCost, formatTokens, formatUsd } from './model-pricing.js';

import type { ICommandHostContext } from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-transport';

export const CLEAR_COMMAND_MESSAGE = 'Conversation cleared.';

export function executeClearCommand(context: ICommandHostContext, _args: string): ICommandResult {
  clearConversationHistory(context);
  return {
    success: true,
    message: CLEAR_COMMAND_MESSAGE,
    effects: [{ type: 'conversation-history-cleared' }],
  };
}

export function executeRenameCommand(_context: ICommandHostContext, args: string): ICommandResult {
  const name = parseSessionNameArgument(args);
  if (name === undefined) {
    return { success: false, message: RENAME_COMMAND_USAGE };
  }

  return {
    success: true,
    message: `Session renamed to "${name}".`,
    data: { name },
    effects: [createSessionRenamedEffect(name)],
  };
}

export function executeResumeCommand(_context: ICommandHostContext, _args: string): ICommandResult {
  return {
    success: true,
    message: 'Opening session picker...',
    data: { triggerResumePicker: true },
    effects: [createSessionPickerRequestedEffect()],
  };
}

const BUDGET_FILE = '.robota/budget.json';

interface IBudgetConfig {
  monthly: number;
}

function readBudget(cwd: string): IBudgetConfig | undefined {
  const file = join(cwd, BUDGET_FILE);
  if (!existsSync(file)) return undefined;
  let raw: string;
  try {
    raw = readFileSync(file, 'utf-8');
  } catch {
    // allow-fallback: budget file read failure disables feature gracefully
    return undefined;
  }
  try {
    return JSON.parse(raw) as IBudgetConfig;
  } catch {
    // allow-fallback: malformed budget JSON treated as no budget set
    return undefined;
  }
}

function writeBudget(cwd: string, config: IBudgetConfig): void {
  const dir = join(cwd, '.robota');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(cwd, BUDGET_FILE), JSON.stringify(config, null, 2));
}

function clearBudget(cwd: string): void {
  const file = join(cwd, BUDGET_FILE);
  if (existsSync(file)) {
    writeFileSync(file, '{}');
  }
}

function buildCostOutput(context: ICommandHostContext): {
  lines: string[];
  data: Record<string, unknown>;
} {
  const session = context.getSession();
  const sessionInfo = readCommandSessionInfo(context);
  const tokenUsage = session.getSessionTokenUsage?.();
  const modelId = session.getModelId?.();
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

export function executeCostCommand(context: ICommandHostContext, args: string): ICommandResult {
  const trimmed = args.trim();

  if (trimmed.startsWith('budget')) {
    const budgetArg = trimmed.slice('budget'.length).trim();

    if (budgetArg === 'clear') {
      clearBudget(context.getCwd());
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
    writeBudget(context.getCwd(), { monthly: amount });
    return { success: true, message: `Monthly budget set to ${formatUsd(amount)}.` };
  }

  const { lines, data } = buildCostOutput(context);
  return { success: true, message: lines.join('\n'), data };
}

export function executeValidateSessionCommand(
  context: ICommandHostContext,
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
