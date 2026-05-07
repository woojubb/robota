/**
 * WriteTool — write content to a file, auto-creating parent directories.
 */

import { z } from 'zod';
import { createZodFunctionTool } from '../implementations/function-tool';
import type { IZodSchema } from '../implementations/function-tool/types';
import type { ISandboxToolOptions } from '../sandbox/types.js';
import type { TToolResult } from '../types/tool-result.js';
import { atomicWriteUtf8File } from './atomic-file-write.js';

const WriteSchema = z.object({
  filePath: z.string().describe('The absolute path to the file to write'),
  content: z.string().describe('The content to write to the file'),
});

type TWriteArgs = z.infer<typeof WriteSchema>;

async function writeFileTool(args: TWriteArgs, options: ISandboxToolOptions = {}): Promise<string> {
  const { filePath, content } = args;

  try {
    if (options.sandboxClient) {
      await options.sandboxClient.writeFile(filePath, content);
    } else {
      await atomicWriteUtf8File(filePath, content);
    }

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
 * Create a WriteTool instance — register with Robota agent tools registry.
 */
export function createWriteTool(options: ISandboxToolOptions = {}) {
  return createZodFunctionTool(
    'Write',
    'Writes a file to the local filesystem. This will overwrite an existing file if one exists.\n\nALWAYS prefer the Edit tool for modifying existing files — it only sends the diff. Only use this tool to create new files or for complete rewrites.\n\nNEVER create documentation files (*.md) or README files unless explicitly requested by the user.',
    WriteSchema as unknown as IZodSchema,
    async (params) => {
      return writeFileTool(params as TWriteArgs, options);
    },
  );
}

/**
 * WriteTool instance — register with Robota agent tools registry.
 */
export const writeTool = createWriteTool();
