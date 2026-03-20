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
import { createZodFunctionTool } from '../implementations/function-tool';
import type { IZodSchema } from '../implementations/function-tool/types';
import type { TToolResult } from '../types/tool-result.js';

const DEFAULT_MAX_RESULTS = 1000;

const GlobSchema = z.object({
  pattern: z
    .string()
    .describe('The glob pattern to match files against (e.g. "**/*.ts", "src/**/*.tsx")'),
  path: z
    .string()
    .optional()
    .describe(
      'The directory to search in. Defaults to the current working directory. Must be a valid directory path if provided',
    ),
  limit: z
    .number()
    .optional()
    .describe(
      'Maximum number of results to return (default: 1000). Use a smaller limit to save context space',
    ),
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

  const maxResults = args.limit ?? DEFAULT_MAX_RESULTS;
  const totalMatches = withMtime.length;
  const truncated = totalMatches > maxResults;
  const limited = truncated ? withMtime.slice(0, maxResults) : withMtime;
  const sorted = limited.map((f) => f.path);

  let output = sorted.length > 0 ? sorted.join('\n') : '(no matches)';
  if (truncated) {
    output += `\n\n[Showing ${maxResults} of ${totalMatches} matches. Use limit parameter to see more.]`;
  }

  const result: TToolResult = {
    success: true,
    output,
  };
  return JSON.stringify(result);
}

/**
 * GlobTool instance — register with Robota agent tools registry.
 */
export const globTool = createZodFunctionTool(
  'Glob',
  "Fast file pattern matching tool that works with any codebase size.\n\nSupports glob patterns like '**/*.js' or 'src/**/*.ts'. Returns matching file paths sorted by modification time.\n\nUse this tool when you need to find files by name patterns. When doing an open-ended search that may require multiple rounds, use the Agent tool instead.\n\nDefault limit is 1000 results. Use the limit parameter if you need fewer results to save context space.",
  GlobSchema as unknown as IZodSchema,
  async (params) => {
    return globFileTool(params as TGlobArgs);
  },
);
