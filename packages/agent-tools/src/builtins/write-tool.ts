/**
 * WriteTool — write content to a file, auto-creating parent directories.
 */

import { z } from 'zod';

import { atomicWriteUtf8File } from './atomic-file-write.js';
import { checkPathWithinCwd } from './path-guard.js';
import { createZodFunctionTool } from '../implementations/function-tool';

import type { ISandboxBuiltinToolOptions } from './tool-options.js';
import type { ISandboxToolOptions } from '../sandbox/types.js';
import type { IToolInvocationResult } from '../types/tool-result.js';
import type { FunctionTool } from '@robota-sdk/agent-core';

const DEFAULT_WRITE_DESCRIPTION =
  'Writes a file to the local filesystem. This will overwrite an existing file if one exists.\n\nPrefer the Edit tool for modifying existing files — it only sends the changed text. Use this tool to create new files or for complete rewrites.\n\nParent directories are created automatically when missing.';

const WriteSchema = z.object({
  filePath: z.string().describe('The absolute path to the file to write'),
  content: z.string().describe('The content to write to the file'),
});

type TWriteArgs = z.infer<typeof WriteSchema>;

async function writeFileTool(args: TWriteArgs, options: ISandboxToolOptions = {}): Promise<string> {
  const { filePath, content } = args;

  if (!options.sandboxClient) {
    const pathError = checkPathWithinCwd(filePath, options.cwd);
    if (pathError !== undefined) return pathError;
  }

  try {
    if (options.sandboxClient) {
      await options.sandboxClient.writeFile(filePath, content);
    } else {
      await atomicWriteUtf8File(filePath, content);
    }

    const result: IToolInvocationResult = {
      success: true,
      output: `Written ${Buffer.byteLength(content, 'utf8')} bytes to ${filePath}`,
    };
    return JSON.stringify(result);
  } catch (err) {
    // allow-fallback: write failure → IToolInvocationResult error (disk full, permissions)
    const result: IToolInvocationResult = {
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
export function createWriteTool(options: ISandboxBuiltinToolOptions = {}): FunctionTool {
  return createZodFunctionTool(
    'Write',
    options.description ?? DEFAULT_WRITE_DESCRIPTION,
    WriteSchema,
    async (params) => {
      return writeFileTool(params, options);
    },
  );
}

/**
 * WriteTool instance — register with Robota agent tools registry.
 */
export const writeTool = createWriteTool();
