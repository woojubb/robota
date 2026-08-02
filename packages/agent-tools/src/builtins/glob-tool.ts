/**
 * GlobTool — fast file pattern search using fast-glob.
 *
 * Excludes node_modules and .git by default.
 * Results are sorted by modification time (most recently modified first).
 *
 * SEC-007: when a containment root is configured the enumeration is confined to it. Listing the
 * filesystem is a disclosure in its own right — a sandbox that stops the model reading a file but
 * lets it map everything around that file is not a sandbox.
 */

import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import fg from 'fast-glob';
import pLimit from 'p-limit';
import { z } from 'zod';

import { isWithinCwd, resolveSearchRoot } from './path-guard.js';
import { createZodFunctionTool } from '../implementations/function-tool';

import type { IContainedBuiltinToolOptions } from './tool-options.js';
import type { IToolInvocationResult } from '../types/tool-result.js';
import type { FunctionTool } from '@robota-sdk/agent-core';

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

/** Cap on concurrent `stat` calls during the mtime sort, so a large match set cannot storm the FS. */
const STAT_CONCURRENCY_LIMIT = 100;

/**
 * Drop every match whose CANONICAL path escapes the containment root, then stat the survivors for the
 * mtime sort, newest first.
 *
 * Containment is decided per RESULT as well as per root (SEC-007): a `..` in the pattern, or an
 * absolute pattern, produces a match the search root never vouched for. Decided canonically through
 * the shared guard — a symlink named `escape` is a plain segment, so no amount of segment validation
 * would catch it.
 */
async function containedMatchesByMtime(
  matches: readonly string[],
  cwd: string,
  containmentRoot: string | undefined,
): Promise<IFileWithMtime[]> {
  const limit = pLimit(STAT_CONCURRENCY_LIMIT);
  const stated = await Promise.all(
    matches.map((p) =>
      limit(async (): Promise<IFileWithMtime | undefined> => {
        const absPath = resolve(cwd, p);
        if (!isWithinCwd(absPath, containmentRoot)) return undefined;
        try {
          return { path: p, mtime: (await stat(absPath)).mtimeMs };
        } catch {
          // allow-fallback: stat failure on a matched path returns mtime=0 (sort-last), not a logic fallback
          return { path: p, mtime: 0 };
        }
      }),
    ),
  );
  return stated
    .filter((entry): entry is IFileWithMtime => entry !== undefined)
    .sort((a, b) => b.mtime - a.mtime);
}

async function globFileTool(
  args: TGlobArgs,
  options: IContainedBuiltinToolOptions,
): Promise<string> {
  const { pattern, path: basePath } = args;
  const containmentRoot = options.cwd;
  const { root: cwd, error: rootError } = resolveSearchRoot(basePath, containmentRoot);
  if (rootError) return rootError;

  let matches: string[];
  try {
    matches = await fg(pattern, {
      cwd,
      ignore: ['**/node_modules/**', '**/.git/**'],
      dot: true,
      absolute: false,
      // A symlinked directory is a BOUNDARY, not a doorway. Descending through one both escapes the
      // sandbox and turns a single Glob call into a whole-disk walk when the link points at `/`.
      //
      // Unconditional since ARCH-010. This used to be `containmentRoot === undefined` — following
      // links when there was no root — but a rootless call now fails at `resolveSearchRoot` above and
      // never reaches here, so that branch described a state that can no longer exist.
      followSymbolicLinks: false,
    });
  } catch (err) {
    const result: IToolInvocationResult = {
      success: false,
      output: '',
      error: err instanceof Error ? err.message : String(err),
    };
    return JSON.stringify(result);
  }

  const withMtime = await containedMatchesByMtime(matches, cwd, containmentRoot);

  const maxResults = args.limit ?? DEFAULT_MAX_RESULTS;
  const totalMatches = withMtime.length;
  const truncated = totalMatches > maxResults;
  const limited = truncated ? withMtime.slice(0, maxResults) : withMtime;
  const sorted = limited.map((f) => f.path);

  let output = sorted.length > 0 ? sorted.join('\n') : '(no matches)';
  if (truncated) {
    output += `\n\n[Showing ${maxResults} of ${totalMatches} matches. Use limit parameter to see more.]`;
  }

  const result: IToolInvocationResult = {
    success: true,
    output,
  };
  return JSON.stringify(result);
}

const DEFAULT_GLOB_DESCRIPTION =
  "Fast file pattern matching tool that works with any codebase size.\n\nSupports glob patterns like '**/*.js' or 'src/**/*.ts'. Returns matching file paths sorted by modification time.\n\nUse this tool when you need to find files by name patterns.\n\nDefault limit is 1000 results. Use the limit parameter if you need fewer results to save context space.";

/**
 * Create a GlobTool instance — register with Robota agent tools registry.
 */
export function createGlobTool(options: IContainedBuiltinToolOptions): FunctionTool {
  return createZodFunctionTool(
    'Glob',
    options.description ?? DEFAULT_GLOB_DESCRIPTION,
    GlobSchema,
    async (params) => {
      return globFileTool(params, options);
    },
  );
}
