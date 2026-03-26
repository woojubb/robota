/**
 * Extracts tool call summaries from session history messages.
 * Pure function — no side effects, no framework dependencies.
 */

import { extractEditDiff } from './edit-diff.js';
import type { IDiffLine } from './edit-diff.js';

const TOOL_ARG_MAX_LENGTH = 80;
const TAIL_KEEP = 30;

interface IHistoryMessage {
  role: string;
  toolCalls?: Array<{
    function: { name: string; arguments: string };
  }>;
}

/** A tool call summary with optional diff for Edit tools */
export interface IToolCallSummary {
  line: string;
  diffLines?: IDiffLine[];
  diffFile?: string;
}

/**
 * Extract tool call display lines from history messages.
 * Format: `ToolName(firstArgValue)` — first argument value truncated to 80 chars.
 * Edit tools include diff information.
 */
export function extractToolCalls(history: IHistoryMessage[], startIndex: number): string[] {
  return extractToolCallsWithDiff(history, startIndex).map((s) => s.line);
}

/**
 * Extract tool call summaries with diff info from history messages.
 */
export function extractToolCallsWithDiff(
  history: IHistoryMessage[],
  startIndex: number,
): IToolCallSummary[] {
  const summaries: IToolCallSummary[] = [];
  for (let i = startIndex; i < history.length; i++) {
    const msg = history[i];
    if (msg.role === 'assistant' && msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        const value = parseFirstArgValue(tc.function.arguments);
        const truncated =
          value.length > TOOL_ARG_MAX_LENGTH
            ? value.slice(0, TOOL_ARG_MAX_LENGTH - TAIL_KEEP - 3) + '...' + value.slice(-TAIL_KEEP)
            : value;

        const summary: IToolCallSummary = {
          line: `${tc.function.name}(${truncated})`,
        };

        // Extract diff for Edit tool
        if (tc.function.name === 'Edit') {
          try {
            const args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
            const diff = extractEditDiff('Edit', args);
            if (diff) {
              summary.diffLines = diff.lines;
              summary.diffFile = diff.file;
            }
          } catch {
            // ignore parse errors
          }
        }

        summaries.push(summary);
      }
    }
  }
  return summaries;
}

/** Parse the first argument value from a JSON arguments string. */
function parseFirstArgValue(argsJson: string): string {
  try {
    const parsed = JSON.parse(argsJson) as Record<string, unknown>;
    const firstVal = Object.values(parsed)[0];
    return typeof firstVal === 'string' ? firstVal : JSON.stringify(firstVal);
  } catch {
    return argsJson;
  }
}
