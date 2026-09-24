/**
 * GrepTool — recursive regex content search.
 *
 * Supports three output modes:
 * - files_with_matches (default): return only file paths that contain a match
 * - content: return matching lines with optional context lines
 * - count: return per-file match counts as "path:count" rows
 *
 * headLimit caps the number of result lines; excess is truncated with a marker.
 *
 * SEC-007: when a containment root is configured the search is confined to it. Grep is the most
 * disclosing of the file tools — `content` mode returns the matching LINES — so it must be contained
 * at least as strictly as `Read`, which it could otherwise stand in for.
 */

import { readFile, stat } from 'node:fs/promises';

import pLimit from 'p-limit';
import { z } from 'zod';
import { ToolExecutionError } from '@robota-sdk/agent-core';

import { collectFiles } from './grep-search.js';
import { IsolatedGrepSearch } from './isolated-grep-search.js';
import { resolveSearchRoot } from './path-guard.js';
import { createZodFunctionTool } from '../implementations/function-tool';

import type { IContainedBuiltinToolOptions } from './tool-options.js';
import type { IToolInvocationResult } from '../types/tool-result.js';
import type { FunctionTool } from '@robota-sdk/agent-core';

// CORE-030: defining a tool and telling the permission system what it does arrive together.
import '../tool-permission-profiles.js';

const GrepSchema = z.object({
  pattern: z.string().describe('The regular expression pattern to search for in file contents'),
  path: z
    .string()
    .optional()
    .describe('File or directory to search in. Defaults to the current working directory'),
  glob: z
    .string()
    .optional()
    .describe(
      'Glob pattern to filter files (e.g. "*.ts", "*.{ts,tsx}"). Only files matching this pattern will be searched',
    ),
  contextLines: z
    .number()
    .optional()
    .describe(
      'Number of context lines to show before and after each match. Only applies when outputMode is "content". Default: 0',
    ),
  outputMode: z
    .enum(['files_with_matches', 'content', 'count'])
    .optional()
    .describe(
      'Output mode: "files_with_matches" shows only file paths (default), "content" shows matching lines with context, "count" shows per-file match counts',
    ),
  headLimit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Maximum number of result lines (file paths, content lines, or count rows) to return. Excess results are truncated with a marker line',
    ),
});

type TGrepArgs = z.infer<typeof GrepSchema>;

/** Cap on concurrent file reads during the content scan (CLI-042). */
const READ_CONCURRENCY_LIMIT = 50;

/** A grep isolation failure is a hard tool failure, distinct from ordinary no-match/invalid-input results. */
export class GrepIsolationError extends ToolExecutionError {
  public constructor(public readonly reason: 'timeout' | 'cancelled' | 'limit' | 'failed') {
    super(
      `Grep search ${reason === 'timeout' ? 'timed out' : reason === 'cancelled' ? 'cancelled' : reason === 'limit' ? 'exceeded its byte limit' : 'worker failed'}`,
      'Grep',
    );
  }
}

async function grepFileTool(args: TGrepArgs, options: IGrepToolOptions): Promise<string> {
  const {
    pattern,
    path: searchPath,
    glob,
    contextLines = 0,
    outputMode = 'files_with_matches',
    headLimit,
  } = args;
  const containmentRoot = options.cwd;
  const { root: targetPath, error: rootError } = resolveSearchRoot(searchPath, containmentRoot);
  if (rootError) return rootError;

  try {
    new RegExp(pattern);
  } catch (err) {
    const result: IToolInvocationResult = {
      success: false,
      output: '',
      error: `Invalid regex pattern: ${pattern}`,
    };
    return JSON.stringify(result);
  }

  // Determine whether targetPath is a file or directory
  let targetStat: Awaited<ReturnType<typeof stat>>;
  try {
    targetStat = await stat(targetPath);
  } catch {
    const result: IToolInvocationResult = {
      success: false,
      output: '',
      error: `Path not found: ${targetPath}`,
    };
    return JSON.stringify(result);
  }

  let files: string[];
  if (targetStat.isFile()) {
    files = [targetPath];
  } else {
    files = await collectFiles(targetPath, glob, containmentRoot);
  }

  // Read/scan files in parallel with bounded concurrency, but collect results
  // in file-enumeration order so output stays byte-identical to the previous
  // sequential implementation (CLI-042).
  const search = new IsolatedGrepSearch(pattern, options.signal);
  let perFileMatches: string[][];
  try {
    const limit = pLimit(READ_CONCURRENCY_LIMIT);
    const outcomes = await Promise.allSettled(
      files.map((filePath) =>
        limit(async (): Promise<string[]> => {
          let content: string;
          try {
            const fileStat = await stat(filePath);
            if (fileStat.size > 4 * 1024 * 1024) throw new GrepIsolationError('limit');
            const buffer = await readFile(filePath);
            if (buffer.length > 4 * 1024 * 1024) throw new GrepIsolationError('limit');
            // Skip binary files
            const checkLen = Math.min(buffer.length, 8192);
            let hasBinary = false;
            for (let i = 0; i < checkLen; i++) {
              if (buffer[i] === 0) {
                hasBinary = true;
                break;
              }
            }
            if (hasBinary) return [];
            content = buffer.toString('utf8');
          } catch (error) {
            if (error instanceof GrepIsolationError) throw error;
            // allow-fallback: an unreadable file is skipped (pre-existing sequential
            // semantics — same as the old `continue`), not a logic fallback
            return [];
          }

          return search.search(content, filePath, contextLines, outputMode);
        }),
      ),
    );
    const failed = outcomes.find((outcome) => outcome.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    perFileMatches = outcomes.map((outcome) => (outcome as PromiseFulfilledResult<string[]>).value);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    throw error instanceof GrepIsolationError
      ? error
      : new GrepIsolationError(
          message.includes('timed out')
            ? 'timeout'
            : message.includes('cancelled')
              ? 'cancelled'
              : message.includes('byte limit')
                ? 'limit'
                : 'failed',
        );
  } finally {
    await search.stop();
  }

  let outputBytes = 0;
  for (const matches of perFileMatches)
    for (const match of matches) {
      outputBytes += Buffer.byteLength(match, 'utf8') + 1;
      if (outputBytes > 4 * 1024 * 1024) throw new GrepIsolationError('limit');
    }
  const allOutputLines: string[] = perFileMatches.flat();

  let outputLines = allOutputLines;
  if (headLimit !== undefined && outputLines.length > headLimit) {
    const truncatedCount = outputLines.length - headLimit;
    outputLines = [
      ...outputLines.slice(0, headLimit),
      `(+${truncatedCount} more results truncated by headLimit)`,
    ];
  }

  const result: IToolInvocationResult = {
    success: true,
    output: outputLines.length > 0 ? outputLines.join('\n') : '(no matches)',
  };
  return JSON.stringify(result);
}

/** The registered name of the shell tool this package's default assembly ships (NEUT-002). */
const DEFAULT_SHELL_TOOL_NAME = 'Shell';

/** Options for the grep tool factory: containment root + description seam + shell-tool reference. */
export interface IGrepToolOptions extends IContainedBuiltinToolOptions {
  /** Cancels the isolated regex search and waits for its worker to exit. */
  signal?: AbortSignal;
  /**
   * Registered name of the shell tool the default description references (default: `Shell`).
   * Ignored when `description` overrides the text.
   */
  shellToolName?: string;
}

/** Build the default description, referencing the actually-registered shell tool by name. */
function buildGrepDescription(shellToolName: string): string {
  return `A powerful search tool built on regex matching.\n\nSupports full regex syntax (e.g., 'log.*Error', 'function\\\\s+\\\\w+'). Filter files with glob parameter (e.g., '*.js', '**/*.tsx').\n\nOutput modes: 'content' shows matching lines with context, 'files_with_matches' shows only file paths (default), 'count' shows per-file match counts.\n\nPrefer this tool over running grep or rg through the ${shellToolName} tool — it returns structured results directly.\n\nUse headLimit to control result size and save context space.`;
}

/**
 * Create a GrepTool instance — register with Robota agent tools registry.
 */
export function createGrepTool(options: IGrepToolOptions): FunctionTool {
  return createZodFunctionTool(
    'Grep',
    options.description ?? buildGrepDescription(options.shellToolName ?? DEFAULT_SHELL_TOOL_NAME),
    GrepSchema,
    async (params) => {
      return grepFileTool(params, options);
    },
  );
}
