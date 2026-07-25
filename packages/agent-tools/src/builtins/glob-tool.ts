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

import { checkPathWithinCwd, isWithinCwd } from './path-guard.js';
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

async function globFileTool(
  args: TGlobArgs,
  options: IContainedBuiltinToolOptions,
): Promise<string> {
  const { pattern, path: basePath } = args;
  const containmentRoot = options.cwd;
  // A relative `path` from the model resolves against the CONTAINMENT ROOT when one is configured.
  // Resolving it against `process.cwd()` would mean the guard root and the search root are anchored
  // to two different directories, which is how a "contained" search silently starts somewhere else.
  const searchBase = containmentRoot ?? process.cwd();
  const cwd = basePath ? resolve(searchBase, basePath) : searchBase;

  const rootError = checkPathWithinCwd(cwd, containmentRoot);
  if (rootError) return rootError;

  let matches: string[];
  try {
    matches = await fg(pattern, {
      cwd,
      ignore: ['**/node_modules/**', '**/.git/**'],
      dot: true,
      absolute: false,
      // Contained: a symlinked directory is a BOUNDARY, not a doorway. Descending through one both
      // escapes the sandbox and turns a single Glob call into a whole-disk walk when the link points
      // at `/`. Unarmed (no containment root), fast-glob's default traversal is unchanged.
      followSymbolicLinks: containmentRoot === undefined,
    });
  } catch (err) {
    const result: IToolInvocationResult = {
      success: false,
      output: '',
      error: err instanceof Error ? err.message : String(err),
    };
    return JSON.stringify(result);
  }

  // Sort by mtime (most recent first); cap concurrent stat calls to avoid I/O explosion
  const limit = pLimit(100);
  const stated: Array<IFileWithMtime | undefined> = await Promise.all(
    matches.map((p) =>
      limit(async () => {
        const absPath = resolve(cwd, p);
        // Containment is decided per RESULT as well as per root: a `..` in the pattern, or an
        // absolute pattern, produces a match the search root never vouched for. Decided on the
        // canonical path via the shared guard — a symlink named `escape` is a plain segment, so
        // no amount of segment validation would catch it.
        if (!isWithinCwd(absPath, containmentRoot)) return undefined;
        try {
          const s = await stat(absPath);
          return { path: p, mtime: s.mtimeMs };
        } catch {
          // allow-fallback: stat failure on a matched path returns mtime=0 (sort-last), not a logic fallback
          return { path: p, mtime: 0 };
        }
      }),
    ),
  );
  const withMtime: IFileWithMtime[] = stated.filter(
    (entry): entry is IFileWithMtime => entry !== undefined,
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
export function createGlobTool(options: IContainedBuiltinToolOptions = {}): FunctionTool {
  return createZodFunctionTool(
    'Glob',
    options.description ?? DEFAULT_GLOB_DESCRIPTION,
    GlobSchema,
    async (params) => {
      return globFileTool(params, options);
    },
  );
}

/**
 * GlobTool instance — register with Robota agent tools registry.
 *
 * UNCONTAINED, deliberately: a module-level singleton can only ever be context-free. Assemblies that
 * have a session root MUST build their own via {@link createGlobTool} (`createDefaultTools`,
 * `createCodingPack`) — that is exactly what SEC-007 changed.
 */
export const globTool = createGlobTool();
