/**
 * Generate diff lines from Edit tool's old_string and new_string.
 * Includes absolute line numbers and optional context lines from the file.
 */

import { readFileSync } from 'node:fs';

export interface IDiffLine {
  type: 'add' | 'remove' | 'context';
  text: string;
  /** Absolute line number in the file */
  lineNumber: number;
}

/** Number of context lines to show before and after the change */
const CONTEXT_LINES = 2;

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
 * Generate diff lines with context from the modified file.
 * Reads the file (already modified) to get surrounding lines.
 */
export function generateDiffLinesWithContext(
  oldStr: string,
  newStr: string,
  startLine: number,
  filePath: string,
): IDiffLine[] {
  if (oldStr === newStr) return [];

  const diffLines = generateDiffLines(oldStr, newStr, startLine);

  // Read modified file for context lines
  let fileLines: string[];
  try {
    fileLines = readFileSync(filePath, 'utf-8').split('\n');
  } catch {
    return diffLines; // Can't read file — return without context
  }

  const result: IDiffLine[] = [];

  // Context BEFORE: lines before startLine in the file
  const contextStart = Math.max(0, startLine - 1 - CONTEXT_LINES);
  for (let i = contextStart; i < startLine - 1; i++) {
    if (i < fileLines.length) {
      result.push({ type: 'context', text: fileLines[i], lineNumber: i + 1 });
    }
  }

  // The diff lines (remove + add)
  result.push(...diffLines);

  // Context AFTER: lines after the new content in the modified file
  const newLineCount = newStr.split('\n').length;
  const afterStart = startLine - 1 + newLineCount;
  for (let i = afterStart; i < afterStart + CONTEXT_LINES; i++) {
    if (i < fileLines.length) {
      result.push({ type: 'context', text: fileLines[i], lineNumber: i + 1 });
    }
  }

  return result;
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

  const sl = startLine ?? 1;

  // Use context version when we have a valid file path and start line
  const lines = startLine
    ? generateDiffLinesWithContext(oldStr, newStr, sl, filePath)
    : generateDiffLines(oldStr, newStr, sl);

  if (lines.length === 0) return null;

  return { file: filePath, lines };
}
