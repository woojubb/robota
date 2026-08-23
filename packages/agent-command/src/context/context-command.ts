import {
  addCommandContextReference,
  clearCommandContextReferences,
  DEFAULT_AUTO_COMPACT_THRESHOLD,
  listCommandContextReferences,
  readAutoCompactThreshold,
  readAutoCompactThresholdSource,
  readCommandContextState,
  removeCommandContextReference,
  resetAutoCompactThresholdSetting,
  setCommandAutoCompactThreshold,
  writeAutoCompactThresholdSetting,
} from '@robota-sdk/agent-framework';

import {
  buildToolDisplayList,
  formatContextReferenceLine,
  formatFullContextBreakdown,
} from './context-breakdown.js';

import type { IHistoryEntry, TUniversalMessage } from '@robota-sdk/agent-core';
import type {
  ICommandHostAdapterAccess,
  ICommandHostContextReferences,
  ICommandHostContextWindow,
  ICommandHostSessionAccess,
  TAutoCompactThreshold,
  TAutoCompactThresholdSource,
} from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-command';
import type { IContextReferenceItem } from '@robota-sdk/agent-interface-transport';

const PERCENT = 100;
const USAGE = [
  'Usage: /context [list] | add <path> | remove <path> | clear | auto on | off | <percent> | reset',
  'Examples: /context list, /context add AGENTS.md, /context remove AGENTS.md, /context auto 85%',
].join('\n');

function formatThreshold(threshold: TAutoCompactThreshold): string {
  if (threshold === false) {
    return 'disabled';
  }
  return `${Math.round(threshold * PERCENT)}%`;
}

export function formatAutoCompactLine(
  threshold: TAutoCompactThreshold,
  source: TAutoCompactThresholdSource,
): string {
  if (threshold === false) {
    return `Auto compact: disabled (${source})`;
  }
  return `Auto compact: ${formatThreshold(threshold)} (${source})`;
}

function formatPersistenceSuffix(persisted: boolean): string {
  return persisted ? 'settings' : 'current session only';
}

/** The roles the `/context` surface reads. Named once so five signatures do not restate it. */
type TContextCommandHost = ICommandHostAdapterAccess &
  ICommandHostContextReferences &
  ICommandHostContextWindow &
  ICommandHostSessionAccess;

/** The subset the threshold operations need — no context-reference role. */
type TContextThresholdHost = ICommandHostAdapterAccess &
  ICommandHostContextWindow &
  ICommandHostSessionAccess;

export async function executeContextCommand(
  context: TContextCommandHost,
  args: string,
): Promise<ICommandResult> {
  const parts = args
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0);

  if (parts.length > 0) {
    return executeContextSubcommand(context, parts);
  }

  const state = readCommandContextState(context);
  const autoCompactThreshold = readAutoCompactThreshold(context);
  const autoCompactThresholdSource = readAutoCompactThresholdSource(context);
  const history = context.getSession().getFullHistory();
  const display = buildToolDisplayList(history);
  const references = listCommandContextReferences(context);
  return {
    message: [
      `Context: ${state.usedTokens.toLocaleString()} / ${state.maxTokens.toLocaleString()} tokens (${Math.round(state.usedPercentage)}%)`,
      formatAutoCompactLine(autoCompactThreshold, autoCompactThresholdSource),
      formatContextReferenceSummary(references),
      `History: ${display.turnCount} turn${display.turnCount !== 1 ? 's' : ''}`,
    ].join('\n'),
    success: true,
    data: {
      usedTokens: state.usedTokens,
      maxTokens: state.maxTokens,
      percentage: state.usedPercentage,
      autoCompactThreshold,
      autoCompactThresholdSource,
      references,
    },
  };
}

async function executeContextSubcommand(
  context: TContextCommandHost,
  parts: readonly string[],
): Promise<ICommandResult> {
  const [subcommand, ...rest] = parts;
  if (subcommand === 'list') {
    if (rest.length > 0) return { success: false, message: USAGE };
    return formatFullContextBreakdown(context);
  }
  if (subcommand === 'add') {
    return executeAddContextReference(context, rest);
  }
  if (subcommand === 'remove') {
    return executeRemoveContextReference(context, rest);
  }
  if (subcommand === 'clear') {
    if (rest.length > 0) return { success: false, message: USAGE };
    const result = clearCommandContextReferences(context);
    return {
      success: true,
      message: `Context references cleared: ${result.removed.length} removed.`,
      data: { removed: result.removed },
    };
  }
  if (subcommand !== 'auto') {
    return { success: false, message: USAGE };
  }
  return executeAutoContextSubcommand(context, rest);
}

function executeAutoContextSubcommand(
  context: TContextThresholdHost,
  parts: readonly string[],
): ICommandResult {
  const [action, extra] = parts;
  if (extra !== undefined) return { success: false, message: USAGE };
  if (action === undefined) {
    const threshold = readAutoCompactThreshold(context);
    const source = readAutoCompactThresholdSource(context);
    return {
      success: true,
      message: [formatAutoCompactLine(threshold, source), USAGE].join('\n'),
      data: { autoCompactThreshold: threshold, autoCompactThresholdSource: source },
    };
  }

  if (action === 'on') {
    return applyAutoCompactThreshold(context, DEFAULT_AUTO_COMPACT_THRESHOLD, 'enabled');
  }
  if (action === 'off') {
    return applyAutoCompactThreshold(context, false, 'disabled');
  }
  if (action === 'reset') {
    const persisted = resetAutoCompactThresholdSetting(context);
    setCommandAutoCompactThreshold(context, DEFAULT_AUTO_COMPACT_THRESHOLD, 'default');
    return {
      success: true,
      message: `Auto compact reset to default: ${formatThreshold(DEFAULT_AUTO_COMPACT_THRESHOLD)} (${formatPersistenceSuffix(persisted)}).`,
      data: {
        autoCompactThreshold: DEFAULT_AUTO_COMPACT_THRESHOLD,
        autoCompactThresholdSource: 'default',
        persisted,
      },
    };
  }

  const parsed = parseThreshold(action);
  if (!parsed.success) {
    return { success: false, message: `${parsed.message}\n${USAGE}` };
  }
  return applyAutoCompactThreshold(context, parsed.threshold, 'threshold set');
}

async function executeAddContextReference(
  context: ICommandHostContextReferences,
  args: readonly string[],
): Promise<ICommandResult> {
  const path = args.join(' ').trim();
  if (!path) return { success: false, message: USAGE };

  const result = await addCommandContextReference(context, path);
  if (!result.reference) {
    return {
      success: false,
      message: result.diagnostics.join('\n') || `Context reference not found: ${path}`,
      data: { diagnostics: result.diagnostics },
    };
  }

  return {
    success: true,
    message: [
      `Context reference added: ${formatContextReferenceLine(result.reference)}.`,
      ...(result.evicted.length > 0
        ? [`Evicted ${result.evicted.length} older context reference(s).`]
        : []),
    ].join('\n'),
    data: { reference: result.reference, evicted: result.evicted },
  };
}

function executeRemoveContextReference(
  context: ICommandHostContextReferences,
  args: readonly string[],
): ICommandResult {
  const path = args.join(' ').trim();
  if (!path) return { success: false, message: USAGE };

  const result = removeCommandContextReference(context, path);
  if (!result.removed) {
    return {
      success: false,
      message: `Context reference not found: ${path}`,
    };
  }

  return {
    success: true,
    message: `Context reference removed: ${formatContextReferenceLine(result.removed)}.`,
    data: { removed: result.removed },
  };
}

function applyAutoCompactThreshold(
  context: TContextThresholdHost,
  threshold: TAutoCompactThreshold,
  action: 'enabled' | 'disabled' | 'threshold set',
): ICommandResult {
  const persisted = writeAutoCompactThresholdSetting(context, threshold);
  const source: TAutoCompactThresholdSource = persisted ? 'settings' : 'session';
  setCommandAutoCompactThreshold(context, threshold, source);

  return {
    success: true,
    message: formatApplyMessage(action, threshold, persisted),
    data: {
      autoCompactThreshold: threshold,
      autoCompactThresholdSource: source,
      persisted,
    },
  };
}

function formatApplyMessage(
  action: 'enabled' | 'disabled' | 'threshold set',
  threshold: TAutoCompactThreshold,
  persisted: boolean,
): string {
  const suffix = formatPersistenceSuffix(persisted);
  if (action === 'disabled') {
    return `Auto compact disabled (${suffix}).`;
  }
  if (action === 'enabled') {
    return `Auto compact enabled at ${formatThreshold(threshold)} (${suffix}).`;
  }
  return `Auto compact threshold set to ${formatThreshold(threshold)} (${suffix}).`;
}

type TParseThresholdResult =
  { success: true; threshold: number } | { success: false; message: string };

function parseThreshold(raw: string): TParseThresholdResult {
  if (raw.endsWith('%')) {
    const percent = Number(raw.slice(0, -1));
    if (!Number.isFinite(percent) || percent <= 0 || percent > PERCENT) {
      return {
        success: false,
        message: 'Auto compact percentage must be greater than 0% and at most 100%.',
      };
    }
    return { success: true, threshold: percent / PERCENT };
  }

  if (raw.includes('.')) {
    const fraction = Number(raw);
    if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) {
      return {
        success: false,
        message: 'Auto compact fraction must be greater than 0 and at most 1.',
      };
    }
    return { success: true, threshold: fraction };
  }

  return {
    success: false,
    message: 'Use a percentage such as 85% or a fraction such as 0.85.',
  };
}

function formatContextReferenceSummary(references: readonly IContextReferenceItem[]): string {
  const active = references.filter((reference) => reference.status === 'active').length;
  const observed = references.filter((reference) => reference.status === 'observed').length;
  return `References: ${active} active, ${observed} observed`;
}

// 1 token ≈ 4 chars — sourced from the agent-core estimation SSOT.
