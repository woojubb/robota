/**
 * GlobTool — fast file pattern search using fast-glob.
 *
 * Excludes node_modules and .git by default.
 * Results are sorted by modification time (most recently modified first).
 */

import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import fg from 'fast-glob';
import { z } from 'zod';
import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import type { IZodSchema } from '@robota-sdk/agent-tools';
import type { TToolResult } from '../types.js';

const GlobSchema = z.object({
  pattern: z.string().describe('Glob pattern to match (e.g. "**/*.ts")'),
  path: z
    .string()
    .optional()
    .describe('Base directory to search in (default: current working directory)'),
});

type TGlobArgs = z.infer<typeof GlobSchema>;

interface IFileWithMtime {
  path: string;
  mtime: number;
}

async function globFileTool(args: TGlobArgs): Promise<string> {
  const { pattern, path: basePath } = args;
  const cwd = basePath ? resolve(basePath) : process.cwd();

  let matches: string[];
  try {
    matches = await fg(pattern, {
      cwd,
      ignore: ['**/node_modules/**', '**/.git/**'],
      dot: true,
      absolute: false,
    });
  } catch (err) {
    const result: TToolResult = {
      success: false,
      output: '',
      error: err instanceof Error ? err.message : String(err),
    };
    return JSON.stringify(result);
  }

  // Sort by mtime (most recent first)
  const withMtime: IFileWithMtime[] = await Promise.all(
    matches.map(async (p) => {
      const absPath = resolve(cwd, p);
      try {
        const s = await stat(absPath);
        return { path: p, mtime: s.mtimeMs };
      } catch {
        return { path: p, mtime: 0 };
      }
    }),
  );

  withMtime.sort((a, b) => b.mtime - a.mtime);
  const sorted = withMtime.map((f) => f.path);

  const result: TToolResult = {
    success: true,
    output: sorted.length > 0 ? sorted.join('\n') : '(no matches)',
  };
  return JSON.stringify(result);
}

/**
 * GlobTool instance — register with Robota agent tools registry.
 */
export const globTool = createZodFunctionTool(
  'Glob',
  'Find files matching a glob pattern. Results sorted by modification time (most recent first).',
  GlobSchema as unknown as IZodSchema,
  async (params) => {
    return globFileTool(params as TGlobArgs);
  },
);
