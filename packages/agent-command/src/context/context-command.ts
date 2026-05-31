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

import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type {
  ICommandHostContext,
  ICommandResult,
  TAutoCompactThreshold,
  TAutoCompactThresholdSource,
} from '@robota-sdk/agent-framework';
import type { IContextReferenceItem } from '@robota-sdk/agent-framework';

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

export async function executeContextCommand(
  context: ICommandHostContext,
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
  const analysis = analyzeHistory(history);
  const references = listCommandContextReferences(context);
  return {
    message: [
      `Context: ${state.usedTokens.toLocaleString()} / ${state.maxTokens.toLocaleString()} tokens (${Math.round(state.usedPercentage)}%)`,
      formatAutoCompactLine(autoCompactThreshold, autoCompactThresholdSource),
      formatContextReferenceSummary(references),
      `History: ${analysis.turnCount} turn${analysis.turnCount !== 1 ? 's' : ''}`,
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
  context: ICommandHostContext,
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
  context: ICommandHostContext,
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
  context: ICommandHostContext,
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
  context: ICommandHostContext,
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

function formatContextReferenceSummary(references: readonly IContextReferenceItem[]): string {
  const active = references.filter((reference) => reference.status === 'active').length;
  const observed = references.filter((reference) => reference.status === 'observed').length;
  return `References: ${active} active, ${observed} observed`;
}

// 1 token ≈ 4 chars — same approximation used across the codebase (limits-helpers.ts)
const CHARS_PER_TOKEN = 4;
const TOOL_ARG_MAX_LEN = 60;

function estimateTokens(charLength: number): number {
  return Math.ceil(charLength / CHARS_PER_TOKEN);
}

function formatContextReferenceLine(reference: IContextReferenceItem): string {
  return [
    reference.relativePath,
    `[${reference.loadType}, ${reference.status}]`,
    `~${estimateTokens(reference.byteLength).toLocaleString()} tokens`,
  ].join(' ');
}

// ── History analysis ────────────────────────────────────────────────────────

interface IToolResultSummary {
  toolName: string;
  displayArg: string;
  tokens: number;
}

interface IHistoryAnalysis {
  turnCount: number;
  userCount: number;
  userTokens: number;
  assistantCount: number;
  assistantTokens: number;
  toolResults: IToolResultSummary[];
  totalTokens: number;
}

function parseToolCallArgs(argsJson: string): Record<string, unknown> | null {
  try {
    return JSON.parse(argsJson) as Record<string, unknown>;
  } catch {
    // allow-fallback: tool call arguments JSON may be malformed; display-only degradation, not a terminal path
    return null;
  }
}

function extractFirstToolArg(argsJson: string): string {
  const parsed = parseToolCallArgs(argsJson);
  if (parsed === null) return '';
  const first = Object.values(parsed)[0];
  const raw = typeof first === 'string' ? first : JSON.stringify(first);
  return raw.length > TOOL_ARG_MAX_LEN ? `${raw.slice(0, TOOL_ARG_MAX_LEN)}…` : raw;
}

function analyzeHistory(history: IHistoryEntry[]): IHistoryAnalysis {
  type TToolCallEntry = { name: string; firstArg: string };
  const toolCallMap = new Map<string, TToolCallEntry>();

  for (const entry of history) {
    if (entry.category !== 'chat' || entry.type !== 'assistant') continue;
    const data = entry.data as {
      toolCalls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    };
    for (const tc of data.toolCalls ?? []) {
      toolCallMap.set(tc.id, {
        name: tc.function.name,
        firstArg: extractFirstToolArg(tc.function.arguments),
      });
    }
  }

  let userCount = 0;
  let userTokens = 0;
  let assistantCount = 0;
  let assistantTokens = 0;
  const toolResultMap = new Map<string, IToolResultSummary>();

  for (const entry of history) {
    if (entry.category !== 'chat') continue;
    if (entry.type === 'user') {
      const data = entry.data as { content?: string };
      userCount++;
      userTokens += estimateTokens((data.content ?? '').length);
    } else if (entry.type === 'assistant') {
      const data = entry.data as { content?: string | null; toolCalls?: unknown[] };
      assistantCount++;
      assistantTokens += estimateTokens(
        (data.content ?? '').length + (data.toolCalls ? JSON.stringify(data.toolCalls).length : 0),
      );
    } else if (entry.type === 'tool') {
      const data = entry.data as { content?: string; toolCallId?: string };
      const tc = toolCallMap.get(data.toolCallId ?? '');
      const toolName = tc?.name ?? 'tool';
      const displayArg = tc?.firstArg ?? '';
      const tokens = estimateTokens((data.content ?? '').length);
      toolResultMap.set(`${toolName}:${displayArg}`, { toolName, displayArg, tokens });
    }
  }

  const toolResults = [...toolResultMap.values()];
  const toolTokens = toolResults.reduce((s, t) => s + t.tokens, 0);
  return {
    turnCount: userCount,
    userCount,
    userTokens,
    assistantCount,
    assistantTokens,
    toolResults,
    totalTokens: userTokens + assistantTokens + toolTokens,
  };
}

// ── Full context breakdown (for /context list) ──────────────────────────────

function formatSection(title: string, tokens: number, lines: string[]): string {
  const tokenLabel = tokens > 0 ? ` — ~${tokens.toLocaleString()} tokens` : '';
  const header = `${title}${tokenLabel}:`;
  return lines.length === 0
    ? `${header}\n  (none)`
    : [header, ...lines.map((l) => `  ${l}`)].join('\n');
}

function formatFullContextBreakdown(context: ICommandHostContext): ICommandResult {
  const state = readCommandContextState(context);
  const autoCompactThreshold = readAutoCompactThreshold(context);
  const autoCompactThresholdSource = readAutoCompactThresholdSource(context);
  const history = context.getSession().getFullHistory();
  const analysis = analyzeHistory(history);
  const references = listCommandContextReferences(context);

  const systemRefs = references.filter((r) => r.loadType === 'system');
  const manualRefs = references.filter((r) => r.loadType === 'manual');
  const promptRefs = references.filter((r) => r.loadType === 'prompt-reference');

  const systemTokens = systemRefs.reduce((s, r) => s + estimateTokens(r.byteLength), 0);
  const manualTokens = manualRefs.reduce((s, r) => s + estimateTokens(r.byteLength), 0);
  const promptRefTokens = promptRefs.reduce((s, r) => s + estimateTokens(r.byteLength), 0);

  const convTurnLabel =
    analysis.turnCount === 0
      ? 'Conversation history — 0 turns'
      : `Conversation history — ${analysis.turnCount} turn${analysis.turnCount !== 1 ? 's' : ''} | ~${analysis.totalTokens.toLocaleString()} tokens`;

  const toolResultLines = analysis.toolResults.map(
    (t) =>
      `${t.toolName}${t.displayArg ? `: ${t.displayArg}` : ''} — ~${t.tokens.toLocaleString()} tokens`,
  );

  const conversationLines: string[] =
    analysis.turnCount === 0
      ? []
      : [
          `User (${analysis.userCount}): ~${analysis.userTokens.toLocaleString()} tokens`,
          `Assistant (${analysis.assistantCount}): ~${analysis.assistantTokens.toLocaleString()} tokens`,
          analysis.toolResults.length > 0
            ? [
                `Tool results (${analysis.toolResults.length}):`,
                ...toolResultLines.map((l) => `  ${l}`),
              ].join('\n')
            : `Tool results (0): (none)`,
        ];

  const convSection =
    analysis.turnCount === 0
      ? `${convTurnLabel}:\n  (none)`
      : [`${convTurnLabel}:`, ...conversationLines.map((l) => `  ${l}`)].join('\n');

  const message = [
    `Context: ${state.usedTokens.toLocaleString()} / ${state.maxTokens.toLocaleString()} tokens (${Math.round(state.usedPercentage)}%)`,
    formatAutoCompactLine(autoCompactThreshold, autoCompactThresholdSource),
    '',
    formatSection(
      'System prompt (active every turn)',
      systemTokens,
      systemRefs.map(formatContextReferenceLine),
    ),
    '',
    convSection,
    '',
    formatSection('Manually added', manualTokens, manualRefs.map(formatContextReferenceLine)),
    '',
    formatSection(
      'Prompt references (@-syntax)',
      promptRefTokens,
      promptRefs.map(formatContextReferenceLine),
    ),
  ].join('\n');

  return {
    success: true,
    message,
    data: {
      references,
      history: { turnCount: analysis.turnCount, toolResults: analysis.toolResults },
    },
  };
}
