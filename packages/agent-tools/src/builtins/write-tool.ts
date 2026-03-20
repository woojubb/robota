/**
 * WriteTool — write content to a file, auto-creating parent directories.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { createZodFunctionTool } from '../implementations/function-tool';
import type { IZodSchema } from '../implementations/function-tool/types';
import type { TToolResult } from '../types/tool-result.js';

const WriteSchema = z.object({
  filePath: z.string().describe('The absolute path to the file to write'),
  content: z.string().describe('The content to write to the file'),
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
      output: `Written ${Buffer.byteLength(content, 'utf8')} bytes to ${filePath}`,
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
  'Writes a file to the local filesystem. This will overwrite an existing file if one exists.\n\nALWAYS prefer the Edit tool for modifying existing files — it only sends the diff. Only use this tool to create new files or for complete rewrites.\n\nNEVER create documentation files (*.md) or README files unless explicitly requested by the user.',
  WriteSchema as unknown as IZodSchema,
  async (params) => {
    return writeFileTool(params as TWriteArgs);
  },
);
