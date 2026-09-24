/**
 * ReadTool — read a file and return its contents with line numbers (cat -n style).
 *
 * Supports offset/limit for partial reads. Detects binary files and refuses to
 * return their raw bytes. Default limit is 2000 lines.
 */

import { open, stat } from 'node:fs/promises';

import { z } from 'zod';
import { ToolExecutionError } from '@robota-sdk/agent-core';

import { checkPathWithinCwd, resolveHostPath } from './path-guard.js';
import { createZodFunctionTool } from '../implementations/function-tool';

import type { ISandboxBuiltinToolOptions } from './tool-options.js';
import type { ISandboxToolOptions } from '../sandbox/types.js';
import type { IToolInvocationResult } from '../types/tool-result.js';
import type { FunctionTool } from '@robota-sdk/agent-core';

// CORE-030: defining a tool and telling the permission system what it does arrive together.
import '../tool-permission-profiles.js';

const DEFAULT_READ_DESCRIPTION =
  'Reads a file from the local filesystem.\n\nBy default, reads up to 2000 lines from the beginning of the file. You can optionally specify offset and limit for partial reads.\n\nResults are returned using cat -n format, with line numbers starting at 1.\n\nThe filePath parameter must be an absolute path, not a relative path.';

const DEFAULT_LIMIT = 2000;
const MAX_READ_BYTES = 4 * 1024 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;

/** A budget refusal is a hard failure so a workflow cannot treat it as file content. */
export class ReadByteLimitError extends ToolExecutionError {
  public constructor(public readonly boundary: 'input' | 'output') {
    super(`Read ${boundary} exceeds its UTF-8 byte limit`, 'Read');
  }
}

/** Abort is a hard failure; the workflow must not accept a partial read. */
export class ReadCancelledError extends ToolExecutionError {
  public constructor() {
    super('Read cancelled', 'Read');
  }
}

const ReadSchema = z.object({
  filePath: z.string().describe('The absolute path to the file to read'),
  offset: z
    .number()
    .optional()
    .describe(
      'The line number to start reading from (1-based). Only provide if the file is too large to read at once',
    ),
  limit: z
    .number()
    .optional()
    .describe(
      `The number of lines to read (default: ${DEFAULT_LIMIT}). Only provide if the file is too large to read at once`,
    ),
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

function formatReadResult(
  filePath: string,
  content: string,
  startLine: number,
  limit: number,
): string {
  // Count and select without splitting the entire bounded file into potentially millions of
  // strings. Reject selected text before formatting can amplify many short lines.
  const selectedLines: string[] = [];
  let selectedMinimumBytes = 0;
  let totalLines = 0;
  let lineStart = 0;
  const selectedStart = Math.trunc(startLine - 1);
  const selectedEnd = Math.trunc(startLine - 1 + limit);
  while (lineStart < content.length) {
    const newline = content.indexOf('\n', lineStart);
    const lineEnd = newline === -1 ? content.length : newline;
    totalLines++;
    if (totalLines > selectedStart && totalLines <= selectedEnd) {
      const line = content.slice(lineStart, lineEnd);
      selectedMinimumBytes += Buffer.byteLength(line, 'utf8')
        + String(startLine + selectedLines.length).length + 1;
      if (selectedMinimumBytes > MAX_READ_BYTES) throw new ReadByteLimitError('output');
      selectedLines.push(line);
    }
    if (newline === -1) break;
    lineStart = newline + 1;
  }
  const returnedLines = selectedLines.length;
  const header =
    returnedLines < totalLines
      ? `[File: ${filePath} (lines ${startLine}-${startLine + returnedLines - 1} of ${totalLines})]\n`
      : `[File: ${filePath} (${totalLines} lines)]\n`;

  const width = String(startLine + returnedLines - 1).length;
  let outputBytes = Buffer.byteLength(header, 'utf8') + Math.max(0, returnedLines - 1);
  for (const line of selectedLines) outputBytes += width + 1 + Buffer.byteLength(line, 'utf8');
  if (outputBytes > MAX_READ_BYTES) throw new ReadByteLimitError('output');
  const output = formatWithLineNumbers(selectedLines, startLine);

  const result: IToolInvocationResult = {
    success: true,
    output: header + output,
  };
  return JSON.stringify(result);
}

async function readFileTool(args: TReadArgs, options: ISandboxToolOptions): Promise<string> {
  if (options.signal?.aborted) throw new ReadCancelledError();
  const { offset, limit = DEFAULT_LIMIT } = args;
  // A relative path anchors to the containment root before it is confined or opened (issue #2429).
  const filePath = options.sandboxClient
    ? args.filePath
    : resolveHostPath(args.filePath, options.cwd);
  const startLine = offset !== undefined && offset > 0 ? offset : 1;

  if (options.sandboxClient) {
    try {
      const content = await options.sandboxClient.readFile(filePath);
      if (options.signal?.aborted) throw new ReadCancelledError();
      // This API already returns a complete string; admission here still bounds formatting and
      // workflow output, while a streaming sandbox read API is needed to bound provider memory.
      if (Buffer.byteLength(content, 'utf8') > MAX_READ_BYTES) {
        throw new ReadByteLimitError('input');
      }
      return formatReadResult(filePath, content, startLine, limit);
    } catch (err) {
      if (err instanceof ReadByteLimitError || err instanceof ReadCancelledError) throw err;
      // allow-fallback: sandbox read failure → surface as IToolInvocationResult error
      const result: IToolInvocationResult = {
        success: false,
        output: '',
        error: err instanceof Error ? err.message : String(err),
      };
      return JSON.stringify(result);
    }
  }

  const pathError = checkPathWithinCwd(filePath, options.cwd);
  if (pathError !== undefined) return pathError;

  let fileStats: Awaited<ReturnType<typeof stat>> | undefined;
  try {
    fileStats = await stat(filePath);
  } catch (err) {
    // allow-fallback: stat failure means file not found → IToolInvocationResult error
    const result: IToolInvocationResult = {
      success: false,
      output: '',
      error: `File not found: ${filePath}`,
    };
    return JSON.stringify(result);
  }

  if (!fileStats.isFile()) {
    const result: IToolInvocationResult = {
      success: false,
      output: '',
      error: `Path is not a file: ${filePath}`,
    };
    return JSON.stringify(result);
  }

  let buffer = Buffer.alloc(0);
  let binaryFile = false;
  try {
    const handle = await open(filePath, 'r');
    try {
      const chunks: Buffer[] = [];
      const chunk = Buffer.allocUnsafe(READ_CHUNK_BYTES);
      let bytes = 0;
      let binaryCheckedBytes = 0;
      while (bytes <= MAX_READ_BYTES) {
        if (options.signal?.aborted) throw new ReadCancelledError();
        const { bytesRead } = await handle.read(
          chunk, 0, Math.min(chunk.length, MAX_READ_BYTES + 1 - bytes), null,
        );
        if (bytesRead === 0) break;
        const binaryCheckLength = Math.min(bytesRead, 8192 - binaryCheckedBytes);
        if (binaryCheckLength > 0 && isBinary(chunk.subarray(0, binaryCheckLength))) {
          binaryFile = true;
          break;
        }
        binaryCheckedBytes += binaryCheckLength;
        bytes += bytesRead;
        if (bytes > MAX_READ_BYTES) throw new ReadByteLimitError('input');
        chunks.push(Buffer.from(chunk.subarray(0, bytesRead)));
      }
      if (!binaryFile) buffer = Buffer.concat(chunks, bytes);
    } finally {
      await handle.close();
    }
  } catch (err) {
    if (err instanceof ReadByteLimitError || err instanceof ReadCancelledError) throw err;
    // allow-fallback: read failure → IToolInvocationResult error (permissions, locks)
    const result: IToolInvocationResult = {
      success: false,
      output: '',
      error: err instanceof Error ? err.message : String(err),
    };
    return JSON.stringify(result);
  }

  if (options.signal?.aborted) throw new ReadCancelledError();
  if (binaryFile) {
    const result: IToolInvocationResult = {
      success: false, output: '', error: `Binary file not supported: ${filePath}`,
    };
    return JSON.stringify(result);
  }

  const content = buffer.toString('utf8');
  return formatReadResult(filePath, content, startLine, limit);
}

/**
 * Create a ReadTool instance — register with Robota agent tools registry.
 */
export function createReadTool(options: ISandboxBuiltinToolOptions): FunctionTool {
  return createZodFunctionTool(
    'Read',
    options.description ?? DEFAULT_READ_DESCRIPTION,
    ReadSchema,
    async (params) => {
      return readFileTool(params, options);
    },
  );
}
