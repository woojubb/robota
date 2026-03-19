/**
 * ReadTool — read a file and return its contents with line numbers (cat -n style).
 *
 * Supports offset/limit for partial reads. Detects binary files and refuses to
 * return their raw bytes. Default limit is 2000 lines.
 */

import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';
import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import type { IZodSchema } from '@robota-sdk/agent-tools';
import type { TToolResult } from '../types.js';

const DEFAULT_LIMIT = 2000;

const ReadSchema = z.object({
  filePath: z.string().describe('Absolute or relative path to the file'),
  offset: z.number().optional().describe('1-based line number to start reading from (default: 1)'),
  limit: z
    .number()
    .optional()
    .describe(`Maximum number of lines to return (default: ${DEFAULT_LIMIT})`),
});

type TReadArgs = z.infer<typeof ReadSchema>;

/**
 * Heuristic binary detection: scan the first 8 KB for null bytes.
 */
function isBinary(buffer: Buffer): boolean {
  const checkLength = Math.min(buffer.length, 8192);
  for (let i = 0; i < checkLength; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

/**
 * Format lines with 1-based line numbers in cat -n style.
 * Pads line number to the width of the highest line number.
 */
function formatWithLineNumbers(lines: string[], startLine: number): string {
  const lastLineNum = startLine + lines.length - 1;
  const width = String(lastLineNum).length;
  return lines
    .map((line, idx) => {
      const lineNum = String(startLine + idx).padStart(width, ' ');
      return `${lineNum}\t${line}`;
    })
    .join('\n');
}

async function readFileTool(args: TReadArgs): Promise<string> {
  const { filePath, offset, limit = DEFAULT_LIMIT } = args;
  const startLine = offset !== undefined && offset > 0 ? offset : 1;

  let fileStats: Awaited<ReturnType<typeof stat>> | undefined;
  try {
    fileStats = await stat(filePath);
  } catch (err) {
    const result: TToolResult = {
      success: false,
      output: '',
      error: `File not found: ${filePath}`,
    };
    return JSON.stringify(result);
  }

  if (!fileStats.isFile()) {
    const result: TToolResult = {
      success: false,
      output: '',
      error: `Path is not a file: ${filePath}`,
    };
    return JSON.stringify(result);
  }

  let buffer: Buffer;
  try {
    buffer = await readFile(filePath);
  } catch (err) {
    const result: TToolResult = {
      success: false,
      output: '',
      error: err instanceof Error ? err.message : String(err),
    };
    return JSON.stringify(result);
  }

  if (isBinary(buffer)) {
    const result: TToolResult = {
      success: false,
      output: '',
      error: `Binary file not supported: ${filePath}`,
    };
    return JSON.stringify(result);
  }

  const content = buffer.toString('utf8');
  const allLines = content.split('\n');

  // Remove trailing empty line if file ends with newline (common in Unix files)
  if (allLines[allLines.length - 1] === '') {
    allLines.pop();
  }

  const zeroBasedStart = startLine - 1;
  const selectedLines = allLines.slice(zeroBasedStart, zeroBasedStart + limit);

  const output = formatWithLineNumbers(selectedLines, startLine);

  const totalLines = allLines.length;
  const returnedLines = selectedLines.length;
  const header =
    returnedLines < totalLines
      ? `[File: ${filePath} (lines ${startLine}-${startLine + returnedLines - 1} of ${totalLines})]\n`
      : `[File: ${filePath} (${totalLines} lines)]\n`;

  const result: TToolResult = {
    success: true,
    output: header + output,
  };
  return JSON.stringify(result);
}

/**
 * ReadTool instance — register with Robota agent tools registry.
 */
export const readTool = createZodFunctionTool(
  'Read',
  'Read a file and return its contents with line numbers. Supports offset/limit for partial reads.',
  ReadSchema as unknown as IZodSchema,
  async (params) => {
    return readFileTool(params as TReadArgs);
  },
);
