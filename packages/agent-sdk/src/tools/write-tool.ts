/**
 * WriteTool — write content to a file, auto-creating parent directories.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import type { IZodSchema } from '@robota-sdk/agent-tools';
import type { TToolResult } from '../types.js';

const WriteSchema = z.object({
  filePath: z.string().describe('Absolute or relative path to the file to write'),
  content: z.string().describe('Content to write into the file'),
});

type TWriteArgs = z.infer<typeof WriteSchema>;

async function writeFileTool(args: TWriteArgs): Promise<string> {
  const { filePath, content } = args;

  try {
    // Auto-create parent directories
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, 'utf8');

    const result: TToolResult = {
      success: true,
      output: `Written ${content.length} bytes to ${filePath}`,
    };
    return JSON.stringify(result);
  } catch (err) {
    const result: TToolResult = {
      success: false,
      output: '',
      error: err instanceof Error ? err.message : String(err),
    };
    return JSON.stringify(result);
  }
}

/**
 * WriteTool instance — register with Robota agent tools registry.
 */
export const writeTool = createZodFunctionTool(
  'Write',
  'Write content to a file, automatically creating parent directories if needed.',
  WriteSchema as unknown as IZodSchema,
  async (params) => {
    return writeFileTool(params as TWriteArgs);
  },
);
