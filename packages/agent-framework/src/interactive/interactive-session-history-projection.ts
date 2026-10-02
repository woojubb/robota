/** Projects stored chat messages and interactive tool events without running tools or reading files. */
import {
  buildDiffState,
  extractFirstArg,
  getStringArg,
  toWorkspaceRelativeDisplayPath,
} from './interactive-session-streaming.js';
import { GOAL_SIGNAL_TOOL_NAME } from '../goal/index.js';

import type {
  IAssistantMessage,
  IHistoryEntry,
  IToolCall,
  IToolMessage,
  TToolArgs,
  TUniversalMessage,
} from '@robota-sdk/agent-core';
import type { IHistoryDisplaySegment, IToolState } from '@robota-sdk/agent-interface-session';

export interface IHistoryProjectionOptions {
  /** The session's cwd — used ONLY for the pure, lexical display-path rewrite, never for a disk read. */
  cwd?: string;
  /** Projects a tool name to the `/command` it stands in for; mirrors live's `applyToolStart`. */
  modelCommandToolNames?: ReadonlyMap<string, string>;
}

/** Parse a tool call's JSON-string arguments back into the object shape `buildDiffState` expects. */
function parseToolCallArguments(raw: string): TToolArgs {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as TToolArgs)
      : {};
  } catch {
    // allow-fallback: a call whose arguments failed to decode never reached the tool either (see
    // `isArgumentDecodeErrorResult`) — an empty args object still produces a valid, if argument-less,
    // row instead of losing the whole segment.
    return {};
  }
}

/** `metadata.success` is the ONE signal `addToolResultsToHistory` persists (see its own file) — a
 * denied-vs-failed distinction is a LIVE, ephemeral concept (`session-prompt-registry.ts`'s pending
 * prompt) that is never written into the stored tool-result contract, so a replay cannot recover it
 * and collapses both into `'error'`. */
function resultStatusFrom(resultMessage: IToolMessage): 'success' | 'error' {
  return resultMessage.metadata?.['success'] === true ? 'success' : 'error';
}

/**
 * One finished call's `IToolState`, built the SAME way a live `tool_end` builds one — except the diff
 * (Edit/Write) is built from the call's ARGUMENTS ONLY. `buildDiffState` is called with no `cwd`,
 * which its own MUST-1 containment guard (`isSafeToReadForDiff` in `interactive-session-streaming.ts`)
 * already fails closed on whenever `cwd` is `undefined` — the same "no file context" mode the live
 * PRE-APPROVAL diff preview relies on for a path it must not read yet. Reused deliberately rather than
 * reimplemented: a file a historical Edit touched may since have changed, moved, or been deleted, so
 * reading it now would show today's content as if it were the diff's context — wrong, not just stale.
 *
 * `resultMessage === undefined` means the call's turn was interrupted before any result was recorded
 * (`IBaseMessage.state: 'interrupted'`) — a static replay has no way to make it finish, and a
 * perpetual "running" spinner would misrepresent a page that is not live. It renders as a failed call.
 */
function buildHistoricalToolState(
  toolCall: IToolCall,
  resultMessage: IToolMessage | undefined,
  options: IHistoryProjectionOptions,
): IToolState {
  const toolName = toolCall.function.name;
  const toolArgs = parseToolCallArguments(toolCall.function.arguments);
  const firstArg = extractFirstArg(toolArgs);
  const filePathArg = getStringArg(toolArgs, 'file_path', 'filePath');
  const displayPath =
    options.cwd && filePathArg
      ? toWorkspaceRelativeDisplayPath(options.cwd, filePathArg)
      : undefined;
  const commandName = options.modelCommandToolNames?.get(toolName);
  const internal = toolName === GOAL_SIGNAL_TOOL_NAME;

  const base: IToolState = {
    toolName,
    firstArg,
    isRunning: false,
    result: resultMessage ? resultStatusFrom(resultMessage) : 'error',
    executionId: toolCall.id,
    ...(displayPath ? { displayPath } : {}),
    ...(commandName ? { commandName } : {}),
    ...(internal ? { internal: true } : {}),
  };
  if (!resultMessage) return base;

  const { diffFile: rawDiffFile, diffLines } = buildDiffState({
    toolName,
    toolArgs,
    toolResultData: resultMessage.content,
  });
  const diffFile =
    options.cwd && rawDiffFile
      ? toWorkspaceRelativeDisplayPath(options.cwd, rawDiffFile)
      : rawDiffFile;

  return {
    ...base,
    toolResultData: resultMessage.content,
    ...(resultMessage.parts ? { toolResultParts: resultMessage.parts } : {}),
    ...(diffFile ? { diffFile } : {}),
    ...(diffLines ? { diffLines } : {}),
  };
}

/** Pair each occurrence; a provider may reuse a call ID after its earlier call finished. */
function indexToolResults(messages: readonly TUniversalMessage[]): Map<IToolCall, IToolMessage> {
  const results = new Map<IToolCall, IToolMessage>();
  const pending = new Map<string, IToolCall[]>();
  for (const message of messages) {
    if (message.role === 'assistant') {
      for (const call of message.toolCalls ?? []) {
        const queue = pending.get(call.id) ?? [];
        queue.push(call);
        pending.set(call.id, queue);
      }
    } else if (message.role === 'tool') {
      const call = pending.get(message.toolCallId)?.shift();
      if (call) results.set(call, message);
    }
  }
  return results;
}

/**
 * Projects an assistant message's own content and tool calls into display segments, in the order a
 * live stream would have produced them: its text (if it said anything), then each of its tool calls.
 */
function projectAssistantMessage(
  message: IAssistantMessage,
  resultsByCallId: ReadonlyMap<IToolCall, IToolMessage>,
  options: IHistoryProjectionOptions,
): IHistoryDisplaySegment[] {
  const segments: IHistoryDisplaySegment[] = [];
  if (message.content) {
    segments.push({ type: 'text', role: 'assistant', content: message.content });
  }
  for (const toolCall of message.toolCalls ?? []) {
    const tool = buildHistoricalToolState(toolCall, resultsByCallId.get(toolCall), options);
    segments.push({ type: 'tool', tool });
  }
  return segments;
}

function storedTool(value: unknown): IToolState | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = value as Partial<IToolState>;
  return typeof candidate.toolName === 'string' && typeof candidate.isRunning === 'boolean'
    ? (candidate as IToolState)
    : undefined;
}

/** Interactive turns store tools as events; imported chat transcripts carry call/result messages. */
export function projectHistoryForDisplay(
  history: readonly IHistoryEntry[],
  options: IHistoryProjectionOptions = {},
): IHistoryDisplaySegment[] {
  const segments: IHistoryDisplaySegment[] = [];
  let start = 0;
  for (let index = 0; index < history.length; index++) {
    const entry = history[index]!;
    if (entry.category === 'chat' && (entry.data as TUniversalMessage).role === 'user') {
      segments.push(...projectTurnHistory(history.slice(start, index), options));
      start = index;
    }
  }
  segments.push(...projectTurnHistory(history.slice(start), options));
  return segments;
}

function projectTurnHistory(
  history: readonly IHistoryEntry[],
  options: IHistoryProjectionOptions,
): IHistoryDisplaySegment[] {
  const messages = history
    .filter((entry) => entry.category === 'chat')
    .map((entry) => entry.data as TUniversalMessage);
  const resultsByCallId = indexToolResults(messages);
  const chatCalls = new Map<string, number>();
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    for (const call of message.toolCalls ?? [])
      chatCalls.set(call.id, (chatCalls.get(call.id) ?? 0) + 1);
  }
  const finishedByStart = new Map<IHistoryEntry, IToolState>();
  const matchedEnds = new Set<IHistoryEntry>();
  const pendingStarts = new Map<string, IHistoryEntry[]>();
  for (const entry of history) {
    if (entry.category !== 'event') continue;
    const tool = storedTool(entry.data);
    if (!tool?.executionId) continue;
    if (entry.type === 'tool-start') {
      const queue = pendingStarts.get(tool.executionId) ?? [];
      queue.push(entry);
      pendingStarts.set(tool.executionId, queue);
    } else if (entry.type === 'tool-end') {
      const start = pendingStarts.get(tool.executionId)?.shift();
      if (start) {
        finishedByStart.set(start, tool);
        matchedEnds.add(entry);
      }
    }
  }

  const segments: IHistoryDisplaySegment[] = [];
  const summaryOccurrences = new Map<string, number>();
  const consume = (counts: Map<string, number>, id: string | undefined): boolean => {
    const remaining = id ? (counts.get(id) ?? 0) : 0;
    if (!id || remaining === 0) return false;
    counts.set(id, remaining - 1);
    return true;
  };
  const emitStoredTool = (tool: IToolState): void => {
    if (consume(chatCalls, tool.executionId)) return;
    const snapshot = tool;
    segments.push({
      type: 'tool',
      tool: {
        ...snapshot,
        isRunning: false,
        ...(snapshot.isRunning ? { result: 'error' as const } : {}),
      },
    });
  };
  for (const entry of history) {
    if (entry.category === 'event') {
      if (entry.type === 'tool-start' || entry.type === 'tool-end') {
        const tool = storedTool(entry.data);
        // Old event records lack IDs; their summary carries the durable identity instead.
        if (tool?.executionId && !matchedEnds.has(entry)) {
          summaryOccurrences.set(
            tool.executionId,
            (summaryOccurrences.get(tool.executionId) ?? 0) + 1,
          );
          emitStoredTool(finishedByStart.get(entry) ?? tool);
        }
      } else if (entry.type === 'tool-summary') {
        const data = entry.data as { tools?: unknown[] } | undefined;
        for (const value of Array.isArray(data?.tools) ? data.tools : []) {
          const tool = storedTool(value);
          if (tool && !consume(summaryOccurrences, tool.executionId)) emitStoredTool(tool);
        }
      }
      continue;
    }
    if (entry.category !== 'chat') continue;
    const message = entry.data as TUniversalMessage;
    if (message.role === 'user') {
      segments.push({ type: 'text', role: 'user', content: message.content });
    } else if (message.role === 'assistant') {
      segments.push(...projectAssistantMessage(message, resultsByCallId, options));
    }
    // 'system' and 'tool' entries carry no segment of their own — a 'tool' entry was already
    // consumed above, paired to its call by id via `resultsByCallId`.
  }
  return segments;
}
