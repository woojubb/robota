/**
 * Generate diff lines from Edit tool's old_string and new_string.
 * Simple line-based diff — removed lines in red, added lines in green.
 */

export interface IDiffLine {
  type: 'add' | 'remove';
  text: string;
}

/**
 * Generate diff lines from old and new strings.
 * Returns removed lines (from old) and added lines (from new).
 * If old and new are identical, returns empty array.
 */
export function generateDiffLines(oldStr: string, newStr: string): IDiffLine[] {
  if (oldStr === newStr) return [];

  const lines: IDiffLine[] = [];

  for (const line of oldStr.split('\n')) {
    lines.push({ type: 'remove', text: line });
  }
  for (const line of newStr.split('\n')) {
    lines.push({ type: 'add', text: line });
  }

  return lines;
}

/**
 * Extract Edit tool diff info from tool arguments.
 * Returns null if not an Edit tool or missing required fields.
 */
export function extractEditDiff(
  toolName: string,
  toolArgs?: Record<string, unknown>,
): { file: string; lines: IDiffLine[] } | null {
  if (toolName !== 'Edit' || !toolArgs) return null;

  const filePath = toolArgs.file_path ?? toolArgs.filePath;
  const oldStr = toolArgs.old_string ?? toolArgs.oldString;
  const newStr = toolArgs.new_string ?? toolArgs.newString;

  if (typeof filePath !== 'string') return null;
  if (typeof oldStr !== 'string' || typeof newStr !== 'string') return null;

  const lines = generateDiffLines(oldStr, newStr);
  if (lines.length === 0) return null;

  return { file: filePath, lines };
}
