/**
 * Generate diff lines from Edit tool's old_string and new_string.
 * Includes absolute line numbers from the source file.
 */

export interface IDiffLine {
  type: 'add' | 'remove';
  text: string;
  /** Absolute line number in the file */
  lineNumber: number;
}

/**
 * Generate diff lines from old and new strings with absolute line numbers.
 * @param oldStr - The text being replaced
 * @param newStr - The replacement text
 * @param startLine - The 1-based line number where oldStr starts in the file
 */
export function generateDiffLines(
  oldStr: string,
  newStr: string,
  startLine: number = 1,
): IDiffLine[] {
  if (oldStr === newStr) return [];

  const lines: IDiffLine[] = [];

  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');

  for (let i = 0; i < oldLines.length; i++) {
    lines.push({ type: 'remove', text: oldLines[i], lineNumber: startLine + i });
  }
  for (let i = 0; i < newLines.length; i++) {
    lines.push({ type: 'add', text: newLines[i], lineNumber: startLine + i });
  }

  return lines;
}

/**
 * Extract Edit tool diff info from tool arguments.
 * @param toolName - Tool name (must be 'Edit')
 * @param toolArgs - Tool arguments (filePath, oldString, newString)
 * @param startLine - Start line number from Edit tool result (optional)
 */
export function extractEditDiff(
  toolName: string,
  toolArgs?: Record<string, unknown>,
  startLine?: number,
): { file: string; lines: IDiffLine[] } | null {
  if (toolName !== 'Edit' || !toolArgs) return null;

  const filePath = toolArgs.file_path ?? toolArgs.filePath;
  const oldStr = toolArgs.old_string ?? toolArgs.oldString;
  const newStr = toolArgs.new_string ?? toolArgs.newString;

  if (typeof filePath !== 'string') return null;
  if (typeof oldStr !== 'string' || typeof newStr !== 'string') return null;

  const lines = generateDiffLines(oldStr, newStr, startLine ?? 1);
  if (lines.length === 0) return null;

  return { file: filePath, lines };
}
