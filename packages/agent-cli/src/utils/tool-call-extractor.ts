/**
 * Extracts tool call summaries from session history messages.
 * Pure function — no side effects, no framework dependencies.
 */

const TOOL_ARG_MAX_LENGTH = 80;
const TOOL_ARG_TRUNCATE_LENGTH = 77;

interface IHistoryMessage {
  role: string;
  toolCalls?: Array<{
    function: { name: string; arguments: string };
  }>;
}

/**
 * Extract tool call display lines from history messages.
 * Format: `ToolName(firstArgValue)` — first argument value truncated to 80 chars.
 */
export function extractToolCalls(
  history: IHistoryMessage[],
  startIndex: number,
): string[] {
  const lines: string[] = [];
  for (let i = startIndex; i < history.length; i++) {
    const msg = history[i];
    if (msg.role === 'assistant' && msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        const value = parseFirstArgValue(tc.function.arguments);
        const truncated =
          value.length > TOOL_ARG_MAX_LENGTH
            ? value.slice(0, TOOL_ARG_TRUNCATE_LENGTH) + '...'
            : value;
        lines.push(`${tc.function.name}(${truncated})`);
      }
    }
  }
  return lines;
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
