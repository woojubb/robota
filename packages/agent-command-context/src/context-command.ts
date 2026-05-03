import type {
  ICommandHostContext,
  ICommandResult,
  TAutoCompactThreshold,
  TAutoCompactThresholdSource,
} from '@robota-sdk/agent-sdk';
import {
  DEFAULT_AUTO_COMPACT_THRESHOLD,
  readAutoCompactThreshold,
  readAutoCompactThresholdSource,
  readCommandContextState,
  resetAutoCompactThresholdSetting,
  setCommandAutoCompactThreshold,
  writeAutoCompactThresholdSetting,
} from '@robota-sdk/agent-sdk';

const PERCENT = 100;
const USAGE = [
  'Usage: /context auto on | off | <percent> | reset',
  'Examples: /context auto on, /context auto off, /context auto 85%, /context auto reset',
].join('\n');

function formatThreshold(threshold: TAutoCompactThreshold): string {
  if (threshold === false) {
    return 'disabled';
  }
  return `${Math.round(threshold * PERCENT)}%`;
}

function formatAutoCompactLine(
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

export function executeContextCommand(context: ICommandHostContext, args: string): ICommandResult {
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
  return {
    message: [
      `Context: ${state.usedTokens.toLocaleString()} / ${state.maxTokens.toLocaleString()} tokens (${Math.round(state.usedPercentage)}%)`,
      formatAutoCompactLine(autoCompactThreshold, autoCompactThresholdSource),
    ].join('\n'),
    success: true,
    data: {
      usedTokens: state.usedTokens,
      maxTokens: state.maxTokens,
      percentage: state.usedPercentage,
      autoCompactThreshold,
      autoCompactThresholdSource,
    },
  };
}

function executeContextSubcommand(
  context: ICommandHostContext,
  parts: readonly string[],
): ICommandResult {
  const [subcommand, action, extra] = parts;
  if (subcommand !== 'auto' || extra !== undefined) {
    return { success: false, message: USAGE };
  }
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

function applyAutoCompactThreshold(
  context: ICommandHostContext,
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
  | { success: true; threshold: number }
  | { success: false; message: string };

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
