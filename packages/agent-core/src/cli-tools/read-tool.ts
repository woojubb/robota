/**
 * ReadTool — read a file and return its contents with line numbers (cat -n style).
 *
 * Supports offset/limit for partial reads. Detects binary files and refuses to
 * return their raw bytes. Default limit is 2000 lines.
 */

import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';
import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import type { TToolParameters } from '../interfaces/tool.js';
import { asZodSchema } from './schema-cast.js';
import type { TToolResult } from '../cli-permissions/types.js';

const DEFAULT_LIMIT = 2000;
/** Number of bytes to scan for null bytes in binary detection heuristic */
const BINARY_CHECK_BYTES = 8192;

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
  const checkLength = Math.min(buffer.length, BINARY_CHECK_BYTES);
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

/** Helper: return an error TToolResult JSON string */
function errorResult(error: string): string {
  const result: TToolResult = { success: false, output: '', error };
  return JSON.stringify(result);
}

/** Validate file path: check existence and that it is a regular file */
async function validateFilePath(filePath: string): Promise<string | null> {
  try {
    const fileStats = await stat(filePath);
    if (!fileStats.isFile()) {
      return errorResult(`Path is not a file: ${filePath}`);
    }
    return null;
  } catch {
    return errorResult(`File not found: ${filePath}`);
  }
}

/** Read and validate file buffer (reject binary files) */
async function readAndValidateBuffer(
  filePath: string,
): Promise<{ error: string } | { buffer: Buffer }> {
  try {
    const buffer = await readFile(filePath);
    if (isBinary(buffer)) {
      return { error: errorResult(`Binary file not supported: ${filePath}`) };
    }
    return { buffer };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: errorResult(msg) };
  }
}

/** Format the selected lines with a header describing the range */
function buildReadOutput(
  filePath: string,
  allLines: string[],
  startLine: number,
  limit: number,
): string {
  const zeroBasedStart = startLine - 1;
  const selectedLines = allLines.slice(zeroBasedStart, zeroBasedStart + limit);
  const output = formatWithLineNumbers(selectedLines, startLine);

  const totalLines = allLines.length;
  const returnedLines = selectedLines.length;
  const header =
    returnedLines < totalLines
      ? `[File: ${filePath} (lines ${startLine}-${startLine + returnedLines - 1} of ${totalLines})]\n`
      : `[File: ${filePath} (${totalLines} lines)]\n`;

  const result: TToolResult = { success: true, output: header + output };
  return JSON.stringify(result);
}

async function readFileTool(args: TReadArgs): Promise<string> {
  const { filePath, offset, limit = DEFAULT_LIMIT } = args;
  const startLine = offset !== undefined && offset > 0 ? offset : 1;

  const pathError = await validateFilePath(filePath);
  if (pathError) return pathError;

  const bufferResult = await readAndValidateBuffer(filePath);
  if ('error' in bufferResult) return bufferResult.error;

  const content = bufferResult.buffer.toString('utf8');
  const allLines = content.split('\n');
  if (allLines[allLines.length - 1] === '') {
    allLines.pop();
  }

  return buildReadOutput(filePath, allLines, startLine, limit);
}

/**
 * ReadTool instance — register with Robota agent tools registry.
 */
export const readTool = createZodFunctionTool(
  'Read',
  'Read a file and return its contents with line numbers. Supports offset/limit for partial reads.',
  asZodSchema(ReadSchema),
  async (params: TToolParameters) => {
    return readFileTool(params as TReadArgs);
  },
);
