/**
 * The `/context` transcript breakdown: token accounting over the history plus its rendering.
 *
 * Split out of `context-command.ts` when that file passed its size floor. The seam is a real one and
 * the role ports named it: this half only READS (`TContextReadHost`), while the command surface it
 * came from dispatches subcommands and writes thresholds and references.
 */

import { CONTEXT_ESTIMATE_CHARS_PER_TOKEN } from '@robota-sdk/agent-core';
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

import { formatAutoCompactLine } from './context-command.js';

import type { IHistoryEntry, TUniversalMessage } from '@robota-sdk/agent-core';
import type {
  ICommandHostContextReferences,
  ICommandHostContextWindow,
  ICommandHostSessionAccess,
} from '@robota-sdk/agent-framework';
import type { ICommandResult, IContextReferenceItem } from '@robota-sdk/agent-interface-transport';

/** What the breakdown reads — no adapter role, no writes. */
type TContextReadHost = ICommandHostContextReferences &
  ICommandHostContextWindow &
  ICommandHostSessionAccess;

const TOOL_ARG_MAX_LEN = 60;

function estimateTokens(charLength: number): number {
  return Math.ceil(charLength / CONTEXT_ESTIMATE_CHARS_PER_TOKEN);
}

export function formatContextReferenceLine(reference: IContextReferenceItem): string {
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
}

interface IMessageTokensByRole {
  systemTokens: number;
  userTokens: number;
  userCount: number;
  assistantTokens: number;
  assistantCount: number;
  toolTokens: number;
  toolCallCount: number;
  totalTokens: number;
}

interface IToolDisplayList {
  turnCount: number;
  toolResults: IToolResultSummary[];
  totalToolCallCount: number;
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

function computeMessageTokensByRole(rawMessages: TUniversalMessage[]): IMessageTokensByRole {
  let systemTokens = 0;
  let userTokens = 0;
  let userCount = 0;
  let assistantTokens = 0;
  let assistantCount = 0;
  let toolTokens = 0;
  let toolCallCount = 0;

  for (const msg of rawMessages) {
    const t = Math.ceil(JSON.stringify(msg).length / CONTEXT_ESTIMATE_CHARS_PER_TOKEN);
    if (msg.role === 'system') {
      systemTokens += t;
    } else if (msg.role === 'user') {
      userTokens += t;
      userCount++;
    } else if (msg.role === 'assistant') {
      assistantTokens += t;
      assistantCount++;
    } else if (msg.role === 'tool') {
      toolTokens += t;
      toolCallCount++;
    }
  }

  return {
    systemTokens,
    userTokens,
    userCount,
    assistantTokens,
    assistantCount,
    toolTokens,
    toolCallCount,
    totalTokens: systemTokens + userTokens + assistantTokens + toolTokens,
  };
}

export function buildToolDisplayList(history: IHistoryEntry[]): IToolDisplayList {
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

  let turnCount = 0;
  let totalToolCallCount = 0;
  const toolDisplayMap = new Map<string, IToolResultSummary>();

  for (const entry of history) {
    if (entry.category !== 'chat') continue;
    if (entry.type === 'user') {
      turnCount++;
    } else if (entry.type === 'tool') {
      const data = entry.data as { toolCallId?: string };
      const tc = toolCallMap.get(data.toolCallId ?? '');
      const toolName = tc?.name ?? 'tool';
      const displayArg = tc?.firstArg ?? '';
      totalToolCallCount++;
      toolDisplayMap.set(`${toolName}:${displayArg}`, { toolName, displayArg });
    }
  }

  return {
    turnCount,
    toolResults: [...toolDisplayMap.values()],
    totalToolCallCount,
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

export function formatFullContextBreakdown(context: TContextReadHost): ICommandResult {
  const state = readCommandContextState(context);
  const autoCompactThreshold = readAutoCompactThreshold(context);
  const autoCompactThresholdSource = readAutoCompactThresholdSource(context);
  const rawMessages = context.getSession().getHistory();
  const msgTokens = computeMessageTokensByRole(rawMessages);
  const display = buildToolDisplayList(context.getSession().getFullHistory());
  const references = listCommandContextReferences(context);

  const systemRefs = references.filter((r) => r.loadType === 'system');
  const manualRefs = references.filter((r) => r.loadType === 'manual');
  const promptRefs = references.filter((r) => r.loadType === 'prompt-reference');

  const systemRefTokens = systemRefs.reduce((s, r) => s + estimateTokens(r.byteLength), 0);
  const manualTokens = manualRefs.reduce((s, r) => s + estimateTokens(r.byteLength), 0);
  const promptRefTokens = promptRefs.reduce((s, r) => s + estimateTokens(r.byteLength), 0);

  const convTurnLabel =
    display.turnCount === 0
      ? 'Conversation history — 0 turns'
      : `Conversation history — ${display.turnCount} turn${display.turnCount !== 1 ? 's' : ''} | ~${msgTokens.totalTokens.toLocaleString()} tokens`;

  const toolResultLines = display.toolResults.map(
    (t) => `${t.toolName}${t.displayArg ? `: ${t.displayArg}` : ''}`,
  );

  const uniqueToolCount = display.toolResults.length;
  const totalToolCallCount = display.totalToolCallCount;
  const toolResultsLabel =
    totalToolCallCount === 0
      ? 'Tool results (0): (none)'
      : uniqueToolCount < totalToolCallCount
        ? `Tool results (${uniqueToolCount} unique / ${totalToolCallCount} calls, ~${msgTokens.toolTokens.toLocaleString()} tokens):`
        : `Tool results (${uniqueToolCount}, ~${msgTokens.toolTokens.toLocaleString()} tokens):`;

  const conversationLines: string[] =
    display.turnCount === 0
      ? []
      : [
          `User (${msgTokens.userCount}): ~${msgTokens.userTokens.toLocaleString()} tokens`,
          `Assistant (${msgTokens.assistantCount}): ~${msgTokens.assistantTokens.toLocaleString()} tokens`,
          ...(msgTokens.systemTokens > 0
            ? [`System messages: ~${msgTokens.systemTokens.toLocaleString()} tokens`]
            : []),
          totalToolCallCount > 0
            ? [toolResultsLabel, ...toolResultLines.map((l) => `  ${l}`)].join('\n')
            : toolResultsLabel,
        ];

  const convSection =
    display.turnCount === 0
      ? `${convTurnLabel}:\n  (none)`
      : [`${convTurnLabel}:`, ...conversationLines.map((l) => `  ${l}`)].join('\n');

  const message = [
    `Context: ${state.usedTokens.toLocaleString()} / ${state.maxTokens.toLocaleString()} tokens (${Math.round(state.usedPercentage)}%)`,
    formatAutoCompactLine(autoCompactThreshold, autoCompactThresholdSource),
    '',
    formatSection(
      'System prompt (active every turn)',
      systemRefTokens,
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
      history: { turnCount: display.turnCount, toolResults: display.toolResults },
    },
  };
}
